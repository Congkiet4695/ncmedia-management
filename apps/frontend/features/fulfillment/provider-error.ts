/**
 * Đọc lỗi của **nhà cung cấp fulfillment** thành câu người vận hành sửa được.
 *
 * 🔴 Vì sao không dùng thẳng `useApiError`: lỗi nhà cung cấp mang thêm `errors[]` theo TỪNG
 * FIELD (`FULFILLMENT_PROVIDER_VALIDATION`). Bỏ qua mảng đó là người dùng chỉ đọc được câu
 * "Request validation failed" — đúng thứ vô dụng đang hiện trên màn hình. Hàm này ghép
 * `message` với chi tiết field, và **không** bịa thêm chữ nào khi nhà cung cấp không nêu field.
 *
 * Thuần, không React ⇒ kiểm được bằng `npm run test:fulfill-config`.
 */

/** Một lỗi theo field do backend/nhà cung cấp trả về. */
export interface ProviderFieldError {
  field?: string;
  message?: string;
}

/** Envelope lỗi của API (phần hàm này quan tâm). */
export interface ProviderErrorBody {
  code?: string;
  message?: string;
  errors?: ProviderFieldError[];
}

/** Bóc envelope lỗi từ một lỗi axios/bất kỳ. */
export function providerErrorBody(error: unknown): ProviderErrorBody | null {
  const response = (error as { response?: { data?: unknown } } | undefined)?.response;
  const data = response?.data;
  if (!data || typeof data !== 'object') return null;
  return data as ProviderErrorBody;
}

/**
 * Chi tiết theo field, đã lọc rỗng. Rỗng ⇒ nhà cung cấp không nêu field nào.
 */
export function providerFieldErrors(error: unknown): string[] {
  const body = providerErrorBody(error);
  return (body?.errors ?? [])
    .map((entry) => {
      const field = entry.field?.trim();
      const message = entry.message?.trim();
      if (field && message) return `${field}: ${message}`;
      return field || message || '';
    })
    .filter((line) => line.length > 0);
}

/**
 * Câu hiển thị cho người dùng: thông điệp chính + các field bị từ chối.
 *
 * `fallback` là bản dịch của lỗi chung (do `useApiError` cung cấp) — dùng khi envelope không
 * có `message` riêng.
 */
export function providerErrorText(error: unknown, fallback: string): string {
  const body = providerErrorBody(error);
  const base = body?.message?.trim() || fallback;
  const details = providerFieldErrors(error);
  return details.length > 0 ? `${base} · ${details.join(' · ')}` : base;
}
