/**
 * Chạy `worker` cho từng phần tử với **số luồng song song có trần** và **hạn chót**.
 *
 * 🔴 Hàm thuần, không phụ thuộc Nest — dùng chung cho Shop Sync và Product Sync (cả hai đều là
 * "một lượt nhiều shop, shop nào độc lập shop đó").
 *
 * Hai ràng buộc, không bỏ cái nào:
 *  - **Trần song song** (`limit`): quota TikTok tính theo App × Shop nên các shop khác nhau
 *    không giành quota của nhau, nhưng bung không giới hạn là dồn tải lên DB + Redis và nhân
 *    số lời gọi TikTok đang treo cùng lúc. Kẹp về [1, số phần tử].
 *  - **Hạn chót** (`deadlineAt`, epoch ms): phần tử CHƯA BẮT ĐẦU khi hết giờ không được chạy —
 *    `onDeadline` quyết định kết quả của nó (vd chuyển sang hàng đợi nền). Phần tử ĐANG chạy
 *    thì không bị cắt ngang ở đây; tự nó phải tôn trọng hạn chót (xem Product Sync).
 *
 * `worker` KHÔNG được ném lỗi ra ngoài — mỗi nơi gọi tự biến lỗi thành kết quả của phần tử đó,
 * để một phần tử hỏng không làm mất kết quả của các phần tử còn lại. Nếu nó vẫn ném, lỗi được
 * truyền ra (fail-fast) thay vì bị nuốt im lặng.
 *
 * Kết quả giữ ĐÚNG thứ tự đầu vào.
 */
export async function runWithBoundedConcurrency<T, R>(
  items: readonly T[],
  options: {
    limit: number;
    deadlineAt?: number;
    onDeadline?: (item: T) => R | Promise<R>;
  },
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(Math.floor(options.limit) || 1, items.length || 1));
  let cursor = 0;

  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];

      const expired = options.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
      results[index] =
        expired && options.onDeadline ? await options.onDeadline(item) : await worker(item);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => lane()));
  return results;
}
