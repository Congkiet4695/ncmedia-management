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
import {
  FULFILLMENT_PROVIDER_LABELS,
  providerLabelOf,
} from '../../constants/fulfillment-provider.constants';
import {
  FulfillmentAccountNotFoundException,
  FulfillmentAlreadySubmittedException,
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
import type { NormalizedAddress } from '../../mango/mappers/mango-order.mapper';
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
import { findMappingForItem, rowKeyOf } from '../../shared/mapping-match';
import {
  CANCELLABLE_FULFILLMENT_STATUSES,
  SUBMITTABLE_FULFILLMENT_STATUSES,
  fulfillmentOrderLockKey,
  isNewAttemptOnSubmit,
} from '../../shared/fulfillment-lifecycle';
import {
  CREATE_AMBIGUOUS_ERROR_CLASSES,
  RECONCILABLE_STATUSES,
  isNeverArrived,
  isQuietReconcileFailure,
  isRateLimited,
} from '../../shared/fulfillment-reconcile';
import { reconcileProviderOrderNotFound } from '../../shared/fulfillment-provider-not-found';
import { PressifyApiClient } from '../clients/pressify-api.client';
import {
  PRESSIFY_CURRENCY,
  PRESSIFY_DEFAULT_HANDLING_TYPE,
  PRESSIFY_DTG_KEYS,
  PRESSIFY_DTG_STYLES,
  PRESSIFY_HANDLING_TYPES,
  PRESSIFY_PRINT_KEYS,
  PRESSIFY_PRINT_METHODS,
  PRESSIFY_REF_LOOKUP,
  PRESSIFY_SHIPPING_METHOD_LABELS,
  PRESSIFY_SHIPPING_METHODS,
  PRESSIFY_SINGLE_FILE_KEYS,
  PRESSIFY_STATUS_MESSAGE_CODE,
} from '../constants/pressify.constants';
import { PressifyOrderMapper, type PressifyResolvedLine } from '../mappers/pressify-order.mapper';
import type { PressifyOrder, PressifyVariant } from '../types/pressify-api.types';
import { PressifyCredentialService, type PressifyCallContext } from './pressify-credential.service';

const PROVIDER = FulfillmentProvider.PRESSIFY;
const LABEL = FULFILLMENT_PROVIDER_LABELS.PRESSIFY;

/** Dùng CHUNG khoá với Mango / Sellerwix: hai nhà cung cấp không thể nhận cùng một đơn song song. */
const FULFILL_LOCK_MS = 60_000;

/** Thông tin biến thể đã đồng bộ (`fulfillment_variants`), tra theo `variant_id`. */
interface CatalogVariant {
  status: FulfillmentCatalogItemStatus;
  /** Style của sản phẩm (T-shirt, Hoodie…) — kiểm điều kiện DTG. */
  style: string | null;
}

/** Thông điệp 422 của Pressify khi `ref_id` đã tồn tại (tài liệu, ví dụ response 422). */
const REF_TAKEN = /ref id has already been taken/i;

/**
 * PressifyFulfillmentService — adapter của Pressify Seller API.
 *
 * ```
 *  Push/Retry ─▶ khoá phân tán ─▶ readiness (ánh xạ · design · địa chỉ/nhãn) ─▶ kiểm payload theo tài liệu
 *     ─▶ POST /order ─▶ SUBMITTED ─▶ GET /order/{id} (trạng thái + chi phí)
 *     422 "ref id taken" ─▶ tra đơn theo ref_id ─▶ LIÊN KẾT đơn đã có (không tạo lại)
 *     timeout / 5xx      ─▶ tra đơn theo ref_id NGAY ─▶ có thì liên kết, không thì FAILED (gửi lại an toàn)
 * ```
 *
 * 🔴 Idempotency: tài liệu — `ref_id` "must be unique across Pressify"; gửi trùng ⇒ 422. Pressify KHÔNG có
 * endpoint tra theo `ref_id` ⇒ tra bằng GET /orders theo khoảng ngày tạo (tối đa 31 ngày) rồi so `ref_id`.
 *
 * 🔴 Giá vốn: Product Mapping → `base_cost` dòng hàng làm ảnh chụp lúc gửi (giá theo bậc nếu tài khoản khai
 * bậc). Số Pressify THỰC trừ (GET /order/{id} → `items[].price`, chỉ khi `payment_status = paid`) thay thế
 * và đánh dấu đã xác nhận — đúng luật chung của mọi nhà cung cấp, KHÔNG ghi đè giá vốn đã xác nhận bằng số tạm.
 */
@Injectable()
export class PressifyFulfillmentService implements FulfillmentProviderAdapter {
  readonly provider = PROVIDER;

  private readonly logger = new Logger(PressifyFulfillmentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly readiness: FulfillmentReadinessService,
    private readonly client: PressifyApiClient,
    private readonly mapper: PressifyOrderMapper,
    private readonly credentials: PressifyCredentialService,
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
    const choice = this.resolveOptions(options);

    const current = await this.repo.findByPodOrder(organizationId, podOrderId, PROVIDER);
    if (current && !SUBMITTABLE_FULFILLMENT_STATUSES.includes(current.status)) {
      throw new FulfillmentAlreadySubmittedException(current.status);
    }
    // Bản ghi đã HUỶ ⇒ LẦN THỬ MỚI với `ref_id` mới (ref_id cũ vẫn thuộc đơn đã huỷ ở Pressify).
    const existing = current && !isNewAttemptOnSubmit(current.status) ? current : null;
    const other = await this.repo.findBlockingRecordOfOtherProvider(
      organizationId,
      podOrderId,
      PROVIDER,
    );
    if (other) {
      throw new FulfillmentSubmittedToOtherProviderException(
        providerLabelOf(other.provider),
        other.status,
      );
    }

    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();

    const account = await this.requirePressifyAccount(organizationId, options.fulfillmentAccountId);
    const ctx = this.credentials.buildContext(account);

    const mappings = await this.repo.listMappingsForOrganization(organizationId);
    const designsByKey = await this.loadDesignsByKey(organizationId);
    const check = this.readiness.check(
      order,
      mappings,
      designsByKey,
      this.publicBaseUrl(),
      account.id,
      this.buildResolver(),
    );
    if (!check.ready || !check.items?.length) {
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
    const refId =
      existing?.externalOrderId ??
      this.mapper.buildRefId(
        order.tiktokOrderId,
        (await this.repo.countAttempts(organizationId, podOrderId, PROVIDER)) + 1,
      );
    // Có nhãn vận chuyển (người dùng nhập, hoặc nhãn TikTok đã lấy) ⇒ chế độ NHÃN: Pressify không cần địa
    // chỉ (tài liệu "Shipping and labels" — dành cho nhãn sàn như TikTok Shop). Không có ⇒ Pressify mua nhãn.
    const labelUrl = options.labelUrl?.trim() || order.shippingLabelUrl?.trim() || null;
    const address = labelUrl ? null : (check.address ?? null);
    const note = options.note ?? order.sellerNote ?? null;

    const record =
      existing ??
      (await this.repo.createDraft({
        organizationId,
        accountId: account.id,
        provider: PROVIDER,
        podOrderId,
        externalOrderId: refId,
        shippingMethod: choice.shippingMethod,
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
    const podItems = new Map(order.items.map((item) => [item.id, item]));
    const lines: PressifyResolvedLine[] = check.items.map((item) => {
      const podItem = podItems.get(item.podOrderItemId);
      return {
        itemId: itemIdByPodItem.get(item.podOrderItemId) ?? item.podOrderItemId,
        variantId: item.providerVariantId?.trim() ?? '',
        quantity: item.quantity,
        productName: podItem?.productName ?? null,
        // Mockup bắt buộc (tài liệu). Nguồn: ảnh biến thể TikTok của dòng hàng; thiếu ⇒ file in mặt đầu tiên
        // (bộ phận QC của Pressify dùng mockup để đối chiếu hàng in ra).
        mockup: podItem?.skuImage?.trim() || item.printFiles[0]?.url || '',
        printFiles: item.printFiles,
      };
    });

    const variants = await this.loadCatalogVariants(
      account,
      lines.map((line) => line.variantId),
    );
    try {
      this.assertPayloadValid({ refId, lines, variants, labelUrl, address, ...choice });
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

    const request = this.mapper.buildCreateOrderRequest({
      refId,
      handlingType: choice.handlingType,
      shippingMethod: choice.shippingMethod,
      labelUrl,
      address,
      note,
      printMethod: choice.printMethod,
      lines,
    });

    await this.repo.updateOrder(record.id, {
      status: FulfillmentStatus.SUBMITTING,
      attemptCount: { increment: 1 },
      // Tài liệu: "Money is USD".
      currency: PRESSIFY_CURRENCY,
      shippingMethod: choice.shippingMethod,
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
      message: `Gửi ${lines.length} sản phẩm sang ${LABEL} (ref_id=${refId})`,
      payload: {
        refId,
        itemCount: lines.length,
        orderStatus: choice.handlingType,
        shippingMethod: choice.shippingMethod,
        production: choice.printMethod,
        shippingMode: labelUrl ? 'LABEL' : 'ADDRESS',
        skippedGiftItemIds: check.warnings.flatMap((warning) => warning.podOrderItemId ?? []),
      },
      performedBy: actorUserId,
    });

    let result: Awaited<ReturnType<PressifyApiClient['createOrder']>>;
    try {
      result = await this.client.createOrder(ctx, request);
    } catch (error) {
      if (error instanceof FulfillmentClientError) {
        const refTaken =
          error.errorClass === FulfillmentErrorClass.VALIDATION &&
          (REF_TAKEN.test(error.message) ||
            (error.validationErrors ?? []).some((entry) => REF_TAKEN.test(entry.message ?? '')));
        if (refTaken || CREATE_AMBIGUOUS_ERROR_CLASSES.includes(error.errorClass)) {
          // Request có thể ĐÃ tới nơi (timeout / 5xx) hoặc đơn với ref_id này ĐÃ có ⇒ tra lại trước khi kết luận.
          const outcome = await this.tryAdoptExisting(
            ctx,
            record,
            refId,
            trigger,
            actorUserId,
            error,
          );
          if (outcome === 'ADOPTED') return this.requireRecord(organizationId, record.id);
          if (outcome === 'UNKNOWN')
            throw new FulfillmentReconciliationPendingException(LABEL, refId);
        }
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

    const providerOrderId =
      result.data?.data !== undefined &&
      result.data?.data !== null &&
      String(result.data.data).trim()
        ? String(result.data.data).trim()
        : null;

    try {
      await this.repo.updateOrder(record.id, {
        status: FulfillmentStatus.SUBMITTED,
        providerOrderId,
        // Response tạo đơn chỉ có id + giá TẠM TÍNH (không PII).
        rawResponse: {
          data: result.data?.data ?? null,
          price: result.data?.price ?? null,
          msg: result.data?.msg ?? null,
        } as Prisma.InputJsonValue,
        lastRequestId: result.requestId,
        lastErrorCode: null,
        lastErrorMessage: null,
        submittedAt: new Date(),
        lastSyncedAt: new Date(),
        updatedBy: actorUserId,
      });
    } catch (error) {
      // Pressify ĐÃ nhận đơn nhưng ghi DB hỏng — bản ghi còn SUBMITTING ⇒ bộ đồng bộ tra theo ref_id và khôi phục.
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.local-save',
        code: 'RECONCILIATION_REQUIRED',
        organizationId,
        podOrderId,
        fulfillmentOrderId: record.id,
        refId,
        providerOrderId,
        msg: `Pressify đã nhận đơn nhưng ghi DB local hỏng: ${(error as Error).message}`,
      });
      await this.safeHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.LOCAL_UPDATE_FAILED,
        trigger,
        success: false,
        message: `${LABEL} ĐÃ nhận đơn (mã ${providerOrderId ?? refId}) nhưng lưu kết quả hỏng — chờ đối soát tự động.`,
        payload: { providerOrderId, refId },
        performedBy: actorUserId,
      });
      throw new FulfillmentReconciliationPendingException(LABEL, refId);
    }

    try {
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CREATE_SUCCESS,
        trigger,
        fromStatus: FulfillmentStatus.SUBMITTING,
        toStatus: FulfillmentStatus.SUBMITTED,
        message:
          `${LABEL} đã nhận đơn` +
          (typeof result.data?.price?.total === 'number'
            ? ` — giá tạm tính ${result.data.price.total} ${PRESSIFY_CURRENCY}`
            : '') +
          (result.data?.msg ? ` · ${result.data.msg}` : ''),
        payload: {
          providerOrderId,
          refId,
          pricePreview: result.data?.price ?? null,
        } as Prisma.InputJsonValue,
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
        msg: `Đơn đã tạo ở Pressify, ghi nhật ký sau đó hỏng: ${(error as Error).message}`,
      });
    }

    this.logger.log({
      module: 'fulfillment',
      provider: PROVIDER,
      operation: 'create',
      organizationId,
      podOrderId,
      fulfillmentOrderId: record.id,
      refId,
      providerOrderId,
      requestId: result.requestId,
      durationMs: result.durationMs,
      msg: 'Tạo đơn Pressify thành công',
    });

    await this.refreshAfterCreate(
      organizationId,
      record.id,
      ctx,
      providerOrderId,
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
    let apiCalls = 1;
    try {
      const ctx = this.credentials.buildContext(account);
      let order: PressifyOrder;
      let meta: { durationMs?: number; requestId?: string } = {};
      if (record.providerOrderId) {
        const result = await this.client.getOrder(ctx, record.providerOrderId);
        order = result.data;
        meta = { durationMs: result.durationMs, requestId: result.requestId };
      } else {
        // Chưa có mã Pressify (đang chờ đối soát) ⇒ tra theo ref_id. Không thấy ⇒ coi như 404.
        const lookup = await this.findByRefId(
          ctx,
          record.externalOrderId,
          record.submittedAt ?? record.createdAt,
        );
        apiCalls = lookup.apiCalls;
        if (!lookup.order) {
          throw new FulfillmentClientError(
            FulfillmentErrorClass.NOT_FOUND,
            `Pressify không có đơn với ref_id=${record.externalOrderId}.`,
          );
        }
        order = lookup.order;
      }
      const changed = await this.applyProviderState(record, order, trigger, {
        ...meta,
        performedBy: actorUserId,
      });
      return { changed, apiCalls };
    } catch (error) {
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
        return { changed: true, apiCalls };
      }
      const notFound = await reconcileProviderOrderNotFound(
        { repo: this.repo, logger: this.logger },
        { record, trigger, actorUserId, error, providerLabel: LABEL },
      );
      if (notFound) return notFound;
      if (isQuietReconcileFailure(record)) {
        this.logger.warn({
          module: 'fulfillment',
          provider: PROVIDER,
          operation: 'sync.reconcile',
          organizationId: record.organizationId,
          fulfillmentOrderId: record.id,
          errorClass: error instanceof FulfillmentClientError ? error.errorClass : 'UNKNOWN',
          msg: 'Đối soát bản ghi FAILED: Pressify chưa trả được đơn — giữ FAILED, thử lại lượt sau',
        });
        await this.repo.updateOrder(record.id, { lastSyncedAt: new Date() });
        return { changed: false, apiCalls, rateLimited: isRateLimited(error) };
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
      return { changed: false, apiCalls, rateLimited: isRateLimited(error) };
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

  /** Tra lại đơn sau một webhook — webhook chỉ là TÍN HIỆU, GET /order/{id} là nguồn sự thật. */
  async refreshFromWebhook(
    record: FulfillmentOrder,
    account: FulfillmentAccount,
    webhook: { trackingUrl: string | null; carrier: string | null; labelUrl: string | null },
  ): Promise<boolean> {
    const ctx = this.credentials.buildContext(account);
    const id = record.providerOrderId;
    if (!id) {
      const lookup = await this.findByRefId(
        ctx,
        record.externalOrderId,
        record.submittedAt ?? record.createdAt,
      );
      if (!lookup.order) return false;
      return this.applyProviderState(record, lookup.order, FulfillmentTrigger.WEBHOOK, {}, webhook);
    }
    const result = await this.client.getOrder(ctx, id);
    return this.applyProviderState(
      record,
      result.data,
      FulfillmentTrigger.WEBHOOK,
      { durationMs: result.durationMs, requestId: result.requestId },
      webhook,
    );
  }

  /**
   * Áp trạng thái / tracking / chi phí từ MỘT đơn Pressify (GET /order/{id} hoặc phần tử GET /orders).
   * Một chỗ duy nhất quyết định chuyển trạng thái cho mọi đường vào.
   */
  async applyProviderState(
    record: FulfillmentOrder,
    detail: PressifyOrder | null,
    trigger: FulfillmentTrigger,
    meta: { durationMs?: number; requestId?: string; performedBy?: string } = {},
    extra: { trackingUrl?: string | null; carrier?: string | null; labelUrl?: string | null } = {},
  ): Promise<boolean> {
    if (!detail || detail.id === undefined || detail.id === null) return false;
    const detailId = String(detail.id);
    if (record.providerOrderId && detailId !== record.providerOrderId) {
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'apply-state',
        fulfillmentOrderId: record.id,
        msg: 'Bỏ qua dữ liệu Pressify: id đơn không khớp bản ghi',
      });
      return false;
    }
    if (detail.ref_id && detail.ref_id !== record.externalOrderId) {
      this.logger.warn({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'apply-state',
        fulfillmentOrderId: record.id,
        msg: 'Bỏ qua dữ liệu Pressify: ref_id không khớp bản ghi',
      });
      return false;
    }

    const reconciled = RECONCILABLE_STATUSES.includes(record.status);
    const hasState = Boolean(detail.fulfill_status?.trim()) || reconciled;
    const summary = hasState
      ? this.mapper.summarizeStatus(detail)
      : { status: record.status, providerStatus: record.providerStatus, message: null };
    const tracking = this.mapper.tracking(detail);
    const costs = this.mapper.orderCosts(detail);

    const statusChanged =
      summary.status !== record.status || summary.providerStatus !== record.providerStatus;
    const trackingChanged =
      (tracking?.trackingNumber ?? null) !== (record.trackingNumber ?? null) && Boolean(tracking);

    await this.repo.updateOrder(record.id, {
      status: summary.status,
      providerStatus: summary.providerStatus,
      providerOrderId: record.providerOrderId ?? detailId,
      trackingNumber: tracking?.trackingNumber ?? record.trackingNumber,
      trackingUrl: extra.trackingUrl?.trim() || record.trackingUrl,
      carrier: extra.carrier?.trim() || tracking?.carrier || record.carrier,
      labelUrl: extra.labelUrl?.trim() || detail.shipping_label?.trim() || record.labelUrl,
      subtotal: this.toDecimal(costs.subtotal) ?? record.subtotal,
      shippingFee: this.toDecimal(costs.shippingFee) ?? record.shippingFee,
      total: this.toDecimal(costs.total) ?? record.total,
      ...(record.currency ? {} : { currency: PRESSIFY_CURRENCY }),
      ...(reconciled ? { submittedAt: record.submittedAt ?? new Date() } : {}),
      ...(hasState
        ? { rawResponse: this.mapper.maskOrderForStorage(detail) as Prisma.InputJsonValue }
        : {}),
      lastSyncedAt: new Date(),
      ...(!hasState
        ? {}
        : summary.message
          ? { lastErrorCode: PRESSIFY_STATUS_MESSAGE_CODE, lastErrorMessage: summary.message }
          : record.lastErrorCode === PRESSIFY_STATUS_MESSAGE_CODE || reconciled
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
          carrier: extra.carrier ?? tracking.carrier,
          trackingUrl: extra.trackingUrl ?? null,
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

    // 🔴 Hỏi trạng thái THẬT trước khi huỷ (đơn có thể đã bị trừ tiền / vào sản xuất sau lượt đồng bộ gần nhất).
    let live: FulfillmentOrder;
    let detail: PressifyOrder;
    try {
      const result = await this.client.getOrder(ctx, record.providerOrderId);
      detail = result.data;
      await this.applyProviderState(record, detail, FulfillmentTrigger.MANUAL, {
        durationMs: result.durationMs,
        requestId: result.requestId,
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
    if (!CANCELLABLE_FULFILLMENT_STATUSES.includes(live.status)) {
      throw new FulfillmentCannotCancelException(live.providerStatus ?? live.status);
    }
    const allowed = this.mapper.cancellability(detail);
    if (!allowed.cancellable) {
      throw new FulfillmentValidationException(
        allowed.reason ?? `${LABEL} không cho huỷ đơn này qua API.`,
        [{ field: 'cancel', message: allowed.reason ?? undefined }],
      );
    }

    await this.repo.addHistory({
      organizationId,
      fulfillmentOrderId: record.id,
      eventType: FulfillmentEventType.CANCEL_REQUEST,
      trigger: FulfillmentTrigger.MANUAL,
      fromStatus: live.status,
      message: reason ? `Yêu cầu huỷ: ${reason}` : 'Yêu cầu huỷ đơn',
      payload: { reason: reason ?? null, actorRole: actorRole ?? null },
      performedBy: actorUserId,
    });

    try {
      const result = await this.client.cancelOrder(ctx, record.providerOrderId);
      // Tài liệu: LUÔN HTTP 200 — thất bại nằm ở `status: "error"` + `msg`.
      if (result.data?.status !== 'success') {
        throw new FulfillmentClientError(
          FulfillmentErrorClass.VALIDATION,
          result.data?.msg?.trim() || `${LABEL} từ chối huỷ đơn.`,
          result.httpStatus,
          'PRESSIFY_CANCEL_REFUSED',
          undefined,
          result.requestId,
          { status: result.data?.status ?? null, msg: result.data?.msg ?? null },
          `GET /order/cancel/{id}`,
        );
      }
      await this.repo.addHistory({
        organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.CANCEL_SUCCESS,
        trigger: FulfillmentTrigger.MANUAL,
        fromStatus: live.status,
        message: `${LABEL} xác nhận huỷ: ${result.data.msg ?? 'Order was canceled successfully'}`,
        durationMs: result.durationMs,
        requestId: result.requestId,
        performedBy: actorUserId,
      });
      // Đọc lại để có trạng thái `cancelled` thật (không tự đặt trạng thái).
      try {
        const after = await this.client.getOrder(ctx, record.providerOrderId);
        await this.applyProviderState(live, after.data, FulfillmentTrigger.MANUAL, {
          durationMs: after.durationMs,
          requestId: after.requestId,
          performedBy: actorUserId,
        });
      } catch (error) {
        this.logger.warn({
          module: 'fulfillment',
          provider: PROVIDER,
          operation: 'cancel.refresh',
          organizationId,
          fulfillmentOrderId: record.id,
          msg: `Pressify đã xác nhận huỷ nhưng chưa đọc lại được đơn — lượt đồng bộ sau cập nhật: ${(error as Error).message}`,
        });
        // Pressify ĐÃ xác nhận huỷ (`status: success`) ⇒ đây là trạng thái thật của nhà cung cấp.
        await this.repo.updateOrder(record.id, {
          status: FulfillmentStatus.CANCELLED,
          providerStatus: 'cancelled',
          cancelledAt: new Date(),
          updatedBy: actorUserId,
        });
      }
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
   * GET /product/accessory?api_key — endpoint chỉ-đọc NHẸ, có kiểm Store API key (404 "invalid seller" khi
   * key sai). Không chạm dữ liệu đơn / người nhận. User API key (dùng cho /store) KHÔNG qua được bước này —
   * đúng ý: tích hợp cần Store API key.
   */
  async testConnection(account: FulfillmentAccount): Promise<ProviderConnectionResult> {
    const startedAt = Date.now();
    try {
      const ctx = this.credentials.buildContext(account);
      const result = await this.client.listAccessories(ctx);
      if (!Array.isArray(result.data?.data)) {
        throw new FulfillmentClientError(
          FulfillmentErrorClass.UNKNOWN,
          'Pressify trả về dữ liệu không đúng định dạng khi kiểm tra key.',
        );
      }
      await this.repo.updateAccount(account.id, { lastUsedAt: new Date(), lastErrorMsg: null });
      return {
        connected: true,
        message: 'Connected',
        durationMs: Date.now() - startedAt,
        productionLineCount: null,
        categoryCount: null,
      };
    } catch (error) {
      const raw = (error as Error).message || `Không kết nối được tới ${LABEL}`;
      const message =
        error instanceof FulfillmentClientError && error.errorClass === FulfillmentErrorClass.AUTH
          ? `${raw} — kiểm tra lại Store API key (Pressify Dashboard → Stores). User API key không dùng được.`
          : raw;
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
  // Vị trí in & phương thức vận chuyển
  // ---------------------------------------------------------------------------

  placementResolver(): Promise<PlacementResolver> {
    return Promise.resolve(this.buildResolver());
  }

  /** Pressify: standard / priority, cố định (tài liệu) — không phụ thuộc sản phẩm. */
  shippingMethods(
    _account: FulfillmentAccount,
    _order: PodOrderWithRelations,
    _mappings: MappingWithDesigns[],
  ): Promise<ProviderShippingMethods> {
    return Promise.resolve({
      options: PRESSIFY_SHIPPING_METHODS.map((value) => ({
        value,
        label: PRESSIFY_SHIPPING_METHOD_LABELS[value],
      })),
      warnings: [],
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Tuỳ chọn của lần gửi: chỉ nhận đúng các tuỳ chọn Pressify có, giá trị trong tập tài liệu cho phép.
   * Tuỳ chọn của nhà cung cấp khác (facility, speed type, rush service…) ⇒ từ chối, không lặng lẽ bỏ qua.
   */
  private resolveOptions(options: FulfillOptionsInput): {
    handlingType: string;
    shippingMethod: string;
    printMethod: string | null;
  } {
    const errors: Array<{ field: string; message: string }> = [];
    const notSupported = (field: string, present: boolean) => {
      if (present) errors.push({ field, message: `${LABEL} API không có tuỳ chọn này.` });
    };
    notSupported('facility', Boolean(options.facility));
    notSupported('speedType', Boolean(options.speedType));
    notSupported('preferredCarrier', Boolean(options.preferredCarrier));
    notSupported('isScanLabel', options.isScanLabel === true);
    notSupported('rushService', options.rushService === true);

    const handlingType = options.handlingType?.trim() || PRESSIFY_DEFAULT_HANDLING_TYPE;
    if (!(PRESSIFY_HANDLING_TYPES as readonly string[]).includes(handlingType)) {
      errors.push({
        field: 'handlingType',
        message: `Phải thuộc: ${PRESSIFY_HANDLING_TYPES.join(', ')}.`,
      });
    }
    const shippingMethod = options.shippingMethod?.trim() || 'standard';
    if (!(PRESSIFY_SHIPPING_METHODS as readonly string[]).includes(shippingMethod)) {
      errors.push({
        field: 'shippingMethod',
        message: `Phải thuộc: ${PRESSIFY_SHIPPING_METHODS.join(', ')}.`,
      });
    }
    const printMethod = options.printMethod?.trim() || null;
    if (printMethod && !(PRESSIFY_PRINT_METHODS as readonly string[]).includes(printMethod)) {
      errors.push({
        field: 'printMethod',
        message: `Phải thuộc: ${PRESSIFY_PRINT_METHODS.join(', ')}.`,
      });
    }

    if (errors.length > 0) {
      throw new FulfillmentValidationException(
        `Tuỳ chọn gửi ${LABEL} không hợp lệ: ${errors.map((error) => `${error.field} — ${error.message}`).join(' · ')}`,
        errors,
      );
    }
    // DTF là mặc định của Pressify ⇒ chọn DTF thì không gửi `production` (payload tối thiểu, đúng tài liệu).
    return {
      handlingType,
      shippingMethod,
      printMethod: printMethod === 'DTF' ? null : printMethod,
    };
  }

  /** Kiểm payload theo đúng ràng buộc tài liệu TRƯỚC khi gọi Pressify (rẻ hơn và rõ hơn một HTTP 422/500). */
  private assertPayloadValid(params: {
    refId: string;
    lines: PressifyResolvedLine[];
    variants: Map<string, CatalogVariant>;
    labelUrl: string | null;
    address: NormalizedAddress | null;
    handlingType: string;
    shippingMethod: string;
    printMethod: string | null;
  }): void {
    const errors: Array<{ field: string; message: string }> = [];
    const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

    if (!params.refId.trim()) errors.push({ field: 'ref_id', message: 'Thiếu mã đơn (ref_id).' });

    if (params.labelUrl) {
      if (!isHttpUrl(params.labelUrl)) {
        errors.push({
          field: 'shipping_label',
          message: 'Nhãn vận chuyển phải là URL http(s) công khai (file PDF).',
        });
      }
    } else if (!params.address) {
      errors.push({
        field: 'address',
        message: 'Cần địa chỉ người nhận hoặc nhãn vận chuyển — Pressify bắt buộc một trong hai.',
      });
    } else {
      const address = this.mapper.toAddress(params.address);
      const required: Array<[string, string]> = [
        ['address.name', address.name],
        ['address.street1', address.street1],
        ['address.city', address.city],
        ['address.state', address.state],
        ['address.zip', address.zip],
        ['address.country', address.country],
      ];
      for (const [field, value] of required) {
        if (!value?.trim()) errors.push({ field, message: 'Bắt buộc.' });
        else if (value.includes('*')) {
          // Tài liệu: field có `*` (bị sàn che) bị Pressify bỏ ⇒ đơn thiếu địa chỉ. Dùng chế độ nhãn.
          errors.push({
            field,
            message: 'Địa chỉ đang bị che (có ký tự *) — lấy nhãn vận chuyển TikTok rồi gửi lại.',
          });
        }
      }
      if (address.country && !/^[A-Z]{2}$/i.test(address.country)) {
        errors.push({
          field: 'address.country',
          message: `Phải là mã quốc gia 2 chữ (đang là "${address.country}").`,
        });
      }
    }

    const styles = new Set<string>();
    params.lines.forEach((line, index) => {
      const prefix = `line_items[${index}]`;
      if (!/^\d+$/.test(line.variantId)) {
        errors.push({
          field: `${prefix}.variant_id`,
          message:
            'Ánh xạ sản phẩm chưa có variant_id Pressify — mở Cấu hình sản phẩm, chọn lại biến thể Pressify rồi lưu.',
        });
      } else {
        const variant = params.variants.get(line.variantId);
        if (!variant) {
          errors.push({
            field: `${prefix}.variant_id`,
            message: `variant_id ${line.variantId} chưa có trong danh mục Pressify đã đồng bộ — đồng bộ danh mục rồi thử lại.`,
          });
        } else if (variant.status !== FulfillmentCatalogItemStatus.ACTIVE) {
          errors.push({
            field: `${prefix}.variant_id`,
            message: `variant_id ${line.variantId} đang ${variant.status} trong danh mục Pressify (không còn bán).`,
          });
        }
        if (variant?.style) styles.add(variant.style.toLowerCase());
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        errors.push({
          field: `${prefix}.quantity`,
          message: `Số lượng phải là số nguyên ≥ 1 (đang là ${line.quantity}).`,
        });
      }
      if (!line.mockup || !isHttpUrl(line.mockup)) {
        errors.push({
          field: `${prefix}.mockup`,
          message:
            'Thiếu ảnh mockup (URL http(s) công khai) — Pressify bắt buộc ít nhất một mockup.',
        });
      }
      if (line.printFiles.length === 0) {
        errors.push({ field: `${prefix}.print_files`, message: 'Chưa có file in nào.' });
      }
      const seen = new Map<string, number>();
      line.printFiles.forEach((file, fileIndex) => {
        if (!(PRESSIFY_PRINT_KEYS as readonly string[]).includes(file.key)) {
          errors.push({
            field: `${prefix}.print_files[${fileIndex}].key`,
            message: `Vị trí in "${file.key}" không có ở Pressify.`,
          });
        }
        if (!isHttpUrl(file.url)) {
          errors.push({
            field: `${prefix}.print_files[${fileIndex}].url`,
            message: 'File in phải là URL http(s) công khai, tải trực tiếp được (PNG).',
          });
        }
        seen.set(file.key, (seen.get(file.key) ?? 0) + 1);
      });
      for (const [key, count] of seen) {
        if (
          count > 1 &&
          PRESSIFY_SINGLE_FILE_KEYS.includes(key as (typeof PRESSIFY_SINGLE_FILE_KEYS)[number])
        ) {
          errors.push({
            field: `${prefix}.print_files`,
            message: `Vị trí "${key}" chỉ nhận tối đa một file mỗi sản phẩm.`,
          });
        }
      }
      if (params.printMethod === 'DTG') {
        const badKeys = line.printFiles.filter(
          (file) => !(PRESSIFY_DTG_KEYS as readonly string[]).includes(file.key),
        );
        if (badKeys.length > 0) {
          errors.push({
            field: 'production',
            message: `DTG chỉ in Front/Back — sản phẩm ${index + 1} có vị trí ${badKeys.map((file) => file.key).join(', ')}.`,
          });
        }
      }
    });

    if (params.printMethod === 'DTG') {
      const notDtg = [...styles].filter(
        (style) => !(PRESSIFY_DTG_STYLES as readonly string[]).includes(style),
      );
      if (notDtg.length > 0) {
        errors.push({
          field: 'production',
          message: `Pressify không in DTG cho style: ${notDtg.join(', ')} (chỉ T-shirt, Sweatshirt, Wash tee, Comfort Colors, Youth T-Shirt, Bella Canvas).`,
        });
      }
      if (styles.size > 1) {
        errors.push({ field: 'production', message: 'DTG chỉ nhận đơn gồm MỘT nhóm sản phẩm.' });
      }
    }

    if (errors.length === 0) return;
    throw new FulfillmentValidationException(
      `Dữ liệu gửi ${LABEL} chưa hợp lệ: ${errors.map((error) => `${error.field} — ${error.message}`).join(' · ')}`,
      errors,
    );
  }

  /**
   * Tra đơn theo `ref_id` — GET /orders theo khoảng ngày quanh `around` (tài liệu: không có bộ lọc ref_id,
   * khoảng ngày tối đa 31 ngày). Không thấy ⇒ `order: null`. Lỗi ⇒ ném (KHÔNG coi là "chưa có").
   */
  private async findByRefId(
    ctx: PressifyCallContext,
    refId: string,
    around: Date,
  ): Promise<{ order: PressifyOrder | null; apiCalls: number }> {
    const day = 24 * 60 * 60_000;
    const from = new Date(around.getTime() - PRESSIFY_REF_LOOKUP.daysBefore * day);
    const to = new Date(
      Math.min(Date.now(), around.getTime()) + PRESSIFY_REF_LOOKUP.daysAfter * day,
    );
    const ymd = (date: Date) => date.toISOString().slice(0, 10);
    let apiCalls = 0;
    for (let page = 1; page <= PRESSIFY_REF_LOOKUP.maxPages; page += 1) {
      const result = await this.client.listOrders(ctx, {
        dateFrom: ymd(from),
        dateTo: ymd(to),
        page,
        perPage: PRESSIFY_REF_LOOKUP.perPage,
      });
      apiCalls += 1;
      const orders = Array.isArray(result.data?.data) ? result.data.data : [];
      const match = orders.find((order) => order.ref_id === refId);
      if (match) {
        // Phần tử danh sách có thể thiếu field — đọc chi tiết để có đủ trạng thái / chi phí.
        const detail = await this.client.getOrder(ctx, String(match.id));
        return { order: detail.data, apiCalls: apiCalls + 1 };
      }
      const lastPage = result.data?.meta?.last_page ?? page;
      if (page >= lastPage || orders.length === 0) break;
    }
    return { order: null, apiCalls };
  }

  /** Liên kết đơn ĐÃ có ở Pressify sau 422 "ref id taken" hoặc lỗi mập mờ — không tạo đơn thứ hai. */
  private async tryAdoptExisting(
    ctx: PressifyCallContext,
    record: FulfillmentOrder,
    refId: string,
    trigger: FulfillmentTrigger,
    actorUserId: string,
    createError: FulfillmentClientError,
  ): Promise<'ADOPTED' | 'NOT_FOUND' | 'UNKNOWN'> {
    try {
      const { order } = await this.findByRefId(ctx, refId, new Date());
      if (!order) return 'NOT_FOUND';
      const providerOrderId = String(order.id);
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
        message:
          `${LABEL} đã có đơn với ref_id=${refId} (${createError.errorClass}: ${createError.message}) — ` +
          `KHÔNG tạo lại, đã liên kết đơn ${providerOrderId}.`,
        payload: { providerOrderId, refId, adopted: true },
        performedBy: actorUserId,
      });
      const fresh = await this.repo.findById(record.organizationId, record.id);
      if (fresh) await this.applyProviderState(fresh, order, trigger, { performedBy: actorUserId });
      return 'ADOPTED';
    } catch (error) {
      await this.safeHistory({
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        eventType: FulfillmentEventType.RECONCILIATION_REQUIRED,
        trigger,
        success: false,
        message:
          `${LABEL} không phản hồi rõ khi tạo đơn (${createError.errorClass}: ${createError.message}) và tra lại ` +
          `ref_id=${refId} cũng hỏng — chờ đối soát tự động, KHÔNG gửi lại.`,
        payload: {
          createErrorClass: createError.errorClass,
          lookupError: (error as Error).message,
        },
        performedBy: actorUserId,
      });
      this.logger.error({
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'create.reconcile',
        code: 'RECONCILIATION_REQUIRED',
        organizationId: record.organizationId,
        fulfillmentOrderId: record.id,
        refId,
        msg: 'Không xác định được Pressify đã nhận đơn hay chưa — giữ SUBMITTING chờ đối soát',
      });
      return 'UNKNOWN';
    }
  }

  private async refreshAfterCreate(
    organizationId: string,
    fulfillmentOrderId: string,
    ctx: PressifyCallContext,
    providerOrderId: string | null,
    trigger: FulfillmentTrigger,
    actorUserId: string,
  ): Promise<void> {
    if (!providerOrderId) return;
    const record = await this.repo.findById(organizationId, fulfillmentOrderId);
    if (!record) return;
    try {
      const result = await this.client.getOrder(ctx, providerOrderId);
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
   * Giá vốn thật từng dòng — chỉ khi Pressify đã trừ tiền (`lineCosts` trả rỗng trước đó). Ghép theo `id` dòng
   * Pressify đã liên kết ở lần trước, rồi theo `variant_id` CHỈ khi variant đó xuất hiện đúng MỘT lần ở cả hai
   * phía (đơn hai dòng cùng biến thể ⇒ nhập nhằng ⇒ không ghi, để người vận hành xử lý).
   */
  private async applyLineCosts(record: FulfillmentOrder, detail: PressifyOrder): Promise<void> {
    const providerLines = this.mapper.lineCosts(detail);
    if (providerLines.length === 0) return;
    const rows = await this.repo.listItemsWithLineRef(record.id);
    if (rows.length === 0) return;

    const variantOfRow = await this.variantIdsOfRows(record, rows);
    const count = <T>(values: T[]) =>
      values.reduce(
        (map, value) => map.set(value, (map.get(value) ?? 0) + 1),
        new Map<T, number>(),
      );
    const providerCount = count(providerLines.map((line) => line.variantId));
    const localCount = count(rows.map((row) => variantOfRow.get(row.id) ?? null));
    const byProviderItemId = new Map(
      providerLines
        .filter((line) => line.providerItemId)
        .map((line) => [line.providerItemId, line]),
    );

    const matches = rows.map((row) => {
      const variantId = variantOfRow.get(row.id) ?? null;
      const matched =
        (row.providerItemId ? byProviderItemId.get(row.providerItemId) : undefined) ??
        (variantId && localCount.get(variantId) === 1 && providerCount.get(variantId) === 1
          ? providerLines.find((line) => line.variantId === variantId)
          : undefined);
      return { row, matched, variantId };
    });

    await this.repo.applyProviderItemCosts(
      record.id,
      matches.map(({ row, matched }) => ({
        id: row.id,
        // `items[].price` là giá của DÒNG Pressify; NCMedia gửi mỗi dòng số lượng 1 ⇒ = giá một đơn vị.
        // Dòng Pressify số lượng khác 1 (không do NCMedia gửi) ⇒ chia theo số lượng để giữ nghĩa "giá / đơn vị".
        baseCost:
          matched?.itemCost === null || matched?.itemCost === undefined
            ? null
            : matched.quantity && matched.quantity > 1
              ? Math.round((matched.itemCost / matched.quantity) * 10_000) / 10_000
              : matched.itemCost,
        color: null,
        size: null,
        providerItemId: matched?.providerItemId ?? null,
      })),
    );

    for (const { row, matched, variantId } of matches) {
      const entry = {
        module: 'fulfillment',
        provider: PROVIDER,
        operation: 'base-cost.apply',
        organizationId: record.organizationId,
        podOrderId: record.podOrderId,
        fulfillmentOrderId: record.id,
        fulfillmentOrderItemId: row.id,
        providerOrderId: record.providerOrderId ?? String(detail.id),
        providerItemId: matched?.providerItemId ?? row.providerItemId ?? null,
        providerVariantId: variantId,
        providerPrice: matched?.itemCost ?? null,
        baseCostBefore: row.baseCost === null ? null : Number(row.baseCost),
        baseCostConfirmedBefore: row.baseCostConfirmedAt !== null,
      };
      if (matched?.itemCost !== null && matched?.itemCost !== undefined) {
        this.logger.log({ ...entry, msg: 'Cập nhật giá vốn theo số Pressify thực trừ' });
      } else {
        this.logger.warn({
          ...entry,
          reason: matched ? 'PROVIDER_COST_MISSING' : 'LINE_NOT_MATCHED',
          providerLines: providerLines.length,
          msg: matched
            ? 'Pressify chưa báo giá cho dòng hàng — chờ lượt đồng bộ sau'
            : 'Không ghép được dòng Pressify (id dòng / variant_id duy nhất) — giá vốn chưa được xác nhận',
        });
      }
    }
  }

  /** `variant_id` Pressify của từng dòng đã gửi — đọc lại từ ánh xạ của dòng hàng TikTok. */
  private async variantIdsOfRows(
    record: FulfillmentOrder,
    rows: Array<{ id: string; podOrderItemId: string | null }>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const order = await this.podOrderRepo.findById(record.organizationId, record.podOrderId);
    if (!order) return result;
    // Cùng luật ghép với readiness (`findMappingForItem`), chỉ nhận ánh xạ của ĐÚNG tài khoản đã gửi.
    const mappings = (await this.repo.listMappingsForOrganization(record.organizationId)).filter(
      (mapping) => mapping.accountId === record.accountId,
    );
    const items = new Map(order.items.map((item) => [item.id, item]));
    for (const row of rows) {
      const item = row.podOrderItemId ? items.get(row.podOrderItemId) : undefined;
      const variantId = item
        ? findMappingForItem(item, mappings)?.providerVariantId?.trim()
        : undefined;
      if (variantId) result.set(row.id, variantId);
    }
    return result;
  }

  private async loadCatalogVariants(
    account: FulfillmentAccount,
    variantIds: string[],
  ): Promise<Map<string, CatalogVariant>> {
    const ids = [...new Set(variantIds.filter((id) => /^\d+$/.test(id)))];
    const rows = await this.catalogRepo.findVariantsByExternalIds(account.id, ids);
    return new Map(
      rows.map((row) => {
        const raw = (row.rawData ?? {}) as PressifyVariant & { product_style?: string | null };
        const style = raw.product_style ?? raw.style ?? null;
        return [row.externalVariantId, { status: row.status, style: style?.trim() || null }];
      }),
    );
  }

  private buildResolver(): PlacementResolver {
    return (placement, mapping) => this.mapper.resolvePrintKey(placement, mapping.placementMap);
  }

  private async requirePressifyAccount(
    organizationId: string,
    accountId: string | null | undefined,
  ): Promise<FulfillmentAccount> {
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
      const key = rowKeyOf(row);
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

  private async safeHistory(
    entry: Parameters<FulfillmentRepository['addHistory']>[0],
  ): Promise<void> {
    try {
      await this.repo.addHistory(entry);
    } catch {
      // DB đang hỏng — log có cấu trúc ở nơi gọi đã đủ để đối soát.
    }
  }

  /** Nhật ký + error log cho một lần thất bại (KHÔNG ghi thông tin xác thực hay PII). */
  private async recordFailure(
    organizationId: string,
    fulfillmentOrderId: string,
    operation: string,
    trigger: FulfillmentTrigger,
    actorUserId: string | undefined,
    error: unknown,
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
    // Chỉ luồng TẠO mới hạ về FAILED; sync / cancel lỗi giữ nguyên trạng thái thật ở xưởng in.
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
