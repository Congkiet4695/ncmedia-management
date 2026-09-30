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

/**
 * Chi tiết an toàn của lỗi nhà cung cấp/TikTok do backend gửi kèm (không token, không chữ ký, không
 * địa chỉ): nhà cung cấp · bước lỗi · mã lỗi của họ · request id để đối soát.
 */
export interface ProviderErrorDetails {
  provider?: string;
  operation?: string;
  providerCode?: string | null;
  requestId?: string | null;
}

/** Envelope lỗi của API (phần hàm này quan tâm). */
export interface ProviderErrorBody {
  code?: string;
  message?: string;
  errors?: ProviderFieldError[];
  details?: ProviderErrorDetails | null;
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
  const text = details.length > 0 ? `${base} · ${details.join(' · ')}` : base;
  const trace = providerErrorTrace(body?.details);
  return trace ? `${text} [${trace}]` : text;
}

/**
 * `TIKTOK · SHIPPING_DOCUMENT · 21042102 · req-abc` — đủ để báo lỗi/đối soát. Rỗng khi backend
 * không gửi chi tiết.
 */
export function providerErrorTrace(details: ProviderErrorDetails | null | undefined): string {
  if (!details || typeof details !== 'object') return '';
  return [details.provider, details.operation, details.providerCode, details.requestId]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' · ');
}

/**
 * Request KHÔNG nhận được phản hồi nào (hết thời gian chờ, mất mạng, CORS) — khác hẳn "server trả
 * lỗi": thao tác phía server có thể vẫn đang chạy hoặc đã xong.
 */
export function isNoResponseError(error: unknown): boolean {
  const candidate = error as { isAxiosError?: boolean; response?: unknown } | null | undefined;
  return candidate?.isAxiosError === true && !candidate.response;
}
