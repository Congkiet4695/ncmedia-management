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
import { DistributedLockService } from '../../../pod-tiktok/infra/distributed-lock.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentProviderInactiveException,
  FulfillmentProviderNotAssignedException,
  FulfillmentProviderNotSelectedException,
  FulfillmentAlreadySubmittedException,
  FulfillmentCannotCancelException,
  FulfillmentCannotUpdateException,
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
import { FulfillmentOptionsService } from '../../services/fulfillment-options.service';
import { MangoOrderMapper, type ResolvedItem } from '../mappers/mango-order.mapper';
import type {
  MangoPreferredCarrier,
  MangoShippingMethod,
  MangoSpeedType,
} from '../constants/mango.constants';
import type { MangoOrderResponse } from '../types/mango-api.types';

/** Một dòng hàng nhà cung cấp trả về, kèm số lần SKU đó xuất hiện (ghép nhập nhằng ⇒ bỏ qua). */
interface ProviderItemBucket {
  count: number;
  item: import('../mappers/mango-order.mapper').ProviderItemCost;
}

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
 * Trạng thái còn SỬA được ở nhà cung cấp.
 *
 * Tài liệu Update Order: "Only allows updating certain fields and when order is not processed
 * yet" — tức là đơn mới tiếp nhận hoặc đang tạm giữ; đã vào sản xuất thì không.
 */
const UPDATABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.ON_HOLD,
];

/**
 * Khoá chống bấm "Đẩy sang Fulfill" hai lần (ms).
 *
 * 🔴 Kiểm trạng thái rồi mới ghi là một khoảng hở: hai request gần như đồng thời cùng đọc
 * thấy DRAFT/FAILED và cùng đi tiếp. Mango sẽ từ chối request thứ hai vì trùng `order_id`
 * (idempotency thật nằm ở đó), nhưng nó cũng kịp ghi đè bản ghi bằng một lần FAILED giả và
 * làm người dùng tưởng đơn hỏng. Khoá đóng đúng khoảng hở đó; TTL để tiến trình chết không
 * khoá vĩnh viễn.
 */
const FULFILL_LOCK_MS = 60_000;

/**
 * Tuỳ chọn gửi đơn người vận hành chọn trên màn hình Fulfill.
 *
 * Bỏ trống ⇒ lấy mặc định của tài khoản nhà cung cấp (hành vi cũ, không đổi).
 */
export interface MangoFulfillOptionsInput {
  /**
   * Nhà cung cấp fulfillment người dùng CHỌN cho lần gửi này (`fulfillment_accounts.id`).
   *
   * 🔴 Đây là nguồn ưu tiên số một — thay cho việc suy ra nhà cung cấp từ TikTok Account.
   * Bỏ trống thì hệ thống lùi về nhà cung cấp đã gán cho kết nối TikTok (dữ liệu cũ), rồi tới
   * "chỉ có đúng một nhà cung cấp khả dụng". Xem `resolveProviderAccount`.
   */
  fulfillmentAccountId?: string | null;
  shippingMethod?: MangoShippingMethod | null;
  facility?: string | null;
  speedType?: MangoSpeedType | null;
  preferredCarrier?: MangoPreferredCarrier | null;
  isScanLabel?: boolean;
  /** Nhãn vận chuyển người bán tự mua (PDF/PNG/JPG, URL công khai). */
  labelUrl?: string | null;
  note?: string | null;
}

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
    private readonly lock: DistributedLockService,
    /** Nguồn tên production line (đã nhớ 10 phút) — dùng cho phép kiểm phụ thuộc xưởng. */
    private readonly options: FulfillmentOptionsService,
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
    options: MangoFulfillOptionsInput = {},
  ): Promise<FulfillmentOrderWithRelations> {
    const done = await this.lock.withLock(`fulfillment:fulfill:${podOrderId}`, FULFILL_LOCK_MS, () =>
      this.fulfillLocked(organizationId, actorUserId, podOrderId, trigger, options),
    );
    if (!done) throw new FulfillmentAlreadySubmittedException(FulfillmentStatus.SUBMITTING);
    return done;
  }

  private async fulfillLocked(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger,
    options: MangoFulfillOptionsInput,
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
    const account = await this.requireProviderForOrder(
      organizationId,
      order,
      options.fulfillmentAccountId,
    );

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

    // Tuỳ chọn người dùng chọn cho ĐƠN NÀY thắng mặc định của tài khoản; không chọn thì giữ
    // nguyên hành vi cũ (mặc định tài khoản, ghi chú của người bán).
    const shippingMethod = (options.shippingMethod ??
      account.defaultShippingMethod) as MangoShippingMethod;
    const facility = options.facility ?? account.defaultFacility;
    const note = options.note ?? order.sellerNote;
    // 🔴 Nhãn ĐÃ LƯU của đơn là nguồn chính; body chỉ để ghi đè trong đúng lần gửi này.
    // Trước đây chỉ đọc body, nên nhãn người dùng đã lưu (hoặc lấy từ TikTok) biến mất khi
    // bấm Gửi — và readiness thì lại dựa vào nhãn đã lưu để cho phép gửi. Hai bên lệch nhau.
    const labelUrl = options.labelUrl ?? order.shippingLabelUrl ?? null;

    // Line sản xuất: ánh xạ của sản phẩm THẮNG mặc định tài khoản (readiness đã bảo đảm cả đơn
    // chỉ có một line; hai line khác nhau bị chặn từ trước với lý do rõ ràng).
    const productionLine = check.productionLine ?? account.defaultProductionLine;

    const record =
      existing ??
      (await this.repo.createDraft({
        organizationId,
        accountId: account.id,
        provider: MangoFulfillmentService.PROVIDER,
        podOrderId,
        externalOrderId,
        productionLine,
        shippingMethod,
        facility,
        createdBy: actorUserId,
      }));

    // 🔴 Ghi dòng hàng TRƯỚC khi dựng request: id của chúng được gửi làm `items[].item_id`, và
    // đó là thứ duy nhất ghép được giá vốn Mango trả về đúng dòng (hai dòng có thể cùng SKU).
    const storedItems = await this.repo.replaceItems(
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
    const itemIdByPodItem = new Map(storedItems.map((item) => [item.podOrderItemId ?? '', item.id]));
    const itemsWithId: ResolvedItem[] = check.items.map((item) => ({
      ...item,
      itemId: itemIdByPodItem.get(item.podOrderItemId) ?? null,
    }));

    // 🔴 Kiểm tra TRƯỚC khi gọi nhà cung cấp: mọi thứ bắt lỗi được tại đây đều rẻ hơn và nói
    // rõ hơn một câu "VALIDATION_ERROR — Request validation failed" trả về từ Mango.
    await this.assertProviderPayloadValid({
      account,
      items: itemsWithId,
      productionLine,
      facility,
      speedType: options.speedType ?? null,
      isScanLabel: options.isScanLabel === true,
      labelUrl,
    });

    const request = this.mapper.buildCreateOrderRequest({
      externalOrderId,
      address: check.address,
      items: itemsWithId,
      shippingMethod,
      productionLineId: productionLine,
      facility,
      speedType: options.speedType ?? null,
      preferredCarrier: options.preferredCarrier ?? null,
      isScanLabel: options.isScanLabel === true,
      // Nhãn vận chuyển: đơn 4PL của TikTok đã có nhãn sẵn, hoặc người bán tự mua rồi dán link.
      labelUrl,
      note,
      seller: order.shop.name,
      buyerEmail: order.buyerEmail,
    });

    await this.repo.updateOrder(record.id, {
      status: FulfillmentStatus.SUBMITTING,
      attemptCount: { increment: 1 },
      shippingMethod,
      facility,
      // Gửi lại một đơn cũ sau khi sửa ánh xạ ⇒ bản ghi phải mang line MỚI, không giữ line cũ.
      productionLine,
      speedType: options.speedType ?? null,
      labelUrl,
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
        // `id` là khoá phía Mango; thiếu thì lấy `order_id` — bản ghi KHÔNG có mã nhà cung cấp
        // sẽ bị bộ đồng bộ bỏ qua (điều kiện `providerOrderId != null`) và kẹt mãi không có giá vốn.
        providerOrderId: result.data?.id ?? result.data?.order_id ?? null,
        providerStatus: result.data?.status ?? null,
        rawResponse: (result.data ?? {}) as Prisma.InputJsonValue,
        lastRequestId: result.requestId ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
        submittedAt: new Date(),
        lastSyncedAt: new Date(),
        updatedBy: actorUserId,
      });

      // 🔴 Giá vốn nằm NGAY trong response tạo đơn (`data` = OrderResponseSchema, mỗi
      // `items[].base_cost`). Bỏ qua nó là tự ép mình chờ lượt đồng bộ sau mới biết giá vốn.
      const pending = await this.applyProviderCosts(record.id, organizationId, result.data);
      if (pending) {
        // Chưa có giá ngay ⇒ hỏi lại ĐÚNG MỘT LẦN bằng Get Order Detail (tài liệu: chi phí có
        // thể được tính sau khi đơn được nhận). Vẫn thiếu thì để bộ đồng bộ định kỳ lo —
        // KHÔNG ghi 0, KHÔNG ghi đè null lên số đã có.
        await this.refreshCosts(organizationId, record.id, account, trigger, actorUserId);
      }
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
      // 🔴 Không có số mới thì GIỮ số cũ. Mango bỏ trống chi phí ở những trạng thái nhất định;
      // ghi `null` đè lên giá đã chốt là xoá mất số liệu đối soát lợi nhuận của đơn.
      subtotal: this.toDecimal(detail.subtotal) ?? record.subtotal,
      shippingFee: this.toDecimal(detail.shipping_fee) ?? record.shippingFee,
      tax: this.toDecimal(detail.tax) ?? record.tax,
      total: this.toDecimal(detail.total) ?? record.total,
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

    // Giá vốn từng dòng hàng — cùng `items[]` cho Create / Get Detail / Update, nên áp ở đây
    // là mọi đường vào đều cập nhật được (tạo đơn · đồng bộ định kỳ · webhook · sửa đơn).
    await this.applyProviderCosts(record.id, record.organizationId, detail);

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
  // Giá vốn (base cost)
  // ---------------------------------------------------------------------------

  /**
   * Ghi giá vốn nhà cung cấp báo về vào từng dòng hàng.
   *
   * Ghép theo `item_id` (chính là id dòng `fulfillment_order_items` ta gửi đi) — chính xác tuyệt
   * đối kể cả khi hai dòng cùng SKU. Đơn cũ gửi trước khi có `item_id` thì lùi về ghép theo SKU
   * **và chỉ khi SKU đó xuất hiện đúng một lần** ở cả hai phía: ghép nhập nhằng thì thà không ghi
   * còn hơn gán nhầm giá vốn cho dòng khác.
   *
   * @returns `true` khi vẫn còn dòng CHƯA có giá vốn (gọi Get Order Detail lại sau).
   */
  private async applyProviderCosts(
    fulfillmentOrderId: string,
    organizationId: string,
    detail: MangoOrderResponse | null | undefined,
  ): Promise<boolean> {
    const providerItems = this.mapper.readProviderItems(detail);
    const rows = await this.repo.listItems(fulfillmentOrderId);
    if (rows.length === 0) return false;

    const byId = new Map(providerItems.filter((item) => item.itemId).map((item) => [item.itemId, item]));
    const bySku = new Map<string, ProviderItemBucket>();
    for (const item of providerItems) {
      if (!item.sku) continue;
      const bucket = bySku.get(item.sku) ?? { count: 0, item };
      bucket.count += 1;
      bucket.item = item;
      bySku.set(item.sku, bucket);
    }
    const localSkuCount = new Map<string, number>();
    for (const row of rows) {
      localSkuCount.set(row.providerSku, (localSkuCount.get(row.providerSku) ?? 0) + 1);
    }

    const costs = rows.map((row) => {
      const matched =
        byId.get(row.id) ??
        (localSkuCount.get(row.providerSku) === 1 && bySku.get(row.providerSku)?.count === 1
          ? bySku.get(row.providerSku)?.item
          : undefined);
      return {
        id: row.id,
        baseCost: matched?.baseCost ?? null,
        color: matched?.color ?? null,
        size: matched?.size ?? null,
        providerItemId: matched?.itemId ?? null,
      };
    });

    const written = await this.repo.applyProviderItemCosts(fulfillmentOrderId, costs);
    const fresh = written > 0 ? await this.repo.listItems(fulfillmentOrderId) : rows;
    const missing = fresh.filter((row) => row.baseCost === null).length;

    if (providerItems.length > 0) {
      this.logger.log({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'base-cost.apply',
        organizationId,
        fulfillmentOrderId,
        providerItems: providerItems.length,
        localItems: rows.length,
        updated: written,
        missingBaseCost: missing,
        msg: 'Cập nhật giá vốn theo dữ liệu nhà cung cấp',
      });
    }
    return missing > 0;
  }

  /**
   * Hỏi lại Get Order Detail để lấy giá vốn còn thiếu.
   *
   * Fail-soft: đơn ĐÃ được xưởng in tiếp nhận, nên một lời gọi phụ hỏng không được biến kết quả
   * gửi đơn thành thất bại. Thiếu tiếp thì bộ đồng bộ định kỳ (`FulfillmentSyncService` —
   * đơn SUBMITTED luôn nằm trong danh sách hỏi lại) sẽ điền nốt.
   */
  private async refreshCosts(
    organizationId: string,
    fulfillmentOrderId: string,
    account: FulfillmentAccount,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<void> {
    const record = await this.repo.findById(organizationId, fulfillmentOrderId);
    if (!record) return;
    try {
      const result = await this.client.getOrder(this.callContext(account), record.externalOrderId);
      await this.applyProviderState(record, result.data, trigger, {
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
    } catch (error) {
      this.logger.warn({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'base-cost.refresh',
        organizationId,
        fulfillmentOrderId,
        msg: `Chưa lấy được giá vốn ngay sau khi tạo đơn, để lượt đồng bộ sau: ${
          error instanceof Error ? error.message : 'lỗi không xác định'
        }`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Sửa đơn đã gửi (nhãn / ghi chú / phương thức vận chuyển)
  // ---------------------------------------------------------------------------

  /**
   * Sửa đơn ĐÃ gửi nhưng CHƯA vào sản xuất (PUT /orders/{order_id}).
   *
   * Dùng cho tình huống thực tế: nhãn vận chuyển mua sau khi đã đẩy đơn, hoặc đổi phương thức
   * vận chuyển. Tài liệu ghi rõ sửa `label_url` / `shipping_method` sẽ khiến Mango **tính lại
   * chi phí** — nên response được áp thẳng vào bản ghi (kể cả giá vốn từng dòng).
   */
  async updateAtProvider(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    changes: { labelUrl?: string | null; note?: string | null; shippingMethod?: MangoShippingMethod | null },
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findByPodOrder(
      organizationId,
      podOrderId,
      MangoFulfillmentService.PROVIDER,
    );
    if (!record) throw new FulfillmentOrderNotFoundException();
    if (!UPDATABLE_STATUSES.includes(record.status)) {
      throw new FulfillmentCannotUpdateException(record.status);
    }

    const request = this.mapper.buildUpdateOrderRequest(changes);
    if (Object.keys(request).length === 0) return this.requireRecord(organizationId, record.id);

    const account = await this.requireAccountById(organizationId, record.accountId);
    try {
      const result = await this.client.updateOrder(
        this.callContext(account),
        record.externalOrderId,
        request,
      );
      await this.repo.updateOrder(record.id, {
        ...(changes.labelUrl !== undefined ? { labelUrl: changes.labelUrl } : {}),
        ...(changes.shippingMethod ? { shippingMethod: changes.shippingMethod } : {}),
        lastRequestId: result.requestId ?? null,
        updatedBy: actorUserId,
      });
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.SYNC,
        trigger: FulfillmentTrigger.MANUAL,
        fromStatus: record.status,
        providerStatus: result.data?.status ?? record.providerStatus,
        message: `Đã cập nhật đơn ở xưởng in: ${Object.keys(request).join(', ')}`,
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      // Response mang chi phí đã tính lại ⇒ áp ngay, không chờ lượt đồng bộ.
      const fresh = await this.repo.findById(organizationId, record.id);
      if (fresh) {
        await this.applyProviderState(fresh, result.data, FulfillmentTrigger.MANUAL, {
          durationMs: result.durationMs,
          requestId: result.requestId,
          performedBy: actorUserId,
        });
      }
    } catch (error) {
      await this.recordFailure(
        organizationId,
        record.id,
        'update',
        FulfillmentTrigger.MANUAL,
        actorUserId,
        error,
        FulfillmentEventType.SYNC,
      );
      throw this.translate(error);
    }

    return this.requireRecord(organizationId, record.id);
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
    /** Nhà cung cấp người dùng CHỌN cho chính lần gửi này (ưu tiên cao nhất). */
    selectedAccountId?: string | null,
  ): Promise<FulfillmentAccount> {
    const account = await this.resolveProviderAccount(organizationId, order, selectedAccountId);
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);

    // Ném sớm nếu thiếu API key / Base URL, thay vì để lộ ra ở giữa luồng gửi đơn.
    this.credentials.buildContext(account);
    return account;
  }

  /**
   * Nhà cung cấp dùng cho MỘT lần gửi, theo thứ tự ưu tiên:
   *
   * ```
   *   1. người dùng CHỌN ở màn hình Fulfill   (fulfillmentAccountId trong body)
   *   2. nhà cung cấp gán cho kết nối TikTok  (dữ liệu cũ — vẫn chạy, không phải gán lại)
   *   3. đúng MỘT nhà cung cấp khả dụng       (riêng của tổ chức hoặc dùng chung)
   * ```
   *
   * 🔴 Bước 1 KHÔNG tin tưởng frontend: `findAccountById` chỉ trả về tài khoản của chính tổ
   * chức hoặc tài khoản dùng chung (`FulfillmentRepository.usableAccountWhere`), nên một
   * `accountId` của tổ chức khác không bao giờ đi qua được.
   *
   * 🔴 Bước 3 là thứ khiến "không cần gán nhà cung cấp cho từng TikTok Account" thành sự thật:
   * hệ thống chỉ có một nhà cung cấp khả dụng thì không có gì để chọn. Nhiều hơn một mà người
   * dùng không chọn ⇒ hỏi thẳng, không tự đoán hộ.
   */
  private async resolveProviderAccount(
    organizationId: string,
    order: PodOrderWithRelations,
    selectedAccountId?: string | null,
  ): Promise<FulfillmentAccount> {
    const selected = selectedAccountId?.trim();
    if (selected) {
      const account = await this.repo.findAccountById(organizationId, selected);
      if (!account) throw new FulfillmentAccountNotFoundException();
      return account;
    }

    const assignedId = order.account?.fulfillmentAccountId;
    if (assignedId) {
      const account = await this.repo.findAccountById(organizationId, assignedId);
      if (account) return account;
      // Nhà cung cấp đã bị xoá sau khi gán ⇒ rơi xuống bước 3, không bắt gán lại.
    }

    const usable = (await this.repo.listAccounts(organizationId)).filter(
      (account) => account.isActive && account.provider === MangoFulfillmentService.PROVIDER,
    );
    if (usable.length === 1) return usable[0];
    if (usable.length === 0) {
      throw new FulfillmentProviderNotAssignedException(order.account?.accountName);
    }
    throw new FulfillmentProviderNotSelectedException(usable.map((account) => account.name));
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

  /**
   * Tên của một production line (`GET /production-lines`) — `null` khi không tra được.
   *
   * Dùng để kiểm tra những tuỳ chọn CHỈ hợp lệ với một xưởng nhất định (`facility`/
   * `is_scan_label` cho TIKTOK, `speed_type` cho FASTUS — theo tài liệu MangoV3). Danh sách
   * đã được `FulfillmentOptionsService` nhớ 10 phút nên đây không phải một lời gọi mỗi đơn.
   */
  private async productionLineName(
    account: FulfillmentAccount,
    productionLineId: string | null,
  ): Promise<string | null> {
    if (!productionLineId) return null;
    try {
      const options = await this.options.forAccount(account);
      const line = options.productionLines.find(
        (entry: { value: string; label: string }) => entry.value === productionLineId,
      );
      return line?.label ?? null;
    } catch {
      // Không hỏi được nhà cung cấp ⇒ bỏ qua phép kiểm phụ thuộc tên, KHÔNG chặn đơn.
      return null;
    }
  }

  /**
   * Chặn những payload mà **chính hệ thống biết là sai** trước khi tốn một lời gọi API.
   *
   * 🔴 Vì sao cần: Mango trả `VALIDATION_ERROR — Request validation failed` không kèm field,
   * nên mỗi lỗi lọt xuống đó là một vòng đoán mò. Những gì kiểm được ở đây thì phải kiểm ở
   * đây, và thông điệp phải chỉ đúng ô cần sửa trên màn hình.
   */
  private async assertProviderPayloadValid(params: {
    account: FulfillmentAccount;
    items: ResolvedItem[];
    productionLine: string | null;
    facility: string | null;
    speedType: string | null;
    isScanLabel: boolean;
    labelUrl: string | null;
  }): Promise<void> {
    const errors: Array<{ field: string; message: string }> = [];

    params.items.forEach((item, index) => {
      if (!item.providerSku?.trim()) {
        errors.push({
          field: `items[${index}].sku`,
          message: 'Dòng hàng chưa có SKU của nhà cung cấp — sửa ở Cấu hình sản phẩm.',
        });
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        errors.push({
          field: `items[${index}].quantity`,
          message: `Số lượng không hợp lệ (${item.quantity}).`,
        });
      }
      if (item.printFiles.length === 0) {
        errors.push({
          field: `items[${index}].print_files`,
          message: 'Dòng hàng chưa có file in nào.',
        });
      }
      item.printFiles.forEach((file, fileIndex) => {
        if (!/^https?:\/\//i.test(file.url ?? '')) {
          errors.push({
            field: `items[${index}].print_files[${fileIndex}].url`,
            message: 'File in phải là URL http(s) công khai để xưởng in tải được.',
          });
        }
      });
    });

    if (params.labelUrl && !/^https?:\/\//i.test(params.labelUrl)) {
      errors.push({
        field: 'label_url',
        message: 'Nhãn vận chuyển phải là URL http(s) công khai.',
      });
    }

    // Tuỳ chọn phụ thuộc XƯỞNG (tài liệu MangoV3): gửi sai xưởng là VALIDATION_ERROR.
    const lineName = (await this.productionLineName(params.account, params.productionLine))
      ?.trim()
      .toUpperCase();
    if (lineName) {
      if (params.speedType && lineName !== 'FASTUS') {
        errors.push({
          field: 'speed_type',
          message: `Speed type chỉ dùng cho xưởng FASTUS, còn đơn này đang gửi xưởng "${lineName}". Bỏ Speed type hoặc đổi Line sản xuất.`,
        });
      }
      if (params.facility && lineName !== 'TIKTOK') {
        errors.push({
          field: 'facility',
          message: `Facility chỉ dùng cho xưởng TIKTOK, còn đơn này đang gửi xưởng "${lineName}". Bỏ Facility hoặc đổi Line sản xuất.`,
        });
      }
      if (params.isScanLabel && lineName !== 'TIKTOK') {
        errors.push({
          field: 'is_scan_label',
          message: `Scan label chỉ dùng cho xưởng TIKTOK, còn đơn này đang gửi xưởng "${lineName}".`,
        });
      }
    }

    if (errors.length === 0) return;
    throw new FulfillmentValidationException(
      `Dữ liệu gửi nhà cung cấp chưa hợp lệ: ${errors.map((error) => `${error.field} — ${error.message}`).join(' · ')}`,
      errors,
    );
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
    // 🔴 Giữ CHI TIẾT theo field ngay trên bản ghi: màn hình Fulfill đọc `lastErrorMessage`,
    // nên nếu chỉ lưu "Request validation failed" thì người vận hành không có cách nào biết
    // field nào sai — chi tiết nằm ở bảng error log mà họ không mở tới.
    const detail = (clientError.validationErrors ?? [])
      .map((error) => `${error.field ?? 'unknown'}: ${error.message ?? ''}`.trim())
      .filter((line) => line.length > 1)
      .join(' · ');
    const fullMessage = (detail ? `${clientError.message} · ${detail}` : clientError.message).slice(
      0,
      2000,
    );

    if (eventType === FulfillmentEventType.CREATE_FAILED) {
      await this.repo.updateOrder(fulfillmentOrderId, {
        status: FulfillmentStatus.FAILED,
        lastErrorCode: clientError.providerCode ?? clientError.errorClass,
        lastErrorMessage: fullMessage,
        lastRequestId: clientError.requestId ?? null,
      });
    } else {
      await this.repo.updateOrder(fulfillmentOrderId, {
        lastErrorCode: clientError.providerCode ?? clientError.errorClass,
        lastErrorMessage: fullMessage,
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
