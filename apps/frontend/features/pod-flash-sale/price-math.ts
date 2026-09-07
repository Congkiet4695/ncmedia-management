/**
 * Phép tính giá deal **phía giao diện** — chỉ để xem trước tại chỗ.
 *
 * 🔴 **Đây KHÔNG phải nguồn sự thật.** Giá thật do backend tính lại từ đầu ở mỗi lần ghi
 * (`pod-flash-sale-pricing.ts`), và đó là con số được gửi lên sàn. File này tồn tại vì một
 * lý do duy nhất: người dùng gõ "30%" phải thấy ngay "20.99" mà không phải chờ một vòng
 * request. Nếu hai bên có lệch, phía backend đúng — và bảng luôn hiển thị lại theo response.
 *
 * Cùng công thức, cùng phép làm tròn (HALF_UP, 2 chữ số) để con số xem trước khớp con số
 * lưu xuống trong mọi trường hợp bình thường.
 */

/** Số chữ số thập phân của giá tiền — khớp `FLASH_SALE_PRICE_SCALE` của backend. */
const PRICE_SCALE = 2;

/** Chuỗi/số bất kỳ ⇒ số hữu hạn, hoặc `null`. */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Làm tròn HALF_UP tới 2 chữ số.
 *
 * 🔴 `Math.round(x * 100) / 100` sai ở đúng những chỗ hay gặp nhất: `1.005 * 100` trong
 * IEEE-754 là `100.49999999999999` ⇒ ra `1` thay vì `1.01`. Cộng `Number.EPSILON` tương đối
 * trước khi làm tròn xử lý được lớp sai số đó cho dải giá trị mà tiền tệ dùng tới.
 */
export function roundPrice(value: number): number {
  const factor = 10 ** PRICE_SCALE;
  const scaled = value * factor;
  return Math.round(scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)) / factor;
}

/** `Retail × (1 − p/100)`, đã làm tròn. */
export function dealPriceFromDiscount(originalPrice: number, discountPercent: number): number {
  return roundPrice((originalPrice * (100 - discountPercent)) / 100);
}

/** `(1 − Deal/Retail) × 100`, làm tròn 2 chữ số cho dễ đọc trên giao diện. */
export function discountFromDealPrice(originalPrice: number, dealPrice: number): number {
  if (originalPrice <= 0) return 0;
  return roundPrice((1 - dealPrice / originalPrice) * 100);
}

/** Định dạng giá để đưa vào ô nhập — luôn hai chữ số thập phân. */
export function formatAmount(value: number | null): string {
  return value === null ? '' : value.toFixed(PRICE_SCALE);
}

/**
 * Lý do một dòng chưa hợp lệ, theo đúng thứ tự backend kiểm.
 *
 * Trả `null` khi hợp lệ. Khoá dịch (không phải câu tiếng Việt) để giao diện đa ngôn ngữ —
 * thông điệp đầy đủ nằm ở `pod.json`.
 */
export function dealPriceIssue(
  originalPrice: number | null,
  dealPrice: number | null,
): 'invalid' | 'notPositive' | 'aboveRetail' | 'noDiscount' | null {
  if (originalPrice === null || dealPrice === null) return 'invalid';
  if (dealPrice <= 0) return 'notPositive';
  if (dealPrice > originalPrice) return 'aboveRetail';
  if (dealPrice === originalPrice) return 'noDiscount';
  return null;
}

/**
 * Giới hạn mua có hợp lệ không: `-1` hoặc số nguyên trong `[1, 99]`.
 *
 * Dải này của TikTok, không phải quy ước riêng của giao diện — xem `types.ts`.
 */
export function isValidQuantityLimit(value: number): boolean {
  if (value === -1) return true;
  return Number.isInteger(value) && value >= 1 && value <= 99;
}

/**
 * Ô nhập giới hạn mua ⇒ giá trị gửi lên.
 *
 * Bỏ trống nghĩa là "không giới hạn" (`-1`) — người vận hành để trống ô là đang nói "không
 * giới hạn", không phải "chưa quyết định".
 */
export function parseQuantityLimit(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return -1;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : -1;
}

/** Giá trị `-1` hiển thị thành ô trống, số khác hiển thị nguyên văn. */
export function formatQuantityLimit(value: number): string {
  return value === -1 ? '' : String(value);
}
