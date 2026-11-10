import type { Logger } from '@nestjs/common';
import { FulfillmentStatus, FulfillmentTrigger, type FulfillmentOrder } from '@prisma/client';
import { FulfillmentClientError, FulfillmentErrorClass } from '../exceptions/fulfillment.exceptions';
import type { FulfillmentRepository } from '../repositories/fulfillment.repository';

/**
 * **Đơn ở nhà cung cấp KHÔNG CÒN TỒN TẠI** (vd người dùng xoá thẳng trên Sellerwix) — biểu diễn bằng dữ
 * liệu SẴN CÓ, không thêm trạng thái/cột:
 *
 * ```
 *   status          = CANCELLED                      ⇒ thuộc SUBMITTABLE ⇒ Fulfill lại được
 *   last_error_code = PROVIDER_ORDER_NOT_FOUND       ⇒ phân biệt với "huỷ có xác nhận"
 *   cancelled_at    = lúc phát hiện
 *   nhật ký         = STATUS_CHANGED, payload { providerOrderNotFound: true, providerOrderId, ... }
 * ```
 *
 * Fulfill lại đi ĐÚNG luồng sau huỷ đã có: `supersedeCancelled` LƯU TRỮ bản ghi này (giữ mã đơn cũ,
 * dòng hàng, lịch sử) rồi tạo lần thử mới với mã đơn mới `{base}-R{n}` ⇒ không bao giờ dùng lại mã cũ
 * (Mango: "Mango will raise an error if you have any orders with the same order_id"). Ánh xạ sản phẩm /
 * design chỉ được ĐỌC.
 *
 * 🔴 Chỉ reset khi CHẮC CHẮN đơn không còn — lỗi tạm thời (429 / 5xx / timeout / mất mạng) KHÔNG BAO GIỜ
 * được coi là "đã xoá", nếu không một lần nhà cung cấp chập chờn là một đơn sản xuất trùng.
 */

/** `last_error_code` đánh dấu bản ghi bị reset vì nhà cung cấp không còn đơn. */
export const PROVIDER_ORDER_NOT_FOUND_CODE = 'PROVIDER_ORDER_NOT_FOUND';

/** `provider_status` ghi kèm (hiển thị cạnh trạng thái) — không phải giá trị nhà cung cấp trả. */
export const PROVIDER_ORDER_NOT_FOUND_STATUS = 'not found';

/**
 * Trạng thái ĐƯỢC reset khi nhà cung cấp báo không còn đơn: đơn chưa vào sản xuất.
 *
 * 🔴 IN_PRODUCTION / SHIPPED / DELIVERED / REFUNDED KHÔNG reset: hàng có thể đã in / đã giao — mở lại nút
 * Fulfill là mời sản xuất lần hai. Trường hợp đó chỉ báo lỗi để người vận hành kiểm tra tay.
 */
export const RESETTABLE_ON_PROVIDER_NOT_FOUND: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.ON_HOLD,
  FulfillmentStatus.UNKNOWN,
  FulfillmentStatus.REJECTED,
];

/**
 * Lỗi nhà cung cấp nghĩa là "đơn không tồn tại" (đã phân loại ở client của từng nhà cung cấp):
 *  - Sellerwix `GET /v1/order/:id`: tài liệu có ví dụ `404 {"code": 404, "message": "order not found"}`
 *    ⇒ client phân loại HTTP 404 thành `NOT_FOUND`.
 *  - Mango `GET /orders/{order_id}`: trang Get Order Detail KHÔNG ghi 404; mã chung `NOT_FOUND`
 *    ("Resource not found") ở Overview ⇒ client phân loại mã `NOT_FOUND` / HTTP 404 thành `NOT_FOUND`.
 * Mọi lớp lỗi khác (RATE_LIMIT / SERVER / NETWORK / AUTH / VALIDATION / UNKNOWN) ⇒ `false`.
 */
export function isProviderOrderNotFoundError(error: unknown): boolean {
  return error instanceof FulfillmentClientError && error.errorClass === FulfillmentErrorClass.NOT_FOUND;
}

/** Bản ghi ĐÃ được reset vì nhà cung cấp không còn đơn. */
export function isProviderOrderGone(record: Pick<FulfillmentOrder, 'status' | 'lastErrorCode'>): boolean {
  return record.status === FulfillmentStatus.CANCELLED && record.lastErrorCode === PROVIDER_ORDER_NOT_FOUND_CODE;
}

/**
 * Lượt đồng bộ này được phép reset bản ghi không.
 *
 * 🔴 CHỈ khi người dùng bấm "Sync Fulfillment" (MANUAL) — không phải cron / webhook. Lý do: Mango "Only
 * returns orders belonging to the API key owner", nên đổi API key sang tài khoản Mango khác cũng ra
 * NOT_FOUND cho MỌI đơn; để cron tự reset là hàng loạt đơn bị mở lại Fulfill ⇒ sản xuất trùng. Người dùng
 * bấm Sync cho TỪNG đơn là một xác nhận có chủ đích.
 */
export function shouldResetOnProviderNotFound(
  record: Pick<FulfillmentOrder, 'status' | 'providerOrderId' | 'externalOrderId'>,
  trigger: FulfillmentTrigger,
  error: unknown,
): boolean {
  return (
    trigger === FulfillmentTrigger.MANUAL &&
    isProviderOrderNotFoundError(error) &&
    RESETTABLE_ON_PROVIDER_NOT_FOUND.includes(record.status) &&
    Boolean(record.providerOrderId || record.externalOrderId)
  );
}

/**
 * Xử lý lỗi "không tìm thấy đơn" trong một lượt đồng bộ — DÙNG CHUNG cho mọi nhà cung cấp (phân loại lỗi
 * vẫn là của client từng nhà cung cấp).
 *
 * - Không phải lỗi "không tìm thấy" ⇒ `null` (nơi gọi xử lý như cũ: giữ trạng thái, ghi lỗi đồng bộ).
 * - Bản ghi ĐÃ reset trước đó ⇒ chỉ cập nhật `last_synced_at`, KHÔNG ghi thêm nhật ký (idempotent).
 * - Đủ điều kiện reset (`shouldResetOnProviderNotFound`) ⇒ CANCELLED + `PROVIDER_ORDER_NOT_FOUND`.
 * - Còn lại (cron / webhook, hoặc đơn đã vào sản xuất) ⇒ `null`: KHÔNG reset, nơi gọi ghi lỗi như cũ.
 */
export async function reconcileProviderOrderNotFound(
  deps: {
    repo: Pick<FulfillmentRepository, 'markProviderOrderNotFound' | 'updateOrder'>;
    logger: Pick<Logger, 'log' | 'warn'>;
  },
  input: {
    record: FulfillmentOrder;
    trigger: FulfillmentTrigger;
    actorUserId?: string;
    error: unknown;
    providerLabel: string;
  },
): Promise<{ changed: boolean; apiCalls: number } | null> {
  const { record, trigger, actorUserId, error, providerLabel } = input;
  if (!isProviderOrderNotFoundError(error)) return null;
  const clientError = error as FulfillmentClientError;
  const reference = record.providerOrderId ?? record.externalOrderId;
  const logBase = {
    module: 'fulfillment',
    provider: record.provider,
    operation: 'sync.provider-not-found',
    organizationId: record.organizationId,
    podOrderId: record.podOrderId,
    fulfillmentOrderId: record.id,
    providerOrderId: record.providerOrderId,
    externalOrderId: record.externalOrderId,
    trigger,
    httpStatus: clientError.httpStatus ?? null,
    providerCode: clientError.providerCode ?? null,
    requestId: clientError.requestId ?? null,
  };

  if (isProviderOrderGone(record)) {
    await deps.repo.updateOrder(record.id, { lastSyncedAt: new Date() });
    deps.logger.log({ ...logBase, result: 'ALREADY_RESET', msg: 'Nhà cung cấp vẫn không còn đơn — bản ghi đã reset trước đó' });
    return { changed: false, apiCalls: 1 };
  }

  if (!shouldResetOnProviderNotFound(record, trigger, error)) {
    deps.logger.warn({
      ...logBase,
      result: 'NOT_RESET',
      status: record.status,
      msg:
        trigger === FulfillmentTrigger.MANUAL
          ? 'Nhà cung cấp không tìm thấy đơn đã vào sản xuất / đã giao — KHÔNG mở lại Fulfill, cần kiểm tra tay'
          : 'Nhà cung cấp không tìm thấy đơn — chỉ reset khi người dùng bấm Sync Fulfillment',
    });
    return null;
  }

  const message =
    `${providerLabel} không còn đơn ${reference} (đã bị xoá hoặc không tồn tại). ` +
    'Có thể Fulfill lại — lần gửi mới dùng mã đơn mới; ánh xạ và design giữ nguyên.';
  const marked = await deps.repo.markProviderOrderNotFound(record, {
    allowedStatuses: RESETTABLE_ON_PROVIDER_NOT_FOUND,
    code: PROVIDER_ORDER_NOT_FOUND_CODE,
    providerStatus: PROVIDER_ORDER_NOT_FOUND_STATUS,
    message,
    trigger,
    performedBy: actorUserId,
    requestId: clientError.requestId,
    payload: {
      providerOrderNotFound: true,
      provider: record.provider,
      providerOrderId: record.providerOrderId,
      externalOrderId: record.externalOrderId,
      previousStatus: record.status,
      previousProviderStatus: record.providerStatus,
      httpStatus: clientError.httpStatus ?? null,
      providerCode: clientError.providerCode ?? null,
      endpoint: clientError.endpoint ?? null,
    },
  });
  deps.logger.log({
    ...logBase,
    result: marked ? 'RESET' : 'STALE',
    previousStatus: record.status,
    msg: marked
      ? 'Nhà cung cấp không còn đơn ⇒ bản ghi CANCELLED (PROVIDER_ORDER_NOT_FOUND), Fulfill lại được'
      : 'Bản ghi đã đổi trạng thái giữa chừng — không reset',
  });
  return { changed: marked, apiCalls: 1 };
}
