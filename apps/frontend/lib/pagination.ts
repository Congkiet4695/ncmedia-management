/**
 * Logic phân trang — thuần tuý, không React, không i18n.
 *
 * 🔴 Tách khỏi component để chạy thử được. Frontend chưa có test runner, nhưng thuật toán
 * dải trang là thứ dễ sai ở biên nhất (trang đầu, trang cuối, ít trang, rất nhiều trang) —
 * `npm run test:pagination` chạy đúng file này qua toàn bộ ma trận trường hợp.
 *
 * Thuật ngữ theo ADR-023: backend nhận `page` + `limit`, trả `meta { total, page, limit,
 * totalPages }`. Giữ nguyên `limit` (không đổi thành `pageSize`) để không phải sửa hợp
 * đồng API đang chạy tốt.
 */

/** Số record mỗi trang cho người dùng chọn. Trần 100 khớp `@Max(100)` của backend. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** Ký hiệu chỗ ngắt quãng trong dải trang. */
export const ELLIPSIS = 'ellipsis' as const;

export type PageRangeItem = number | typeof ELLIPSIS;

/**
 * Dải nút trang cần hiển thị.
 *
 * Luôn giữ: trang ĐẦU, trang CUỐI, trang HIỆN TẠI và `siblingCount` trang mỗi bên. Chỗ nào
 * đứt quãng thì chèn `ellipsis`.
 *
 * 🔴 Vì sao không render hết: một bảng 10.000 dòng với 20 dòng/trang là 500 nút. Trình
 * duyệt vẫn dựng được, nhưng thanh phân trang khi đó vô dụng với người dùng.
 *
 * 🔴 Vì sao số lượng phần tử trả về CỐ ĐỊNH khi `totalPages` lớn: dải co giãn theo vị trí
 * trang hiện tại sẽ làm các nút nhảy ngang mỗi lần bấm, và người dùng bấm trượt sang trang
 * không định đến. Cách bù: ở gần hai đầu, phần thiếu được lấp bằng trang thật thay vì
 * `ellipsis`.
 *
 *   current=1  / 20 →  1 2 3 4 5 … 20
 *   current=5  / 20 →  1 … 4 5 6 … 20
 *   current=20 / 20 →  1 … 16 17 18 19 20
 *   current=3  / 5  →  1 2 3 4 5           (đủ chỗ ⇒ không có ellipsis)
 */
export function buildPageRange(
  current: number,
  totalPages: number,
  siblingCount = 1,
): PageRangeItem[] {
  if (totalPages <= 0) return [];

  const page = clampPage(current, totalPages);

  // Số ô tối đa: đầu + cuối + hiện tại + 2 nhánh + 2 ellipsis.
  const maxSlots = siblingCount * 2 + 5;
  if (totalPages <= maxSlots) return range(1, totalPages);

  const leftSibling = Math.max(page - siblingCount, 1);
  const rightSibling = Math.min(page + siblingCount, totalPages);

  // Ellipsis chỉ đáng khi nó giấu ÍT NHẤT 2 trang. Giấu đúng 1 trang thì "1 … 4" chiếm y
  // hệt chỗ của "1 3 4" mà lại mất một nút bấm được — nên nhánh đó hiện trang thật.
  //   trái : các trang bị giấu là 2 … leftSibling-1  ⇒ đáng khi leftSibling > 3
  //   phải : rightSibling+1 … totalPages-1           ⇒ đáng khi rightSibling < totalPages - 2
  const showLeftEllipsis = leftSibling > 3;
  const showRightEllipsis = rightSibling < totalPages - 2;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, siblingCount * 2 + 3), ELLIPSIS, totalPages];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, ELLIPSIS, ...range(totalPages - (siblingCount * 2 + 2), totalPages)];
  }

  if (showLeftEllipsis && showRightEllipsis) {
    return [1, ELLIPSIS, ...range(leftSibling, rightSibling), ELLIPSIS, totalPages];
  }

  // Không bên nào cần ellipsis mà vẫn lọt tới đây: chỉ xảy ra khi `totalPages <= maxSlots`,
  // vốn đã được chặn ở trên. Giữ nhánh này làm lưới an toàn thay vì trả về dải rỗng.
  return range(1, totalPages);
}

/**
 * Khoảng record đang hiển thị — "Showing {from}–{to} of {total}".
 *
 * 🔴 Không có record thì trả `0–0`, KHÔNG phải `1–0`. Người dùng đọc "Showing 1–0 of 0" sẽ
 * tưởng giao diện hỏng.
 */
export function getShowingRange(
  page: number,
  limit: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0 || limit <= 0) return { from: 0, to: 0 };
  const from = (Math.max(1, page) - 1) * limit + 1;
  // `from > total` xảy ra khi đang ở trang đã biến mất (vừa xoá bớt record) — kẹp lại thay
  // vì hiện một khoảng âm trong lúc chờ trang được đưa về hợp lệ.
  if (from > total) return { from: total, to: total };
  return { from, to: Math.min(from + limit - 1, total) };
}

/** Ép `page` về khoảng hợp lệ `[1, totalPages]`. `totalPages = 0` ⇒ trang 1. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  if (totalPages <= 0) return 1;
  return Math.min(Math.floor(page), totalPages);
}

/** `[from..to]` — chỉ dùng nội bộ, `to < from` trả mảng rỗng. */
function range(from: number, to: number): number[] {
  if (to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
