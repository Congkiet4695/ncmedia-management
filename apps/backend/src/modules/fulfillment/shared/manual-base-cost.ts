/**
 * Số chữ số thập phân hợp lệ của MỘT đơn vị tiền (USD 2, JPY 0, KWD 3) — theo dữ liệu ISO 4217 có sẵn
 * trong `Intl` của Node. Không có bảng tự chép.
 */
export function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** `value` có nhiều hơn `digits` chữ số thập phân không (so sánh trên chuỗi, tránh sai số float). */
export function exceedsFractionDigits(value: number, digits: number): boolean {
  const [, fraction = ''] = String(value).split('.');
  // Dạng 1e-7 ⇒ coi là quá số lẻ cho mọi đơn vị tiền thực tế.
  if (/e/i.test(String(value))) return true;
  return fraction.length > digits;
}
