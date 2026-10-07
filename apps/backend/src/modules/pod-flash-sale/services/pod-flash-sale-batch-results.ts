import type { Prisma } from '@prisma/client';
import {
  FLASH_SALE_BATCH_STATUS,
  type FlashSaleBatchStatus,
} from '../constants/pod-flash-sale.constants';

/**
 * Kết quả MỘT lô của lượt publish — phần tử của `pod_flash_sales.publish_batch_results`.
 *
 * `skus` = số DÒNG của lô (mức VARIATION: một dòng = một SKU; mức PRODUCT: một dòng = một sản phẩm).
 * `succeeded` + `failed` = số dòng đã có kết quả; lô `SKIPPED` có `succeeded = failed = 0`.
 */
export interface FlashSaleBatchResult {
  batch: number;
  status: FlashSaleBatchStatus;
  products: number;
  skus: number;
  succeeded: number;
  failed: number;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Tổng hợp của một lượt — dùng cho trạng thái cuối của đợt và cho màn hình tiến độ. */
export interface FlashSaleBatchSummary {
  totalBatches: number;
  /** Lô đã có kết quả cuối (SUCCEEDED / PARTIAL / FAILED / SKIPPED). */
  processedBatches: number;
  succeededBatches: number;
  partialBatches: number;
  failedBatches: number;
  skippedBatches: number;
  /** Dòng TikTok đã nhận trong lượt này. */
  succeeded: number;
  /** Dòng hỏng trong lượt này (TikTok từ chối / Get Product xác nhận không gửi được). */
  failed: number;
  /** Dòng của lô SKIPPED — chưa từng gửi vì lượt phải dừng. */
  skipped: number;
  /** Dòng của lô còn PENDING / PROCESSING — chỉ khác 0 khi lượt CÒN đang chạy. */
  pending: number;
  /** Lô đầu tiên không trọn vẹn (FAILED / PARTIAL / SKIPPED) — để hiển thị "lỗi từ lô i". */
  firstProblemBatch: number | null;
}

const FINAL_STATUSES: readonly FlashSaleBatchStatus[] = [
  FLASH_SALE_BATCH_STATUS.SUCCEEDED,
  FLASH_SALE_BATCH_STATUS.PARTIAL,
  FLASH_SALE_BATCH_STATUS.FAILED,
  FLASH_SALE_BATCH_STATUS.SKIPPED,
];

/** Mọi lô ở `PENDING` — ghi ngay lúc giành lượt để màn hình thấy đủ N lô từ giây đầu. */
export function initialBatchResults(
  batches: Array<{ products: number; skus: number }>,
): FlashSaleBatchResult[] {
  return batches.map((batch, index) => ({
    batch: index + 1,
    status: FLASH_SALE_BATCH_STATUS.PENDING,
    products: batch.products,
    skus: batch.skus,
    succeeded: 0,
    failed: 0,
    errorCode: null,
    errorMessage: null,
    requestId: null,
    startedAt: null,
    finishedAt: null,
  }));
}

/** Đọc cột JSON — dữ liệu cũ (`null`) hoặc hình dạng lạ ⇒ mảng rỗng, không ném lỗi. */
export function parseBatchResults(value: Prisma.JsonValue | null | undefined): FlashSaleBatchResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Prisma.JsonObject =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) && typeof entry.batch === 'number',
  ) as unknown as FlashSaleBatchResult[];
}

/** Trạng thái cuối của một lô theo số dòng nhận / hỏng. */
export function batchStatusOf(succeeded: number, failed: number): FlashSaleBatchStatus {
  if (failed === 0) return FLASH_SALE_BATCH_STATUS.SUCCEEDED;
  return succeeded > 0 ? FLASH_SALE_BATCH_STATUS.PARTIAL : FLASH_SALE_BATCH_STATUS.FAILED;
}

/**
 * Lượt phải dừng ⇒ mọi lô CHƯA có kết quả thành `SKIPPED` kèm lý do.
 *
 * 🔴 Đây là thứ bảo đảm "không còn lô PENDING vô thời hạn sau khi lượt đã kết thúc".
 */
export function skipUnfinishedBatches(
  results: FlashSaleBatchResult[],
  reason: { code: string | null; message: string },
  now: Date,
): FlashSaleBatchResult[] {
  return results.map((result) =>
    FINAL_STATUSES.includes(result.status)
      ? result
      : {
          ...result,
          status: FLASH_SALE_BATCH_STATUS.SKIPPED,
          errorCode: reason.code,
          errorMessage: reason.message.slice(0, 2000),
          finishedAt: now.toISOString(),
        },
  );
}

export function summarizeBatchResults(results: FlashSaleBatchResult[]): FlashSaleBatchSummary {
  const summary: FlashSaleBatchSummary = {
    totalBatches: results.length,
    processedBatches: 0,
    succeededBatches: 0,
    partialBatches: 0,
    failedBatches: 0,
    skippedBatches: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    firstProblemBatch: null,
  };
  for (const result of results) {
    summary.succeeded += result.succeeded;
    summary.failed += result.failed;
    switch (result.status) {
      case FLASH_SALE_BATCH_STATUS.SUCCEEDED:
        summary.succeededBatches += 1;
        break;
      case FLASH_SALE_BATCH_STATUS.PARTIAL:
        summary.partialBatches += 1;
        break;
      case FLASH_SALE_BATCH_STATUS.FAILED:
        summary.failedBatches += 1;
        break;
      case FLASH_SALE_BATCH_STATUS.SKIPPED:
        summary.skippedBatches += 1;
        summary.skipped += result.skus;
        break;
      default:
        // PENDING / PROCESSING: phần chưa có kết quả của lô.
        summary.pending += Math.max(result.skus - result.succeeded - result.failed, 0);
    }
    if (FINAL_STATUSES.includes(result.status)) summary.processedBatches += 1;
    if (
      summary.firstProblemBatch === null &&
      result.status !== FLASH_SALE_BATCH_STATUS.SUCCEEDED &&
      FINAL_STATUSES.includes(result.status)
    ) {
      summary.firstProblemBatch = result.batch;
    }
  }
  return summary;
}
