/**
 * Hàng đợi chạy song song có giới hạn — dùng cho Bulk Listing.
 *
 * 🔴 Vì sao KHÔNG chạy tuần tự: 1.000 sản phẩm × ~4 giây/sản phẩm = hơn một giờ. Vì sao
 * KHÔNG chạy hết một lúc: mỗi item là 1 lần Create Product + tối đa 9 lần Upload Image, thả
 * 1.000 item cùng lúc là tự bắn 10.000 request vào rate limit của TikTok.
 *
 * Vì sao KHÔNG dùng BullMQ/Redis: hệ thống chưa có tiến trình worker riêng (một container
 * API duy nhất), thêm broker chỉ để xếp hàng nội bộ là thêm một thứ phải vận hành. Trạng
 * thái thật của job nằm ở DATABASE, không nằm trong bộ nhớ hàng đợi — nên tiến trình chết
 * giữa chừng thì bộ quét (sweeper) nhặt lại item dang dở, không mất việc.
 *
 * Không phụ thuộc Nest, không phụ thuộc Prisma ⇒ test được bằng hàm thuần.
 */

/** Hàm chạy một phần việc. Lỗi ném ra được bắt lại và trả về trong kết quả. */
export type QueueTask<T> = () => Promise<T>;

/** Kết quả một phần việc: hoặc `value`, hoặc `error`. */
export interface QueueOutcome<T> {
  index: number;
  value?: T;
  error?: unknown;
}

/**
 * Chạy `tasks` với tối đa `concurrency` việc song song.
 *
 * Một việc hỏng KHÔNG làm sập cả lượt (fail-soft): lỗi được gói vào `QueueOutcome.error`.
 * Với bulk listing, một sản phẩm sai dữ liệu không được phép chặn 999 sản phẩm còn lại.
 *
 * `onSettled` được gọi ngay khi mỗi việc xong — dùng để cập nhật tiến độ theo thời gian
 * thực thay vì đợi cả lượt kết thúc.
 */
export async function runWithConcurrency<T>(
  tasks: Array<QueueTask<T>>,
  concurrency: number,
  onSettled?: (outcome: QueueOutcome<T>) => void | Promise<void>,
): Promise<Array<QueueOutcome<T>>> {
  const limit = Math.max(1, Math.floor(concurrency));
  const outcomes: Array<QueueOutcome<T>> = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;

      let outcome: QueueOutcome<T>;
      try {
        outcome = { index, value: await tasks[index]() };
      } catch (error) {
        outcome = { index, error };
      }
      outcomes[index] = outcome;
      if (onSettled) await onSettled(outcome);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return outcomes;
}

/**
 * Độ trễ trước lần thử thứ `retryCount` — **exponential backoff**: base · 2^(n-1), chặn trên.
 *
 * Lần thử lại đầu tiên (`retryCount = 1`) chờ đúng `base`. Không cộng jitter ở đây vì các
 * item đã lệch pha sẵn (mỗi item xong ở một thời điểm khác nhau); jitter chỉ cần khi cả đàn
 * cùng thất bại một lúc.
 */
export function computeRetryDelayMs(retryCount: number, baseMs: number, maxMs: number): number {
  if (retryCount <= 0) return 0;
  return Math.min(baseMs * Math.pow(2, retryCount - 1), maxMs);
}
