import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentAccount,
  FulfillmentEventType,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentStatus,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentProviderInactiveException,
  FulfillmentProviderNotAssignedException,
  FulfillmentAlreadySubmittedException,
  FulfillmentCannotCancelException,
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentNotReadyException,
  FulfillmentOrderNotFoundException,
  FulfillmentProviderAuthException,
  FulfillmentProviderException,
  FulfillmentProviderTimeoutException,
  FulfillmentRateLimitedException,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../../repositories/fulfillment.repository';
import {
  FulfillmentReadinessService,
  type DesignsByProductKey,
} from '../../services/fulfillment-readiness.service';
import { mappingKeyOf } from '../../shared/mapping-match';
import { MangoApiClient, MangoCallContext } from '../clients/mango-api.client';
import { MangoCredentialService } from './mango-credential.service';
import { MangoOrderMapper } from '../mappers/mango-order.mapper';
import type { MangoShippingMethod } from '../constants/mango.constants';
import type { MangoOrderResponse } from '../types/mango-api.types';

/** Trạng thái Mango cho phép huỷ (tài liệu Cancel Order: chỉ NEW_ORDER hoặc ON_HOLD). */
const CANCELLABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.ON_HOLD,
];

/** Trạng thái cho phép gửi lại (chưa từng gửi thành công). */
const RESUBMITTABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
];

/**
 * MangoFulfillmentService — nghiệp vụ gửi đơn sang MangoTeePrints.
 *
 * 🔴 Toàn bộ logic nằm ở đây, KHÔNG chạm vào `PodOrderService` (yêu cầu kiến trúc).
 * Module POD chỉ cung cấp dữ liệu đơn; module này chịu trách nhiệm gửi đi và theo dõi.
 *
 * Bất biến quan trọng:
 *  - Mỗi đơn POD chỉ gửi MỘT lần tới mỗi nhà cung cấp (UNIQUE ở DB + kiểm tra trạng thái).
 *  - `order_id` gửi đi là khoá idempotency: Mango từ chối nếu trùng ⇒ không tạo hai đơn
 *    ở xưởng in dù mạng lỗi giữa chừng.
 *  - Mọi bước đều ghi vào nhật ký append-only, kể cả khi thất bại.
 */
@Injectable()
export class MangoFulfillmentService {
  private readonly logger = new Logger(MangoFulfillmentService.name);

  private static readonly PROVIDER = FulfillmentProvider.MANGO;

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly readiness: FulfillmentReadinessService,
    private readonly client: MangoApiClient,
    private readonly mapper: MangoOrderMapper,
    private readonly credentials: MangoCredentialService,
  ) {}

  // ---------------------------------------------------------------------------
  // Tạo đơn
  // ---------------------------------------------------------------------------

  /**
   * Gửi một đơn POD sang xưởng in.
   *
   * Thứ tự: validate → tạo bản ghi DRAFT → gọi API → cập nhật kết quả.
   * Tạo DRAFT TRƯỚC khi gọi API để nếu API treo/timeout vẫn còn dấu vết và có thể retry;
   * nếu tạo sau, một lần timeout sẽ mất hoàn toàn thông tin đã gửi gì.
   */
  async fulfill(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger = FulfillmentTrigger.MANUAL,
  ): Promise<FulfillmentOrderWithRelations> {
    const existing = await this.repo.findByPodOrder(
      organizationId,
      podOrderId,
      MangoFulfillmentService.PROVIDER,
    );
    // Đã gửi thành công rồi thì tuyệt đối không gửi lại — sản xuất trùng tốn tiền thật.
    if (existing && !RESUBMITTABLE_STATUSES.includes(existing.status)) {
      throw new FulfillmentAlreadySubmittedException(existing.status);
    }

    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();

    // Nhà cung cấp được suy ra TỪ TIKTOK ACCOUNT sở hữu đơn, không phải "tài khoản mặc định
    // của tổ chức". Nhờ vậy mỗi shop gửi đúng xưởng in của mình, và không tồn tại đường nào
    // để một đơn âm thầm đi nhầm nhà cung cấp.
    const account = await this.requireProviderForOrder(organizationId, order);

    // Phạm vi TỔ CHỨC — xem chú thích ở `FulfillmentService.getState`. Ánh xạ khai cho nhà
    // cung cấp khác sẽ bị `check()` chặn bằng MAPPING_PROVIDER_MISMATCH, không lọt xuống đây.
    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    // Design tra theo (Product ID + Seller SKU), độc lập với ánh xạ — nạp một lần cho cả đơn.
    const designsByKey = await this.loadDesignsByKey(organizationId);
    const check = this.readiness.check(
      order,
      mappings,
      designsByKey,
      this.publicBaseUrl(),
      account.id,
    );
    if (!check.ready || !check.address || !check.items?.length) {
      // Ghi lại lý do từ chối để người vận hành xem được lịch sử, không chỉ toast rồi mất.
      if (existing) {
        await this.repo.addHistory({
          organizationId,
          fulfillmentOrderId: existing.id,
          eventType: FulfillmentEventType.VALIDATION_FAILED,
          trigger,
          success: false,
          message: check.issues
            .map((issue) => issue.message)
            .join(' | ')
            .slice(0, 2000),
          payload: { issues: check.issues } as unknown as Prisma.InputJsonValue,
          performedBy: actorUserId,
        });
      }
      throw new FulfillmentNotReadyException(check.issues);
    }

    const externalOrderId =
      existing?.externalOrderId ?? this.mapper.buildExternalOrderId(order.tiktokOrderId);

    const record =
      existing ??
      (await this.repo.createDraft({
        organizationId,
        accountId: account.id,
        provider: MangoFulfillmentService.PROVIDER,
        podOrderId,
        externalOrderId,
        productionLine: account.defaultProductionLine,
        shippingMethod: account.defaultShippingMethod,
        facility: account.defaultFacility,
        createdBy: actorUserId,
      }));

    const request = this.mapper.buildCreateOrderRequest({
      externalOrderId,
      address: check.address,
      items: check.items,
      shippingMethod: account.defaultShippingMethod as MangoShippingMethod,
      facility: account.defaultFacility,
      // Đơn 4PL của TikTok đã có nhãn sẵn — chỉ gửi khi thực sự có.
      labelUrl: null,
      note: order.sellerNote,
      seller: order.shop.name,
      buyerEmail: order.buyerEmail,
    });

    await this.repo.replaceItems(
      record.id,
      organizationId,
      check.items.map((item) => ({
        podOrderItemId: item.podOrderItemId,
        providerSku: item.providerSku,
        quantity: item.quantity,
        productionConfig: item.productionConfig,
        baseCost: item.baseCost,
        printFiles: item.printFiles as unknown as Prisma.InputJsonValue,
      })),
    );

    await this.repo.updateOrder(record.id, {
      status: FulfillmentStatus.SUBMITTING,
      attemptCount: { increment: 1 },
      rawRequest: this.mapper.maskRequestForStorage(request) as Prisma.InputJsonValue,
      updatedBy: actorUserId,
    });
    await this.repo.addHistory({
      organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.CREATE_REQUEST,
      trigger,
      fromStatus: record.status,
      toStatus: FulfillmentStatus.SUBMITTING,
      message: `Gửi ${check.items.length} sản phẩm sang MangoTeePrints`,
      payload: { externalOrderId, itemCount: check.items.length },
      performedBy: actorUserId,
    });

    try {
      const result = await this.client.createOrder(this.callContext(account), request);

      await this.repo.updateOrder(record.id, {
        status: FulfillmentStatus.SUBMITTED,
        providerOrderId: result.data?.id ?? null,
        providerStatus: result.data?.status ?? null,
        rawResponse: (result.data ?? {}) as Prisma.InputJsonValue,
        lastRequestId: result.requestId ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
        submittedAt: new Date(),
        lastSyncedAt: new Date(),
        updatedBy: actorUserId,
      });
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CREATE_SUCCESS,
        trigger,
        fromStatus: FulfillmentStatus.SUBMITTING,
        toStatus: FulfillmentStatus.SUBMITTED,
        providerStatus: result.data?.status ?? null,
        message: 'Xưởng in đã tiếp nhận đơn',
        payload: { providerOrderId: result.data?.id },
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      await this.repo.touchAccountUsed(account.id);

      this.logger.log({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'create',
        organizationId,
        podOrderId,
        externalOrderId,
        providerOrderId: result.data?.id,
        durationMs: result.durationMs,
        msg: 'Tạo đơn fulfillment thành công',
      });
    } catch (error) {
      await this.recordFailure(organizationId, record.id, 'create', trigger, actorUserId, error);
      throw this.translate(error);
    }

    return this.requireRecord(organizationId, record.id);
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ trạng thái
  // ---------------------------------------------------------------------------

  /**
   * Đồng bộ trạng thái MỘT đơn từ nhà cung cấp.
   * Trả về `true` nếu trạng thái/tracking có thay đổi (để lượt cron đếm chính xác).
   */
  async syncOne(
    record: FulfillmentOrder,
    account: FulfillmentAccount,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<{ changed: boolean; apiCalls: number }> {
    try {
      const result = await this.client.getOrder(this.callContext(account), record.externalOrderId);
      const changed = await this.applyProviderState(record, result.data, trigger, {
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      return { changed, apiCalls: 1 };
    } catch (error) {
      await this.recordFailure(
        record.organizationId,
        record.id,
        'sync',
        trigger,
        actorUserId,
        error,
      );
      // Đồng bộ lỗi KHÔNG đổi trạng thái đơn: giữ nguyên để lượt sau thử lại.
      await this.repo.updateOrder(record.id, { lastSyncedAt: new Date() });
      return { changed: false, apiCalls: 1 };
    }
  }

  /** Đồng bộ theo yêu cầu người dùng (nút "Đồng bộ trạng thái"). */
  async syncByPodOrder(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findByPodOrder(
      organizationId,
      podOrderId,
      MangoFulfillmentService.PROVIDER,
    );
    if (!record) throw new FulfillmentOrderNotFoundException();
    const account = await this.requireAccountById(organizationId, record.accountId);

    await this.syncOne(record, account, FulfillmentTrigger.MANUAL, actorUserId);
    return this.requireRecord(organizationId, record.id);
  }

  /**
   * Áp trạng thái mới lấy từ nhà cung cấp vào bản ghi.
   * Dùng chung cho cả scheduler lẫn webhook ⇒ một chỗ duy nhất quyết định chuyển trạng thái.
   */
  async applyProviderState(
    record: FulfillmentOrder,
    detail: MangoOrderResponse | null,
    trigger: FulfillmentTrigger,
    meta: { durationMs?: number; requestId?: string; performedBy?: string } = {},
  ): Promise<boolean> {
    if (!detail) return false;

    const primaryShipment =
      detail.shipments?.find((shipment) => shipment.primary !== false) ?? detail.shipments?.[0];
    const trackingNumber = detail.tracking_number ?? primaryShipment?.tracking_number ?? null;
    const trackingStatus = detail.tracking_status ?? primaryShipment?.tracking_status ?? null;
    const providerStatus = (detail.status as string) ?? null;
    const nextStatus = this.mapper.toFulfillmentStatus(providerStatus, trackingStatus);

    const statusChanged = nextStatus !== record.status || providerStatus !== record.providerStatus;
    const trackingChanged = trackingNumber !== record.trackingNumber;

    await this.repo.updateOrder(record.id, {
      status: nextStatus,
      providerStatus,
      providerFulfillId: detail.order_fulfill_id ?? record.providerFulfillId,
      trackingNumber,
      trackingStatus,
      trackingUrl: primaryShipment?.tracking_url ?? record.trackingUrl,
      carrier: primaryShipment?.carrier ?? record.carrier,
      labelUrl: detail.label_url ?? primaryShipment?.label_url ?? record.labelUrl,
      subtotal: this.toDecimal(detail.subtotal),
      shippingFee: this.toDecimal(detail.shipping_fee),
      tax: this.toDecimal(detail.tax),
      total: this.toDecimal(detail.total),
      productionLine: detail.production_line_id ?? record.productionLine,
      rawResponse: detail as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
      ...(nextStatus === FulfillmentStatus.CANCELLED && !record.cancelledAt
        ? { cancelledAt: new Date() }
        : {}),
      // Mốc hoàn tất ghi MỘT LẦN. Trạng thái nhà cung cấp có thể dao động quanh DELIVERED
      // (vd webhook tới sau lượt đồng bộ); ghi đè sẽ làm sai số liệu đối soát.
      ...(nextStatus === FulfillmentStatus.DELIVERED && !record.completedAt
        ? { completedAt: new Date() }
        : {}),
    });

    if (statusChanged) {
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.STATUS_CHANGED,
        trigger,
        fromStatus: record.status,
        toStatus: nextStatus,
        providerStatus,
        message: `Trạng thái đổi: ${record.providerStatus ?? '—'} → ${providerStatus ?? '—'}`,
        durationMs: meta.durationMs,
        requestId: meta.requestId,
        performedBy: meta.performedBy,
      });
    }
    if (trackingChanged && trackingNumber) {
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.SHIPMENT_UPDATED,
        trigger,
        providerStatus,
        message: `Có mã vận đơn: ${trackingNumber}`,
        payload: {
          trackingNumber,
          trackingStatus,
          carrier: primaryShipment?.carrier ?? null,
        },
        performedBy: meta.performedBy,
      });
    }

    return statusChanged || trackingChanged;
  }

  // ---------------------------------------------------------------------------
  // Huỷ đơn
  // ---------------------------------------------------------------------------

  /** Huỷ đơn ở xưởng in. Mango chỉ cho phép khi đơn còn NEW_ORDER hoặc ON_HOLD. */
  async cancel(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    reason?: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findByPodOrder(
      organizationId,
      podOrderId,
      MangoFulfillmentService.PROVIDER,
    );
    if (!record) throw new FulfillmentOrderNotFoundException();
    if (!CANCELLABLE_STATUSES.includes(record.status)) {
      throw new FulfillmentCannotCancelException(record.status);
    }

    const account = await this.requireAccountById(organizationId, record.accountId);
    await this.repo.addHistory({
      organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.CANCEL_REQUEST,
      trigger: FulfillmentTrigger.MANUAL,
      fromStatus: record.status,
      message: reason ? `Yêu cầu huỷ: ${reason}` : 'Yêu cầu huỷ đơn',
      performedBy: actorUserId,
    });

    try {
      const result = await this.client.cancelOrder(
        this.callContext(account),
        record.externalOrderId,
        { reason: reason ?? null },
      );

      await this.repo.updateOrder(record.id, {
        status: FulfillmentStatus.CANCELLED,
        providerStatus: result.data?.status ?? record.providerStatus,
        cancelledAt: new Date(),
        lastSyncedAt: new Date(),
        updatedBy: actorUserId,
      });
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CANCEL_SUCCESS,
        trigger: FulfillmentTrigger.MANUAL,
        fromStatus: record.status,
        toStatus: FulfillmentStatus.CANCELLED,
        message: 'Xưởng in xác nhận huỷ đơn',
        payload: (result.data ?? {}) as Prisma.InputJsonValue,
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
    } catch (error) {
      await this.recordFailure(
        organizationId,
        record.id,
        'cancel',
        FulfillmentTrigger.MANUAL,
        actorUserId,
        error,
        FulfillmentEventType.CANCEL_FAILED,
      );
      throw this.translate(error);
    }

    return this.requireRecord(organizationId, record.id);
  }

  /**
   * Kiểm tra kết nối tới nhà cung cấp.
   *
   * Dùng `GET /production-lines` — endpoint CÓ TRONG tài liệu, cần xác thực, chỉ đọc và
   * không tạo ra dữ liệu nào ở phía nhà cung cấp. Gọi được nghĩa là API key + Base URL đúng.
   *
   * Không bao giờ ném lỗi ra ngoài: đây là thao tác CHẨN ĐOÁN, người dùng cần đọc được
   * thông báo lỗi của nhà cung cấp chứ không phải nhận một trang lỗi.
   */
  async testConnection(account: FulfillmentAccount): Promise<{
    connected: boolean;
    message: string;
    durationMs: number | null;
    productionLineCount: number | null;
  }> {
    try {
      const result = await this.client.listProductionLines(this.credentials.buildContext(account));
      const count = result.data?.items?.length ?? 0;

      await this.repo.updateAccount(account.id, { lastUsedAt: new Date(), lastErrorMsg: null });

      this.logger.log({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'account.testConnection',
        accountId: account.id,
        durationMs: result.durationMs,
        productionLineCount: count,
        msg: 'Kiểm tra kết nối thành công',
      });

      return {
        connected: true,
        message: 'Connected',
        durationMs: result.durationMs,
        productionLineCount: count,
      };
    } catch (error) {
      // Thông báo NGUYÊN VĂN từ nhà cung cấp — người vận hành cần biết chính xác vì sao hỏng.
      const message =
        error instanceof FulfillmentClientError
          ? error.message
          : (error as Error).message || 'Không kết nối được tới nhà cung cấp';

      await this.repo.updateAccount(account.id, {
        lastErrorAt: new Date(),
        lastErrorMsg: message.slice(0, 1000),
      });

      this.logger.warn({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'account.testConnection',
        accountId: account.id,
        errorClass: error instanceof FulfillmentClientError ? error.errorClass : 'UNKNOWN',
        msg: `Kiểm tra kết nối thất bại: ${message}`,
      });

      return { connected: false, message, durationMs: null, productionLineCount: null };
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Nhà cung cấp fulfillment của một đơn = nhà cung cấp gán cho TikTok Account sở hữu đơn.
   *
   * Kiểm đủ ba điều kiện của Mục 7 (đã gán · đang ACTIVE · đủ API key và Base URL) TẠI ĐÂY,
   * trước khi chạm tới bất kỳ dữ liệu đơn nào — lỗi cấu hình phải hiện ra ngay và nói rõ
   * phải sửa ở màn hình nào.
   */
  private async requireProviderForOrder(
    organizationId: string,
    order: PodOrderWithRelations,
  ): Promise<FulfillmentAccount> {
    const assignedId = order.account?.fulfillmentAccountId;
    if (!assignedId) {
      throw new FulfillmentProviderNotAssignedException(order.account?.accountName);
    }

    const account = await this.repo.findAccountById(organizationId, assignedId);
    if (!account) {
      // Nhà cung cấp đã bị xoá sau khi gán ⇒ coi như chưa gán, hướng dẫn gán lại.
      throw new FulfillmentProviderNotAssignedException(order.account?.accountName);
    }
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);

    // Ném sớm nếu thiếu API key / Base URL, thay vì để lộ ra ở giữa luồng gửi đơn.
    this.credentials.buildContext(account);
    return account;
  }

  private async requireAccountById(
    organizationId: string,
    accountId: string,
  ): Promise<FulfillmentAccount> {
    const account = await this.repo.findAccountById(organizationId, accountId);
    if (!account) throw new FulfillmentAccountNotFoundException();
    return account;
  }

  private async requireRecord(
    organizationId: string,
    id: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findById(organizationId, id);
    if (!record) throw new FulfillmentOrderNotFoundException();
    return record;
  }

  /**
   * Ngữ cảnh gọi API cho một tài khoản.
   *
   * Việc chọn API key (biến môi trường hay key riêng của tài khoản) nằm trọn trong
   * `MangoCredentialService` — service này không cần biết key đến từ đâu.
   */
  private callContext(account: FulfillmentAccount): MangoCallContext {
    return this.credentials.buildContext(account);
  }

  /** Base URL công khai để dựng link design khi lưu trữ trả đường dẫn tương đối. */
  /**
   * Design của cả tổ chức, tra theo `mappingKeyOf(productId, sellerSku)`.
   *
   * MỘT truy vấn cho cả đơn. Design đã tách khỏi ánh xạ nên không `include` qua mapping được
   * nữa; đọc theo từng dòng hàng sẽ là N+1 ngay trên luồng gửi đơn.
   */
  private async loadDesignsByKey(organizationId: string): Promise<DesignsByProductKey> {
    const rows = await this.repo.listProductDesigns(organizationId);
    const byKey: DesignsByProductKey = new Map();
    for (const row of rows) {
      const key = mappingKeyOf(row.tiktokProductId, row.sellerSku);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    return byKey;
  }

  private publicBaseUrl(): string | undefined {
    return this.config.get<string>('storage.local.publicBaseUrl') || undefined;
  }

  /** Ghi nhật ký + error log cho một lần thất bại, rồi cập nhật tóm tắt lỗi lên bản ghi. */
  private async recordFailure(
    organizationId: string,
    fulfillmentOrderId: string,
    operation: string,
    trigger: FulfillmentTrigger,
    actorUserId: string | undefined,
    error: unknown,
    eventType: FulfillmentEventType = FulfillmentEventType.CREATE_FAILED,
  ): Promise<void> {
    const clientError =
      error instanceof FulfillmentClientError
        ? error
        : new FulfillmentClientError(
            FulfillmentErrorClass.UNKNOWN,
            (error as Error).message ?? 'Lỗi không xác định',
          );

    await this.repo.addErrorLog({
      organizationId,
      fulfillmentOrderId,
      provider: MangoFulfillmentService.PROVIDER,
      operation,
      errorClass: clientError.errorClass,
      httpStatus: clientError.httpStatus ?? null,
      providerCode: clientError.providerCode ?? null,
      message: clientError.message,
      validationErrors: clientError.validationErrors ?? [],
      rawError: clientError.rawBody ?? {},
      requestId: clientError.requestId ?? null,
      retryable: clientError.retryable,
    });

    await this.repo.addHistory({
      organizationId,
      fulfillmentOrderId,
      eventType,
      trigger,
      success: false,
      message: `${clientError.errorClass}: ${clientError.message}`,
      payload: {
        httpStatus: clientError.httpStatus,
        providerCode: clientError.providerCode,
        retryable: clientError.retryable,
      },
      requestId: clientError.requestId,
      performedBy: actorUserId,
    });

    // Chỉ luồng TẠO đơn mới hạ trạng thái xuống FAILED; sync/cancel lỗi thì giữ nguyên
    // trạng thái thật của đơn ở xưởng in.
    if (eventType === FulfillmentEventType.CREATE_FAILED) {
      await this.repo.updateOrder(fulfillmentOrderId, {
        status: FulfillmentStatus.FAILED,
        lastErrorCode: clientError.providerCode ?? clientError.errorClass,
        lastErrorMessage: clientError.message.slice(0, 2000),
        lastRequestId: clientError.requestId ?? null,
      });
    } else {
      await this.repo.updateOrder(fulfillmentOrderId, {
        lastErrorCode: clientError.providerCode ?? clientError.errorClass,
        lastErrorMessage: clientError.message.slice(0, 2000),
        lastRequestId: clientError.requestId ?? null,
      });
    }

    this.logger.error({
      module: 'fulfillment',
      provider: 'MANGO',
      operation,
      organizationId,
      fulfillmentOrderId,
      errorClass: clientError.errorClass,
      httpStatus: clientError.httpStatus,
      providerCode: clientError.providerCode,
      requestId: clientError.requestId,
      retryable: clientError.retryable,
      msg: clientError.message,
    });
  }

  /** Dịch lỗi client sang exception HTTP phù hợp (không lộ chi tiết hạ tầng). */
  private translate(error: unknown): Error {
    if (!(error instanceof FulfillmentClientError)) {
      return error instanceof Error ? error : new FulfillmentProviderException();
    }
    switch (error.errorClass) {
      case FulfillmentErrorClass.AUTH:
        return new FulfillmentProviderAuthException();
      case FulfillmentErrorClass.VALIDATION:
        return new FulfillmentValidationException(error.message, error.validationErrors);
      case FulfillmentErrorClass.RATE_LIMIT:
        return new FulfillmentRateLimitedException();
      case FulfillmentErrorClass.NETWORK:
        return new FulfillmentProviderTimeoutException();
      default:
        return new FulfillmentProviderException(error.message);
    }
  }

  private toDecimal(value?: number | null): Prisma.Decimal | null {
    if (value === undefined || value === null || !Number.isFinite(value)) return null;
    return new Prisma.Decimal(value);
  }
}
