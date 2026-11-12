/**
 * Bậc giá công khai của Pressify — ô chọn ở form cấu hình nhà cung cấp.
 *
 * Nguồn: tài liệu Pressify Seller API (ví dụ `tiers` của GET /product/{id}) và API thật (2026-11-11):
 * `{"11":"Silver","12":"Gold","13":"Platinum","14":"Diamond"}` — cùng giá trị với
 * `PRESSIFY_PUBLIC_TIERS` ở backend (`pressify.constants.ts`). Backend chỉ kiểm định dạng (id số), không kiểm
 * danh sách này, nên Pressify thêm bậc mới cũng không làm hỏng tài khoản đã lưu.
 *
 * Tên bậc là tên RIÊNG của Pressify ⇒ không dịch.
 */
export const PRESSIFY_PUBLIC_TIERS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '11', name: 'Silver' },
  { id: '12', name: 'Gold' },
  { id: '13', name: 'Platinum' },
  { id: '14', name: 'Diamond' },
];
