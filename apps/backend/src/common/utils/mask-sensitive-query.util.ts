/**
 * Tham số trên QUERY STRING không được phép vào log dưới bất kỳ hình thức nào.
 *
 * 🔴 `redact` của pino chỉ soi được thuộc tính của object — nó KHÔNG chạm tới query
 * nằm trong chuỗi `req.url`. Redirect uỷ quyền của TikTok mang `code` và `state` ngay
 * trên URL, nên nếu không che ở đây thì access log tự nó rò rỉ mã đổi được token.
 */
export const SENSITIVE_QUERY_KEYS = [
  'code',
  'auth_code',
  'state',
  'access_token',
  'refresh_token',
];

/** Thay giá trị của các tham số nhạy cảm bằng `[REDACTED]`, giữ nguyên phần còn lại. */
export function maskSensitiveQuery(url: string): string {
  const separator = url.indexOf('?');
  if (separator < 0) return url;

  const params = new URLSearchParams(url.slice(separator + 1));
  let touched = false;
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (params.has(key)) {
      params.set(key, '[REDACTED]');
      touched = true;
    }
  }
  return touched ? `${url.slice(0, separator)}?${params.toString()}` : url;
}
