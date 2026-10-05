import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentAccount,
  FulfillmentCatalogItemStatus,
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
import { FULFILLMENT_PROVIDER_LABELS } from '../../constants/fulfillment-provider.constants';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentAlreadySubmittedException,
  FulfillmentCancelPendingException,
  FulfillmentCannotCancelException,
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentNotReadyException,
  FulfillmentOrderNotFoundException,
  FulfillmentProviderInactiveException,
  FulfillmentReconciliationPendingException,
  FulfillmentSubmittedToOtherProviderException,
  FulfillmentValidationException,
  toProviderHttpException,
} from '../../exceptions/fulfillment.exceptions';
import { FulfillmentCatalogRepository } from '../../repositories/fulfillment-catalog.repository';
import {
  FulfillmentOrderWithRelations,
  FulfillmentRepository,
} from '../../repositories/fulfillment.repository';
import type {
  FulfillOptionsInput,
  FulfillmentProviderAdapter,
  ProviderConnectionResult,
  ProviderShippingMethods,
} from '../../services/fulfillment-provider.adapter';
import {
  FulfillmentReadinessService,
  type DesignsByProductKey,
  type MappingWithDesigns,
  type PlacementResolver,
} from '../../services/fulfillment-readiness.service';
import { mappingKeyOf } from '../../shared/mapping-match';
import {CANCELLABLE_FULFILLMENT_STATUSES,
  SUBMITTABLE_FULFILLMENT_STATUSES,
  fulfillmentOrderLockKey,
  isNewAttemptOnSubmit,
} from '../../shared/fulfillment-lifecycle';
import { SellerwixApiClient } from '../clients/sellerwix-api.client';
import {
  CREATE_AMBIGUOUS_ERROR_CLASSES,
  RECONCILABLE_STATUSES,
  isNeverArrived,
  isQuietReconcileFailure,
  isRateLimited,
} from '../../shared/fulfillment-reconcile';
import {
  SELLERWIX_COST_CURRENCY_CONFIG_KEY,
  SELLERWIX_SHIPPING_METHOD_CACHE_MS,
  SELLERWIX_STATUS_MESSAGE_CODE,
} from '../constants/sellerwix.constants';
import {
  SellerwixOrderMapper,
  sellerwixPrintAreasOf,
  type SellerwixResolvedLine,
} from '../mappers/sellerwix-order.mapper';
import type {
  SellerwixOrder,
  SellerwixShippingMethod,
  SellerwixVariant,
  SellerwixVariantPrintArea,
} from '../types/sellerwix-api.types';
import {
  SellerwixCredentialService,
  type SellerwixCallContext,
} from './sellerwix-credential.service';

const PROVIDER = FulfillmentProvider.SELLERWIX;
const LABEL = FULFILLMENT_PROVIDER_LABELS.SELLERWIX;

/**
 * Trạng thái phía Sellerwix nghĩa là "đã nhận yêu cầu huỷ, đang xử lý" (tài liệu: `cancel processing`,
 * ánh xạ ON_HOLD). Gửi thêm một yêu cầu huỷ lúc này là thừa — và không được coi là đã huỷ.
 */
const CANCEL_PENDING_PROVIDER_STATUS = 'cancel processing';

/** Dùng CHUNG khoá với Mango: hai nhà cung cấp không thể nhận cùng một đơn song song. */
const FULFILL_LOCK_MS = 60_000;


/** Thông tin biến thể đã đồng bộ, đọc từ `fulfillment_variants.raw_data`. */
interface CatalogVariant {
  status: FulfillmentCatalogItemStatus;
  printAreas: SellerwixVariantPrintArea[];
  isRushService: boolean | null;
}

/**
 * SellerwixFulfillmentService — adapter của Sellerwix.
 *
 * ```
 *  Push/Retry ─▶ khoá phân tán ─▶ readiness (ánh xạ · design · địa chỉ) ─▶ kiểm payload
 *     ─▶ GET /v1/order/{reference_id}?store_id  ──có──▶ LIÊN KẾT đơn đã có (không tạo lại)
 *                                               └không─▶ POST /v1/order ─▶ SUBMITTED
 *     timeout / 5xx ─▶ tra lại reference_id NGAY ─▶ có thì liên kết, không thì FAILED (retry an toàn)
 * ```
 *
 * 🔴 Idempotency: tài liệu KHÔNG nói Sellerwix từ chối `reference_id` trùng. Vì vậy KHÔNG dựa vào
 * phía nhà cung cấp như Mango, mà TỰ tra theo `reference_id` (mã đơn TikTok) trước mỗi lần tạo.
 */
@Injectable()
export class SellerwixFulfillmentService implements FulfillmentProviderAdapter {
  readonly provider = PROVIDER;

  private readonly logger = new Logger(SellerwixFulfillmentService.name);
  private readonly shippingCache = new Map<
    string,
    { at: number; methods: SellerwixShippingMethod[] }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly readiness: FulfillmentReadinessService,
    private readonly client: SellerwixApiClient,
    private readonly mapper: SellerwixOrderMapper,
    private readonly credentials: SellerwixCredentialService,
    private readonly lock: DistributedLockService,
  ) {}

  // ---------------------------------------------------------------------------
  // Gửi đơn / Retry
  // ---------------------------------------------------------------------------

  async fulfill(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger,
    options: FulfillOptionsInput,
  ): Promise<FulfillmentOrderWithRelations> {
    const done = await this.lock.withLock(
      fulfillmentOrderLockKey(podOrderId),
      FULFILL_LOCK_MS,
      () => this.fulfillLocked(organizationId, actorUserId, podOrderId, trigger, options),
    );
    if (!done) throw new FulfillmentAlreadySubmittedException(FulfillmentStatus.SUBMITTING);
    return done;
  }

  private async fulfillLocked(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    trigger: FulfillmentTrigger,
    options: FulfillOptionsInput,
  ): Promise<FulfillmentOrderWithRelations> {
    this.rejectUnsupportedOptions(options);

    const current = await this.repo.findByPodOrder(organizationId, podOrderId, PROVIDER);
    if (current && !SUBMITTABLE_FULFILLMENT_STATUSES.includes(current.status)) {
      throw new FulfillmentAlreadySubmittedException(current.status);
    }
    // Bản ghi đã HUỶ (Sellerwix đã xác nhận) ⇒ LẦN THỬ MỚI: lưu trữ bản ghi cũ và gửi với
    // `reference_id` mới. Dùng lại mã cũ thì bước tra idempotency bên dưới sẽ tìm thấy chính đơn
    // đã huỷ và "liên kết" lại nó thay vì tạo đơn mới.
    const existing = current && !isNewAttemptOnSubmit(current.status) ? current : null;
    const other = await this.repo.findBlockingRecordOfOtherProvider(
      organizationId,
      podOrderId,
      PROVIDER,
    );
    if (other) {
      throw new FulfillmentSubmittedToOtherProviderException(
        FULFILLMENT_PROVIDER_LABELS[other.provider],
        other.status,
      );
    }

    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();

    const account = await this.requireSellerwixAccount(
      organizationId,
      options.fulfillmentAccountId,
    );
    // Thiếu API Key, hoặc thiếu Store ID (field bắt buộc `store_id` của Create Order) ⇒ báo NGAY,
    // trước khi chạm dữ liệu đơn.
    const ctx = this.credentials.buildContext(account);
    const storeId = this.credentials.requireStoreId(ctx);

    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    const designsByKey = await this.loadDesignsByKey(organizationId);
    const variants = await this.loadCatalogVariants(account, mappings);
    const check = this.readiness.check(
      order,
      mappings,
      designsByKey,
      this.publicBaseUrl(),
      account.id,
      this.buildResolver(variants),
    );
    if (!check.ready || !check.address || !check.items?.length) {
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

    if (current && !existing) {
      await this.repo.supersedeCancelled(current, actorUserId, trigger);
    }
    const referenceId =
      existing?.externalOrderId ??
      this.mapper.buildReferenceId(
        order.tiktokOrderId,
        (await this.repo.countAttempts(organizationId, podOrderId, PROVIDER)) + 1,
      );
    const shippingMethod =
      options.shippingMethod?.trim() || account.defaultShippingMethod?.trim() || null;
    const labelUrl = options.labelUrl ?? order.shippingLabelUrl ?? null;
    const note = options.note ?? order.sellerNote ?? null;
    const rushService = options.rushService === true;

    const record =
      existing ??
      (await this.repo.createDraft({
        organizationId,
        accountId: account.id,
        provider: PROVIDER,
        podOrderId,
        externalOrderId: referenceId,
        shippingMethod,
        createdBy: actorUserId,
      }));

    const storedItems = await this.repo.replaceItems(
      record.id,
      organizationId,
      check.items.map((item) => ({
        podOrderItemId: item.podOrderItemId,
        providerSku: item.providerSku,
        quantity: item.quantity,
        productionConfig: null,
        baseCost: item.baseCost,
        printFiles: item.printFiles as unknown as Prisma.InputJsonValue,
      })),
    );
    const itemIdByPodItem = new Map(storedItems.map((row) => [row.podOrderItemId ?? '', row.id]));
    const lines: SellerwixResolvedLine[] = check.items.map((item) => ({
      itemId: itemIdByPodItem.get(item.podOrderItemId) ?? item.podOrderItemId,
      referenceId: item.tiktokLineItemId ?? item.podOrderItemId,
      sku: item.providerSku,
      quantity: item.quantity,
      printAreas: item.printFiles,
    }));

    // Kiểm TRƯỚC khi gọi nhà cung cấp: mọi thứ bắt được ở đây rẻ hơn và nói rõ hơn một HTTP 400.
    try {
      await this.assertPayloadValid(ctx, {
        referenceId,
        lines,
        variants,
        shippingMethod,
        country: check.address.country,
        labelUrl,
        rushService,
      });
    } catch (error) {
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.VALIDATION_FAILED,
        trigger,
        success: false,
        message: (error as Error).message.slice(0, 2000),
        performedBy: actorUserId,
      });
      throw error;
    }

    // --- Idempotency: đơn với reference_id này đã có ở Sellerwix chưa? ---
    let found: SellerwixOrder | null;
    try {
      found = await this.findByReference(ctx, referenceId);
    } catch (error) {
      // Không xác định được ⇒ TUYỆT ĐỐI không tạo (có thể đã có). Retry sau sẽ tra lại.
      await this.recordFailure(
        organizationId,
        record.id,
        'create.lookup',
        trigger,
        actorUserId,
        error,
        FulfillmentEventType.CREATE_FAILED,
      );
      throw toProviderHttpException(LABEL, error);
    }
    if (found) {
      await this.adoptExisting(record, found, trigger, actorUserId, 'Đơn đã tồn tại ở Sellerwix');
      return this.requireRecord(organizationId, record.id);
    }

    const request = this.mapper.buildCreateOrderRequest({
      storeId,
      referenceId,
      address: check.address,
      lines,
      shippingMethod: shippingMethod as string,
      labelUrl,
      note,
      rushService,
    });

    await this.repo.updateOrder(record.id, {
      status: FulfillmentStatus.SUBMITTING,
      attemptCount: { increment: 1 },
      // Đơn vị tiền của giá vốn: theo catalog (đồng bộ từ cấu hình SELLERWIX_COST_CURRENCY); catalog
      // cũ chưa đồng bộ lại ⇒ chính cấu hình đó. API Sellerwix không trả đơn vị tiền — xem
      // `costCurrency()`.
      currency:
        (await this.catalogRepo.findCostCurrency(
          account.id,
          check.items.map((item) => item.providerSku),
        )) ?? this.costCurrency(),
      shippingMethod,
      productionLine: null,
      facility: null,
      speedType: null,
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
      message: `Gửi ${lines.length} sản phẩm sang ${LABEL} (reference_id=${referenceId})`,
      payload: { referenceId, itemCount: lines.length, shippingMethod, rushService },
      performedBy: actorUserId,
    });

    // 🔴 Chỉ LỜI GỌI tạo đơn quyết định "Sellerwix có nhận hay không". Bước SAU khi Sellerwix đã nhận
    // (ghi DB, nhật ký, lấy giá vốn) hỏng KHÔNG được đánh FAILED — FAILED mở nút gửi lại.
    let result: Awaited<ReturnType<SellerwixApiClient['createOrder']>>;
    try {
      result = await this.client.createOrder(ctx, request);
    } catch (error) {
      if (
        error instanceof FulfillmentClientError &&
        CREATE_AMBIGUOUS_ERROR_CLASSES.includes(error.errorClass)
      ) {
        // Request có thể ĐÃ tới nơi. Tra lại NGAY theo reference_id trước khi kết luận thất bại.
        const outcome = await this.tryAdoptAfterAmbiguousError(
          ctx,
          record,
          referenceId,
          trigger,
          actorUserId,
          error,
        );
        if (outcome === 'ADOPTED') return this.requireRecord(organizationId, record.id);
        if (outcome === 'UNKNOWN') throw new FulfillmentReconciliationPendingException(LABEL, referenceId);
      }
      await this.recordFailure(
        organizationId,
        record.id,
        'create',
        trigger,
        actorUserId,
        error,
        FulfillmentEventType.CREATE_FAILED,
      );
      throw toProviderHttpException(LABEL, error);
    }
    const providerOrderId = result.data?.id ? String(result.data.id) : null;

    try {
      await this.repo.updateOrder(record.id, {
        status: FulfillmentStatus.SUBMITTED,
        providerOrderId,
        rawResponse: (result.data ?? {}) as Prisma.InputJsonValue,
        lastRequestId: result.requestId,
        lastErrorCode: null,
        lastErrorMessage: null,
        submittedAt: new Date(),
        lastSyncedAt: new Date(),
        updatedBy: actorUserId,
      });
    } catch (error) {
      // Sellerwix ĐÃ nhận đơn nhưng ghi DB hỏng. Bản ghi còn SUBMITTING ⇒ bộ đồng bộ tra theo
      // reference_id và khôi phục (findOrdersToSync). KHÔNG đánh FAILED.
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.local-save',
        code: 'RECONCILIATION_REQUIRED',
        organizationId,
        podOrderId,
        fulfillmentOrderId: record.id,
        referenceId,
        providerOrderId,
        msg: `Sellerwix đã nhận đơn nhưng ghi DB local hỏng: ${(error as Error).message}`,
      });
      await this.safeHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.LOCAL_UPDATE_FAILED,
        trigger,
        success: false,
        message: `${LABEL} ĐÃ nhận đơn (mã ${providerOrderId ?? referenceId}) nhưng lưu kết quả hỏng — chờ đối soát tự động.`,
        payload: { providerOrderId, referenceId },
        performedBy: actorUserId,
      });
      throw new FulfillmentReconciliationPendingException(LABEL, referenceId);
    }

    // Từ đây đơn ĐÃ ở Sellerwix và đã ghi SUBMITTED. Bước phụ hỏng ⇒ ghi nhận, không hạ trạng thái.
    try {
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CREATE_SUCCESS,
        trigger,
        fromStatus: FulfillmentStatus.SUBMITTING,
        toStatus: FulfillmentStatus.SUBMITTED,
        message: `${LABEL} đã nhận đơn`,
        payload: { providerOrderId, referenceId },
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      await this.repo.touchAccountUsed(account.id);
    } catch (error) {
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.post',
        organizationId,
        fulfillmentOrderId: record.id,
        msg: `Đơn đã tạo ở Sellerwix, ghi nhật ký sau đó hỏng: ${(error as Error).message}`,
      });
    }

    this.logger.log({
      module: 'fulfillment',
      provider: PROVIDER,
      operation: 'create',
      organizationId,
      podOrderId,
      fulfillmentOrderId: record.id,
      referenceId,
      providerOrderId,
      requestId: result.requestId,
      durationMs: result.durationMs,
      msg: 'Tạo đơn Sellerwix thành công',
    });

    // Response tạo đơn chỉ có { id, reference_id } ⇒ hỏi chi tiết MỘT lần để có trạng thái + chi
    // phí. Hỏng thì để bộ đồng bộ định kỳ lo — đơn ĐÃ được nhận (refreshAfterCreate tự bắt lỗi).
    await this.refreshAfterCreate(
      organizationId,
      record.id,
      ctx,
      providerOrderId,
      referenceId,
      trigger,
      actorUserId,
    );

    return this.requireRecord(organizationId, record.id);
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ trạng thái
  // ---------------------------------------------------------------------------

  async syncOne(
    record: FulfillmentOrder,
    account: FulfillmentAccount,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<{ changed: boolean; apiCalls: number; rateLimited?: boolean }> {
    try {
      const ctx = this.credentials.buildContext(account);
      const result = record.providerOrderId
        ? await this.client.getOrder(ctx, record.providerOrderId)
        : await this.client.getOrderByReference(
            ctx,
            this.credentials.requireStoreId(ctx),
            record.externalOrderId,
          );
      const changed = await this.applyProviderState(record, result.data, trigger, {
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      return { changed, apiCalls: 1 };
    } catch (error) {
      // Đang chờ đối soát (SUBMITTING, chưa có mã Sellerwix) mà tra reference_id ra 404 ⇒ lần gửi đó
      // CHƯA từng tới nơi ⇒ FAILED (gửi lại an toàn: lần gửi lại vẫn tra trước khi tạo).
      if (isNeverArrived(record, error)) {
        await this.recordFailure(
          record.organizationId,
          record.id,
          'sync.reconcile',
          trigger,
          actorUserId,
          error,
          FulfillmentEventType.CREATE_FAILED,
        );
        return { changed: true, apiCalls: 1 };
      }
      // Đối soát một bản ghi FAILED mà vẫn không hỏi được ⇒ chỉ log (không phủ timeline mỗi 5 phút).
      if (isQuietReconcileFailure(record)) {
        this.logger.warn({
          module: 'fulfillment',
          provider: PROVIDER,
          operation: 'sync.reconcile',
          organizationId: record.organizationId,
          fulfillmentOrderId: record.id,
          errorClass: error instanceof FulfillmentClientError ? error.errorClass : 'UNKNOWN',
          msg: 'Đối soát bản ghi FAILED: nhà cung cấp chưa trả được đơn — giữ FAILED, thử lại lượt sau',
        });
        await this.repo.updateOrder(record.id, { lastSyncedAt: new Date() });
        return { changed: false, apiCalls: 1, rateLimited: isRateLimited(error) };
      }
      await this.recordFailure(
        record.organizationId,
        record.id,
        'sync',
        trigger,
        actorUserId,
        error,
        FulfillmentEventType.SYNC,
      );
      await this.repo.updateOrder(record.id, { lastSyncedAt: new Date() });
      return { changed: false, apiCalls: 1, rateLimited: isRateLimited(error) };
    }
  }

  async syncByPodOrder(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findByPodOrder(organizationId, podOrderId, PROVIDER);
    if (!record) throw new FulfillmentOrderNotFoundException();
    const account = await this.requireAccountById(organizationId, record.accountId);
    await this.syncOne(record, account, FulfillmentTrigger.MANUAL, actorUserId);
    return this.requireRecord(organizationId, record.id);
  }

  /**
   * Áp trạng thái/tracking/chi phí từ MỘT object đơn của Sellerwix (Get order details, Cancel,
   * hoặc `data` của webhook — tài liệu: cùng cấu trúc với /order/{id}).
   * Một chỗ duy nhất quyết định chuyển trạng thái cho mọi đường vào.
   */
  async applyProviderState(
    record: FulfillmentOrder,
    detail: SellerwixOrder | null,
    trigger: FulfillmentTrigger,
    meta: { durationMs?: number; requestId?: string; performedBy?: string } = {},
  ): Promise<boolean> {
    if (!detail) return false;

    const detailId = detail.id ? String(detail.id) : null;
    if (record.providerOrderId && detailId && detailId !== record.providerOrderId) {
      // Không bao giờ áp dữ liệu của đơn khác lên bản ghi này.
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'apply-state',
        fulfillmentOrderId: record.id,
        msg: 'Bỏ qua dữ liệu Sellerwix: id đơn không khớp bản ghi',
      });
      return false;
    }

    const summary = this.mapper.summarizeStatus(detail);
    const tracking = this.mapper.latestTracking(detail);
    const costs = this.mapper.orderCosts(detail);
    // Bản ghi gửi trước khi có cấu hình đơn vị tiền ⇒ điền khi đồng bộ (giá vốn Sellerwix luôn tính
    // bằng MỘT đơn vị tiền). Đã có thì giữ nguyên — không ghi đè.
    const missingCurrency = record.currency ? null : this.costCurrency();

    const statusChanged =
      summary.status !== record.status || summary.providerStatus !== record.providerStatus;
    const trackingChanged = (tracking?.trackingNumber ?? null) !== record.trackingNumber;
    // Sellerwix TRẢ ĐƯỢC đơn này ⇒ đơn đang ở nhà cung cấp. Bản ghi FAILED / SUBMITTING (lỗi local,
    // timeout, hoặc bị hạ sai) ⇒ khôi phục mốc gửi + xoá lỗi cũ.
    const reconciled = RECONCILABLE_STATUSES.includes(record.status);

    await this.repo.updateOrder(record.id, {
      status: summary.status,
      providerStatus: summary.providerStatus,
      providerOrderId: record.providerOrderId ?? detailId,
      trackingNumber: tracking?.trackingNumber ?? record.trackingNumber,
      trackingStatus: tracking?.listingStatus ?? record.trackingStatus,
      trackingUrl: tracking?.trackingUrl ?? record.trackingUrl,
      carrier: tracking?.carrier ?? record.carrier,
      labelUrl: detail.label_url?.trim() || record.labelUrl,
      // Không có số mới thì GIỮ số cũ — "chưa báo giá" khác "giá bằng 0".
      subtotal: this.toDecimal(costs.subtotal) ?? record.subtotal,
      shippingFee: this.toDecimal(costs.shippingFee) ?? record.shippingFee,
      total: this.toDecimal(costs.total) ?? record.total,
      ...(missingCurrency ? { currency: missingCurrency } : {}),
      ...(reconciled ? { submittedAt: record.submittedAt ?? new Date() } : {}),
      rawResponse: this.mapper.maskOrderForStorage(detail) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
      ...(summary.message
        ? { lastErrorCode: SELLERWIX_STATUS_MESSAGE_CODE, lastErrorMessage: summary.message }
        : record.lastErrorCode === SELLERWIX_STATUS_MESSAGE_CODE || reconciled
          ? { lastErrorCode: null, lastErrorMessage: null }
          : {}),
      ...(summary.status === FulfillmentStatus.CANCELLED && !record.cancelledAt
        ? { cancelledAt: new Date() }
        : {}),
    });

    await this.applyLineCosts(record, detail);

    if (reconciled) {
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CREATE_SUCCESS,
        trigger,
        fromStatus: record.status,
        toStatus: summary.status,
        providerStatus: summary.providerStatus,
        message:
          `Đối soát: đơn ${record.externalOrderId} ĐANG ở ${LABEL} (${summary.providerStatus ?? '—'}) — khôi phục ` +
          `trạng thái thật thay cho ${record.status}, không tạo đơn mới`,
        payload: { providerOrderId: record.providerOrderId ?? detailId, reconciled: true },
        durationMs: meta.durationMs,
        requestId: meta.requestId,
        performedBy: meta.performedBy,
      });
    }

    if (statusChanged) {
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.STATUS_CHANGED,
        trigger,
        fromStatus: record.status,
        toStatus: summary.status,
        providerStatus: summary.providerStatus,
        message:
          `Trạng thái đổi: ${record.providerStatus ?? '—'} → ${summary.providerStatus ?? '—'}` +
          (summary.message ? ` · ${summary.message}` : ''),
        durationMs: meta.durationMs,
        requestId: meta.requestId,
        performedBy: meta.performedBy,
      });
    }
    if (trackingChanged && tracking) {
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.SHIPMENT_UPDATED,
        trigger,
        providerStatus: summary.providerStatus,
        message: `Có mã vận đơn: ${tracking.trackingNumber}`,
        payload: {
          trackingNumber: tracking.trackingNumber,
          carrier: tracking.carrier,
          trackingUrl: tracking.trackingUrl,
          listingStatus: tracking.listingStatus,
        },
        performedBy: meta.performedBy,
      });
    }
    return statusChanged || trackingChanged;
  }

  // ---------------------------------------------------------------------------
  // Huỷ
  // ---------------------------------------------------------------------------

  async cancel(
    organizationId: string,
    actorUserId: string,
    podOrderId: string,
    reason?: string,
    actorRole?: string,
  ): Promise<FulfillmentOrderWithRelations> {
    const record = await this.repo.findByPodOrder(organizationId, podOrderId, PROVIDER);
    if (!record) throw new FulfillmentOrderNotFoundException();
    if (!CANCELLABLE_FULFILLMENT_STATUSES.includes(record.status) || !record.providerOrderId) {
      throw new FulfillmentCannotCancelException(record.status);
    }

    const account = await this.requireAccountById(organizationId, record.accountId);
    const ctx = this.credentials.buildContext(account);

    // 🔴 Hỏi trạng thái THẬT trước khi huỷ — đơn có thể đã vào xưởng / đã ship sau lượt đồng bộ
    // gần nhất. Áp vào bản ghi (cùng `applyProviderState` của đồng bộ) rồi mới quyết.
    let live: FulfillmentOrder;
    try {
      const detail = await this.client.getOrder(ctx, record.providerOrderId);
      await this.applyProviderState(record, detail.data, FulfillmentTrigger.MANUAL, {
        durationMs: detail.durationMs,
        requestId: detail.requestId,
        performedBy: actorUserId,
      });
      live = await this.requireRecord(organizationId, record.id);
    } catch (error) {
      await this.recordFailure(
        organizationId,
        record.id,
        'cancel.lookup',
        FulfillmentTrigger.MANUAL,
        actorUserId,
        error,
        FulfillmentEventType.CANCEL_FAILED,
      );
      throw toProviderHttpException(LABEL, error);
    }
    if (live.providerStatus?.toLowerCase().includes(CANCEL_PENDING_PROVIDER_STATUS)) {
      throw new FulfillmentCancelPendingException(LABEL);
    }
    if (!CANCELLABLE_FULFILLMENT_STATUSES.includes(live.status)) {
      throw new FulfillmentCannotCancelException(live.providerStatus ?? live.status);
    }

    await this.repo.addHistory({
      organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.CANCEL_REQUEST,
      trigger: FulfillmentTrigger.MANUAL,
      fromStatus: record.status,
      message: reason ? `Yêu cầu huỷ: ${reason}` : 'Yêu cầu huỷ đơn',
      // Audit: ai (performedBy) với vai trò gì huỷ, vì lý do gì — truy vết được Seller nào đã huỷ.
      payload: { reason: reason ?? null, actorRole: actorRole ?? null },
      performedBy: actorUserId,
    });

    try {
      const result = await this.client.cancelOrder(ctx, record.providerOrderId, {
        ...(reason ? { reason } : {}),
      });
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CANCEL_SUCCESS,
        trigger: FulfillmentTrigger.MANUAL,
        fromStatus: live.status,
        // "Đã nhận yêu cầu" ≠ "đã huỷ": trạng thái thật (canceled / cancel processing) được áp ngay
        // dưới đây; chỉ CANCELLED mới mở lại được nút Fulfill.
        message: `${LABEL} đã nhận yêu cầu huỷ`,
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      // Response Cancel order = object đơn (tài liệu) ⇒ trạng thái thật (canceled / cancel processing).
      await this.applyProviderState(live, result.data, FulfillmentTrigger.MANUAL, {
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
      throw toProviderHttpException(LABEL, error);
    }
    return this.requireRecord(organizationId, record.id);
  }

  // ---------------------------------------------------------------------------
  // Test Connection
  // ---------------------------------------------------------------------------

  /**
   * `GET /v1/category` với header `X-Api-Key` — endpoint chỉ đọc; thành công ⇒ API Key dùng được
   * với Public API. CHỈ cần API Key.
   *
   * ⚠️ Store ID KHÔNG kiểm được: tài liệu không có endpoint đọc thông tin store. Sai Store ID chỉ
   * lộ ra khi tạo đơn (thông điệp của Sellerwix được trả nguyên văn).
   */
  async testConnection(account: FulfillmentAccount): Promise<ProviderConnectionResult> {
    const startedAt = Date.now();
    try {
      const ctx = this.credentials.buildContext(account);
      const categories = await this.client.listCategories(ctx);
      const categoryCount = Array.isArray(categories.data) ? categories.data.length : 0;
      await this.repo.updateAccount(account.id, { lastUsedAt: new Date(), lastErrorMsg: null });
      return {
        connected: true,
        message: 'Connected',
        durationMs: Date.now() - startedAt,
        productionLineCount: null,
        categoryCount,
      };
    } catch (error) {
      const message = (error as Error).message || `Không kết nối được tới ${LABEL}`;
      await this.repo.updateAccount(account.id, {
        lastErrorAt: new Date(),
        lastErrorMsg: message.slice(0, 1000),
      });
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'account.testConnection',
        accountId: account.id,
        errorClass: error instanceof FulfillmentClientError ? error.errorClass : 'UNKNOWN',
        httpStatus: error instanceof FulfillmentClientError ? error.httpStatus : undefined,
        msg: `Kiểm tra kết nối thất bại: ${message}`,
      });
      return {
        connected: false,
        message,
        durationMs: null,
        productionLineCount: null,
        categoryCount: null,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Vị trí in & phương thức vận chuyển (phục vụ readiness + màn hình Fulfill)
  // ---------------------------------------------------------------------------

  async placementResolver(
    account: FulfillmentAccount,
    mappings: MappingWithDesigns[],
  ): Promise<PlacementResolver> {
    return this.buildResolver(await this.loadCatalogVariants(account, mappings));
  }

  /**
   * Phương thức vận chuyển mọi SKU của đơn cùng hỗ trợ, giao được tới quốc gia người nhận.
   * Dòng hàng chưa ánh xạ cho tài khoản này ⇒ cảnh báo (chưa biết SKU thì chưa hỏi được).
   */
  async shippingMethods(
    account: FulfillmentAccount,
    order: PodOrderWithRelations,
    mappings: MappingWithDesigns[],
  ): Promise<ProviderShippingMethods> {
    const warnings: string[] = [];
    const skus = new Set<string>();
    for (const item of order.items) {
      const key = mappingKeyOf(item.productId, item.sellerSku);
      const mapping = key
        ? mappings.find(
            (entry) =>
              entry.isActive && mappingKeyOf(entry.tiktokProductId, entry.sellerSku) === key,
          )
        : undefined;
      const label = item.productName ?? item.sellerSku ?? item.id;
      if (!mapping) {
        warnings.push(
          `"${label}" chưa được cấu hình sản phẩm ${LABEL} — chọn Provider Product / biến thể ở khối ` +
            '"Cấu hình sản phẩm" rồi lưu để lấy phương thức vận chuyển.',
        );
        continue;
      }
      if (mapping.accountId !== account.id) {
        // 🔴 Ánh xạ là MỘT bản ghi cho mỗi sản phẩm (không theo nhà cung cấp). Đang trỏ sang nhà
        // cung cấp khác (vd Mango) ⇒ chưa có SKU Sellerwix để hỏi — nói rõ thay vì "chưa có ánh xạ".
        warnings.push(
          `"${label}" đang được cấu hình cho nhà cung cấp khác — lưu cấu hình sản phẩm ${LABEL} ` +
            '(Provider Product / biến thể) cho sản phẩm này để lấy phương thức vận chuyển.',
        );
        continue;
      }
      skus.add(mapping.providerSku);
    }
    if (skus.size === 0) return { options: [], warnings };

    try {
      const ctx = this.credentials.buildContext(account);
      const perVariant = await Promise.all(
        [...skus].map((sku) => this.shippingMethodsOf(ctx, sku)),
      );
      const options = this.mapper
        .intersectShippingMethods(perVariant, order.recipientRegionCode)
        .map((method) => ({
          value: method.code,
          // Nhãn = tên (+ hãng). KHÔNG đưa `type` (domestic / international / both — giá trị kỹ thuật,
          // đã dùng để lọc theo quốc gia người nhận ở bước trên) ra giao diện.
          label: [method.name, method.carrier].filter(Boolean).join(' · '),
        }));
      if (options.length === 0) {
        warnings.push(
          'Không có phương thức vận chuyển nào mà MỌI sản phẩm trong đơn cùng hỗ trợ và giao được tới quốc gia người nhận.',
        );
      }
      return { options, warnings };
    } catch (error) {
      warnings.push(
        `Chưa lấy được phương thức vận chuyển từ ${LABEL}: ${(error as Error).message}`,
      );
      return { options: [], warnings };
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Sellerwix KHÔNG có production line / facility / speed type / preferred carrier / scan label. */
  private rejectUnsupportedOptions(options: FulfillOptionsInput): void {
    const unsupported = [
      options.facility ? 'facility' : null,
      options.speedType ? 'speedType' : null,
      options.preferredCarrier ? 'preferredCarrier' : null,
      options.isScanLabel ? 'isScanLabel' : null,
    ].filter((field): field is string => field !== null);
    if (unsupported.length === 0) return;
    throw new FulfillmentValidationException(
      `${LABEL} không hỗ trợ: ${unsupported.join(', ')} — bỏ các tuỳ chọn này rồi gửi lại.`,
      unsupported.map((field) => ({ field, message: `${LABEL} API không có field tương ứng.` })),
    );
  }

  private async assertPayloadValid(
    ctx: SellerwixCallContext,
    params: {
      referenceId: string;
      lines: SellerwixResolvedLine[];
      variants: Map<string, CatalogVariant>;
      shippingMethod: string | null;
      country: string;
      labelUrl: string | null;
      rushService: boolean;
    },
  ): Promise<void> {
    const errors: Array<{ field: string; message: string }> = [];

    if (params.referenceId.length === 0 || params.referenceId.length > 40) {
      errors.push({ field: 'reference_id', message: 'Mã đơn TikTok rỗng hoặc dài quá 40 ký tự.' });
    }
    if (!/^[A-Z]{2}$/i.test(params.country)) {
      errors.push({
        field: 'address.country',
        message: `Quốc gia người nhận phải là mã ISO 3166-1 hai chữ (đang là "${params.country}").`,
      });
    }

    params.lines.forEach((line, index) => {
      const variant = params.variants.get(line.sku);
      if (!line.sku.trim()) {
        errors.push({
          field: `line_items[${index}].sku`,
          message: 'Chưa có SKU biến thể Sellerwix.',
        });
      } else if (variant && variant.status !== FulfillmentCatalogItemStatus.ACTIVE) {
        errors.push({
          field: `line_items[${index}].sku`,
          message: `SKU ${line.sku} đang ${variant.status} trong danh mục Sellerwix (active=false hoặc không còn trả về).`,
        });
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        errors.push({
          field: `line_items[${index}].quantity`,
          message: `Số lượng phải là số nguyên ≥ 1 (đang là ${line.quantity}).`,
        });
      }
      if (line.printAreas.length === 0) {
        errors.push({ field: `line_items[${index}].print_areas`, message: 'Chưa có file in nào.' });
      }
      line.printAreas.forEach((area, areaIndex) => {
        if (!/^https?:\/\//i.test(area.url)) {
          errors.push({
            field: `line_items[${index}].print_areas[${areaIndex}].url`,
            message: 'File in phải là URL http(s) công khai để Sellerwix tải được.',
          });
        }
      });
      if (params.rushService && variant?.isRushService !== true) {
        errors.push({
          field: 'rush_service',
          message: variant
            ? `SKU ${line.sku} không hỗ trợ rush service (is_rush_service=false).`
            : `Chưa có SKU ${line.sku} trong danh mục đã đồng bộ nên không xác nhận được rush service — đồng bộ danh mục Sellerwix trước.`,
        });
      }
    });

    if (params.labelUrl && !/^https?:\/\//i.test(params.labelUrl)) {
      errors.push({
        field: 'label_url',
        message: 'Nhãn vận chuyển phải là URL http(s) công khai.',
      });
    }

    if (!params.shippingMethod) {
      errors.push({
        field: 'shipping_method',
        message:
          'Chọn phương thức vận chuyển — Sellerwix bắt buộc `shipping_method` cho từng dòng hàng.',
      });
    } else if (errors.length === 0) {
      // Chỉ tốn lời gọi API khi mọi thứ khác đã đúng.
      const perVariant = await Promise.all(
        [...new Set(params.lines.map((line) => line.sku))].map((sku) =>
          this.shippingMethodsOf(ctx, sku),
        ),
      );
      const allowed = this.mapper.intersectShippingMethods(perVariant, params.country);
      if (!allowed.some((method) => method.code === params.shippingMethod)) {
        errors.push({
          field: 'shipping_method',
          message:
            `Phương thức "${params.shippingMethod}" không được mọi SKU trong đơn hỗ trợ tới ${params.country}. ` +
            `Hợp lệ: ${allowed.map((method) => method.code).join(', ') || '(không có)'}.`,
        });
      }
    }

    if (errors.length === 0) return;
    throw new FulfillmentValidationException(
      `Dữ liệu gửi ${LABEL} chưa hợp lệ: ${errors.map((error) => `${error.field} — ${error.message}`).join(' · ')}`,
      errors,
    );
  }

  /**
   * Tra đơn theo `reference_id`. 404 ⇒ `null` (chưa có). Lỗi khác ⇒ ném (KHÔNG coi là chưa có).
   */
  private async findByReference(
    ctx: SellerwixCallContext,
    referenceId: string,
  ): Promise<SellerwixOrder | null> {
    try {
      const result = await this.client.getOrderByReference(
        ctx,
        this.credentials.requireStoreId(ctx),
        referenceId,
      );
      return result.data?.id ? result.data : null;
    } catch (error) {
      if (
        error instanceof FulfillmentClientError &&
        error.errorClass === FulfillmentErrorClass.NOT_FOUND
      ) {
        return null;
      }
      throw error;
    }
  }

  private async tryAdoptAfterAmbiguousError(
    ctx: SellerwixCallContext,
    record: FulfillmentOrder,
    referenceId: string,
    trigger: FulfillmentTrigger,
    actorUserId: string,
    createError: FulfillmentClientError,
  ): Promise<'ADOPTED' | 'NOT_FOUND' | 'UNKNOWN'> {
    try {
      const found = await this.findByReference(ctx, referenceId);
      if (!found) return 'NOT_FOUND';
      await this.adoptExisting(
        record,
        found,
        trigger,
        actorUserId,
        'Lời gọi tạo đơn không nhận được phản hồi, nhưng Sellerwix ĐÃ có đơn',
      );
      return 'ADOPTED';
    } catch (error) {
      // Tra cũng hỏng ⇒ KHÔNG biết đơn đã tới chưa. Giữ SUBMITTING (giao diện không cho gửi lại) và
      // để bộ đồng bộ tra lại theo reference_id — có ⇒ khôi phục, 404 ⇒ FAILED.
      await this.safeHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.RECONCILIATION_REQUIRED,
        trigger,
        success: false,
        message:
          `${LABEL} không phản hồi rõ khi tạo đơn (${createError.errorClass}: ${createError.message}) và tra ` +
          `lại reference_id=${referenceId} cũng hỏng — chờ đối soát tự động, KHÔNG gửi lại.`,
        payload: { createErrorClass: createError.errorClass, lookupError: (error as Error).message },
        performedBy: actorUserId,
      });
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.reconcile',
        code: 'RECONCILIATION_REQUIRED',
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        referenceId,
        msg: 'Không xác định được Sellerwix đã nhận đơn hay chưa — giữ SUBMITTING chờ đối soát',
      });
      return 'UNKNOWN';
    }
  }

  /** Ghi nhật ký mà KHÔNG để lỗi ghi nhật ký che mất lỗi gốc. */
  private async safeHistory(entry: Parameters<FulfillmentRepository['addHistory']>[0]): Promise<void> {
    try {
      await this.repo.addHistory(entry);
    } catch {
      // DB đang hỏng — log có cấu trúc ở nơi gọi đã đủ để đối soát.
    }
  }

  /** Liên kết bản ghi với đơn ĐÃ có ở Sellerwix — không tạo đơn thứ hai. */
  private async adoptExisting(
    record: FulfillmentOrder,
    found: SellerwixOrder,
    trigger: FulfillmentTrigger,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const providerOrderId = String(found.id);
    await this.repo.updateOrder(record.id, {
      status: FulfillmentStatus.SUBMITTED,
      providerOrderId,
      lastErrorCode: null,
      lastErrorMessage: null,
      submittedAt: record.submittedAt ?? new Date(),
      updatedBy: actorUserId,
    });
    await this.repo.addHistory({
      organizationId: record.organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.CREATE_SUCCESS,
      trigger,
      fromStatus: record.status,
      toStatus: FulfillmentStatus.SUBMITTED,
      message: `${reason} (reference_id=${record.externalOrderId}) — KHÔNG tạo lại, đã liên kết đơn ${providerOrderId}.`,
      payload: { providerOrderId, referenceId: record.externalOrderId, adopted: true },
      performedBy: actorUserId,
    });
    const fresh = await this.repo.findById(record.organizationId, record.id);
    if (fresh) {
      await this.applyProviderState(fresh, found, trigger, { performedBy: actorUserId });
    }
  }

  private async refreshAfterCreate(
    organizationId: string,
    fulfillmentOrderId: string,
    ctx: SellerwixCallContext,
    providerOrderId: string | null,
    referenceId: string,
    trigger: FulfillmentTrigger,
    actorUserId: string,
  ): Promise<void> {
    const record = await this.repo.findById(organizationId, fulfillmentOrderId);
    if (!record) return;
    try {
      const result = providerOrderId
        ? await this.client.getOrder(ctx, providerOrderId)
        : await this.client.getOrderByReference(ctx, this.credentials.requireStoreId(ctx), referenceId);
      await this.applyProviderState(record, result.data, trigger, {
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
    } catch (error) {
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.refresh',
        organizationId,
        fulfillmentOrderId,
        msg: `Chưa đọc được chi tiết đơn ngay sau khi tạo, để lượt đồng bộ sau: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Chi phí từng dòng: ghép theo `line_items[].reference_id` (= id line item TikTok đã gửi), rồi theo
   * `id` dòng Sellerwix đã liên kết ở lần trước (`provider_item_id`), lùi về SKU CHỈ khi SKU đó xuất
   * hiện đúng một lần ở cả hai phía — nhập nhằng thì không ghi.
   *
   * Giá vốn = `item_cost` của ĐÚNG dòng biến thể đã gửi (`line_items[].sku` = SKU biến thể của
   * Product Mapping), không phải giá chung của sản phẩm. Ghi xong ⇒ `base_cost_confirmed_at` được
   * đặt (xem `applyProviderItemCosts`) — chính là điều kiện để cột Lợi nhuận và Dashboard tính.
   *
   * Dòng nào KHÔNG ghép được / Sellerwix chưa báo giá ⇒ cảnh báo có cấu trúc (kèm lý do) để đối
   * soát; lượt đồng bộ sau (scheduler, webhook, `scripts/reconcile-base-cost.ts`) ghép lại.
   */
  private async applyLineCosts(record: FulfillmentOrder, detail: SellerwixOrder): Promise<void> {
    const providerLines = this.mapper.lineCosts(detail);
    if (providerLines.length === 0) return;
    const rows = await this.repo.listItemsWithLineRef(record.id);
    if (rows.length === 0) return;

    const byReference = new Map(
      providerLines.filter((line) => line.referenceId).map((line) => [line.referenceId, line]),
    );
    const byProviderItemId = new Map(
      providerLines.filter((line) => line.providerItemId).map((line) => [line.providerItemId, line]),
    );
    const count = <T>(values: T[]) =>
      values.reduce(
        (map, value) => map.set(value, (map.get(value) ?? 0) + 1),
        new Map<T, number>(),
      );
    const providerSkuCount = count(providerLines.map((line) => line.sku));
    const localSkuCount = count(rows.map((row) => row.providerSku));

    const matches = rows.map((row) => {
      const reference = row.podOrderItem?.tiktokLineItemId ?? row.podOrderItemId ?? null;
      const matched =
        (reference ? byReference.get(reference) : undefined) ??
        (row.providerItemId ? byProviderItemId.get(row.providerItemId) : undefined) ??
        (localSkuCount.get(row.providerSku) === 1 && providerSkuCount.get(row.providerSku) === 1
          ? providerLines.find((line) => line.sku === row.providerSku)
          : undefined);
      return { row, matched };
    });
    await this.repo.applyProviderItemCosts(
      record.id,
      matches.map(({ row, matched }) => ({
        id: row.id,
        baseCost: matched?.itemCost ?? null,
        color: null,
        size: null,
        providerItemId: matched?.providerItemId ?? null,
      })),
    );

    const allConfirmedNow = matches.every(
      ({ row, matched }) => (matched?.itemCost ?? null) !== null || row.baseCostConfirmedAt !== null,
    );
    if (allConfirmedNow && rows.some((row) => row.baseCostConfirmedAt === null)) {
      const total = matches.reduce(
        (sum, { row, matched }) => sum + Number(matched?.itemCost ?? row.baseCost ?? 0) * (row.quantity || 1),
        0,
      );
      await this.repo.addHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.BASE_COST_UPDATED,
        trigger: FulfillmentTrigger.CRON,
        message: `Giá vốn ${LABEL} đã xác nhận: ${Math.round(total * 10_000) / 10_000} (${rows.length} dòng)`,
        payload: { productCost: Math.round(total * 10_000) / 10_000, items: rows.length },
      });
    }

    // Chẩn đoán có cấu trúc — KHÔNG ghi API key, địa chỉ, tên/SĐT người mua.
    for (const { row, matched } of matches) {
      const baseCostAfter = matched?.itemCost ?? null;
      const before = row.baseCost === null ? null : Number(row.baseCost);
      const entry = {
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'base-cost.apply',
        organizationId: record.organizationId,
        shopId: row.podOrderItem?.order?.shopId ?? null,
        podOrderId: record.podOrderId,
        fulfillmentOrderId: record.id,
        fulfillmentOrderItemId: row.id,
        providerOrderId: record.providerOrderId ?? (detail.id ? String(detail.id) : null),
        providerItemId: matched?.providerItemId ?? row.providerItemId ?? null,
        // Sellerwix định danh biến thể bằng chính SKU biến thể (`external_variant_id = sku`).
        providerVariantId: row.providerSku,
        providerSku: row.providerSku,
        providerPrice: baseCostAfter,
        baseCostBefore: before,
        baseCostConfirmedBefore: row.baseCostConfirmedAt !== null,
        baseCostAfter: baseCostAfter ?? before,
      };
      if (baseCostAfter !== null) {
        this.logger.log({ ...entry, msg: 'Cập nhật giá vốn theo dữ liệu Sellerwix' });
      } else {
        this.logger.warn({
          ...entry,
          reason: matched ? 'PROVIDER_COST_MISSING' : 'LINE_NOT_MATCHED',
          providerLines: providerLines.length,
          msg: matched
            ? 'Sellerwix chưa báo item_cost cho dòng hàng — chờ lượt đồng bộ sau'
            : 'Không ghép được dòng Sellerwix (reference_id / id / SKU) — giá vốn chưa được xác nhận',
        });
      }
    }
  }

  /**
   * Đơn vị tiền của giá vốn Sellerwix — cấu hình `SELLERWIX_COST_CURRENCY` (API không trả đơn vị
   * tiền). Thiếu cấu hình ⇒ NULL: lợi nhuận báo COST_CURRENCY_UNKNOWN thay vì đoán.
   */
  private costCurrency(): string | null {
    return this.config.get<string>(SELLERWIX_COST_CURRENCY_CONFIG_KEY) || null;
  }

  private async shippingMethodsOf(
    ctx: SellerwixCallContext,
    variantSku: string,
  ): Promise<SellerwixShippingMethod[]> {
    const cacheKey = `${ctx.accountId}:${variantSku}`;
    const cached = this.shippingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SELLERWIX_SHIPPING_METHOD_CACHE_MS)
      return cached.methods;
    const result = await this.client.listShippingMethods(ctx, variantSku);
    const methods = this.mapper.shippingMethodsOfResponse(result.data);
    if (methods === null) {
      // Response không đúng dạng đã biết ⇒ KHÔNG cache (một lần lệch không được "đóng băng" danh
      // sách rỗng 10 phút) và nói rõ thay vì trả rỗng im lặng.
      this.logger.warn({
        module: 'fulfillment',
        provider: 'SELLERWIX',
        operation: 'shipping-methods.shape',
        accountId: ctx.accountId,
        variantSku,
        keys: result.data && typeof result.data === 'object' ? Object.keys(result.data) : typeof result.data,
        msg: 'Response Get shipping methods không đúng dạng đã biết (mảng hoặc { data: [] })',
      });
      throw new Error('Sellerwix trả về danh sách phương thức vận chuyển không đúng định dạng.');
    }
    // Rỗng thì không cache: có thể vừa cấu hình xong ở Sellerwix, bấm lại phải thấy ngay.
    if (methods.length > 0) this.shippingCache.set(cacheKey, { at: Date.now(), methods });
    return methods;
  }

  /** `print_areas` / trạng thái / rush của các biến thể ĐÃ ánh xạ cho tài khoản này. */
  private async loadCatalogVariants(
    account: FulfillmentAccount,
    mappings: MappingWithDesigns[],
  ): Promise<Map<string, CatalogVariant>> {
    const skus = [
      ...new Set(
        mappings
          .filter((mapping) => mapping.accountId === account.id && mapping.providerSku)
          .map((mapping) => mapping.providerSku),
      ),
    ];
    const rows = await this.catalogRepo.findVariantsForAccount(account.id, skus);
    return new Map(
      rows.map((row) => {
        const raw = (row.rawData ?? {}) as SellerwixVariant;
        return [
          row.sku,
          {
            status: row.status,
            printAreas: sellerwixPrintAreasOf(row.rawData),
            isRushService: typeof raw.is_rush_service === 'boolean' ? raw.is_rush_service : null,
          },
        ];
      }),
    );
  }

  private buildResolver(variants: Map<string, CatalogVariant>): PlacementResolver {
    return (placement, mapping) =>
      this.mapper.resolvePrintAreaKey(
        placement,
        mapping.placementMap,
        variants.get(mapping.providerSku)?.printAreas ?? [],
      );
  }

  private async requireSellerwixAccount(
    organizationId: string,
    accountId: string | null | undefined,
  ): Promise<FulfillmentAccount> {
    // Gateway LUÔN điền tài khoản; thiếu ở đây là lỗi lập trình, không phải lỗi người dùng.
    if (!accountId) throw new FulfillmentAccountNotFoundException();
    const account = await this.requireAccountById(organizationId, accountId);
    if (account.provider !== PROVIDER) throw new FulfillmentAccountNotFoundException();
    if (!account.isActive) throw new FulfillmentProviderInactiveException(account.name);
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

  /** Nhật ký + error log cho một lần thất bại (KHÔNG ghi thông tin xác thực hay PII). */
  private async recordFailure(
    organizationId: string,
    fulfillmentOrderId: string,
    operation: string,
    trigger: FulfillmentTrigger,
    actorUserId: string | undefined,
    error: unknown,
    // 🔴 BẮT BUỘC truyền: mặc định CREATE_FAILED khiến lỗi KHÔNG phải tạo đơn hạ đơn đã gửi về FAILED.
    eventType: FulfillmentEventType,
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
      provider: PROVIDER,
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
        endpoint: clientError.endpoint,
      },
      requestId: clientError.requestId,
      performedBy: actorUserId,
    });

    const summary = {
      lastErrorCode: (clientError.providerCode ?? clientError.errorClass).slice(0, 64),
      lastErrorMessage: `${LABEL}: ${clientError.message}`.slice(0, 2000),
      lastRequestId: clientError.requestId ?? null,
    };
    // Chỉ luồng TẠO mới hạ về FAILED; sync/cancel lỗi giữ nguyên trạng thái thật ở xưởng in.
    await this.repo.updateOrder(
      fulfillmentOrderId,
      eventType === FulfillmentEventType.CREATE_FAILED
        ? { status: FulfillmentStatus.FAILED, ...summary }
        : summary,
    );

    this.logger.error({
      module: 'fulfillment',
      provider: PROVIDER,
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

  private toDecimal(value: number | null): Prisma.Decimal | null {
    return value === null || !Number.isFinite(value) ? null : new Prisma.Decimal(value);
  }
}
