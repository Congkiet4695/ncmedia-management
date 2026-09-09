import type { AddFlashSaleItemPayload } from './types';

/**
 * Trạng thái lựa chọn của bộ chọn sản phẩm/SKU — **hàm thuần, không React**.
 *
 * 🔴 Tách khỏi component vì đây là chỗ dễ sai nhất của một bảng có phân trang: lựa chọn phải
 * sống NGOÀI trang đang hiển thị. Cách làm ngây thơ (gắn cờ lên từng dòng đang render) đánh
 * rơi mọi thứ đã tick ngay khi dữ liệu trang mới về — và người dùng chỉ phát hiện ra sau khi
 * bấm Thêm và thấy thiếu hàng.
 *
 * Tách ra thì kiểm được "tick trang 1 → sang trang 2 → quay lại trang 1" bằng hàm thuần,
 * không cần dựng cả một cây React.
 *
 * 🔴 MỘT cấu trúc duy nhất: `Map<id, payload>`. Giữ song song một `Set` id và một `Map`
 * payload là hai nguồn sự thật phải đồng bộ tay — lệch nhau một nhịp là số trên nút bấm nói
 * một đằng, dữ liệu gửi đi một nẻo.
 */

/**
 * Một dòng trong bộ chọn — LUÔN là một SẢN PHẨM.
 *
 * 🔴 Bộ chọn chọn sản phẩm ở CẢ HAI mức áp dụng. Ở mức `VARIATION`, backend tự bung sản phẩm
 * thành mọi SKU đang bán của nó; người vận hành chọn "áo Bella Canvas 3001", không phải tick
 * 60 dòng "Black / S", "Black / M"…
 */
export interface SelectableRow {
  /** Khoá lựa chọn = `productId`. */
  key: string;
  productId: string;
}

export type SelectionState = Map<string, AddFlashSaleItemPayload>;

/** Bật/tắt một dòng. Trả về state MỚI (không sửa tại chỗ). */
export function toggleRow(state: SelectionState, row: SelectableRow): SelectionState {
  const next = new Map(state);
  if (next.has(row.key)) next.delete(row.key);
  else next.set(row.key, { productId: row.productId });
  return next;
}

/**
 * Bật/tắt mọi dòng CHỌN ĐƯỢC của trang hiện tại.
 *
 * 🔴 Chỉ trang hiện tại. "Chọn toàn bộ kết quả" với 100.000 SKU nghĩa là tải hết id về trình
 * duyệt — đúng thứ mà phân trang phía server sinh ra để tránh.
 */
export function togglePage(
  state: SelectionState,
  rows: readonly SelectableRow[],
  turningOn: boolean,
): SelectionState {
  const next = new Map(state);
  for (const row of rows) {
    if (turningOn) next.set(row.key, { productId: row.productId });
    else next.delete(row.key);
  }
  return next;
}

/** Mọi dòng chọn được của trang đã được chọn hết chưa. */
export function isPageFullySelected(
  state: SelectionState,
  selectableRows: readonly SelectableRow[],
): boolean {
  return selectableRows.length > 0 && selectableRows.every((row) => state.has(row.key));
}

/** Payload gửi lên backend — gồm CẢ những dòng không còn nằm trên trang hiện tại. */
export function toPayload(state: SelectionState): AddFlashSaleItemPayload[] {
  return [...state.values()];
}
