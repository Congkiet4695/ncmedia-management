/**
 * Mã lỗi TikTok Shop Open API — nguồn: "Common errors" (doc 678e3a45786253031531b942)
 * và "Rate limits" (doc 64f1991d64ed2e0295f3d2c0).
 *
 * ⚠️ `36009004` được TikTok DÙNG LẠI cho nhiều lỗi khác nhau ⇒ tài liệu yêu cầu
 * KHÔNG branch chỉ theo số code, phải kết hợp keyword trong `message`.
 */
export const TIKTOK_ERROR_CODES = {
  /** Too many requests — rate limit (đi kèm HTTP 429). */
  RATE_LIMITED: 36009002,
  /** Internal error — thử lại có backoff. */
  INTERNAL_ERROR: 36009003,
  /** Lỗi request-validation dùng chung (xem keyword trong message). */
  INVALID_REQUEST: 36009004,
  /** Request timeout. */
  TIMEOUT: 36009007,
  /** Invalid path — lỗi lập trình. */
  INVALID_PATH: 36009009,
  /** Invalid method — lỗi lập trình. */
  INVALID_METHOD: 36009010,
  /** Invalid API version. */
  INVALID_VERSION: 36009014,
  /** IP không nằm trong IP allow list của app. */
  IP_NOT_ALLOWED: 36009033,
  /** auth_code đã dùng / hết hạn / không hợp lệ. */
  INVALID_AUTH_CODE: 36004004,
  /** access_token đã hết hạn → cần refresh. */
  TOKEN_EXPIRED: 105002,
  /** Access denied — thiếu access scope. */
  SCOPE_DENIED: 105005,
  /** Invalid query/header — token sai user_type, cipher không khớp... */
  INVALID_CREDENTIAL: 101000,
  /** sign không hợp lệ — lỗi lập trình. */
  INVALID_SIGN: 106001,
  /** Thiếu shop_cipher. */
  MISSING_SHOP_CIPHER: 106013,
} as const;

/**
 * Phân lớp lỗi để chọn chiến lược xử lý (tài liệu: "Apply the right response to each class
 * instead of using one retry policy for everything").
 */
export enum TiktokErrorClass {
  /** Mạng/transport — retry có backoff. */
  NETWORK = 'NETWORK',
  /** Rate limit (HTTP 429 hoặc 36009002) — backoff + honor Retry-After. */
  RATE_LIMIT = 'RATE_LIMIT',
  /** Server tạm thời (5xx, 36009003, 36009007) — retry có backoff. */
  SERVER = 'SERVER',
  /** Token hết hạn (105002) — refresh rồi thử lại 1 lần. */
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  /** Uỷ quyền không phục hồi được (105005, 101000, 36004004) — KHÔNG retry. */
  AUTH = 'AUTH',
  /** Lỗi lập trình (sai sign/path/method/content-type) — KHÔNG retry, cần sửa code. */
  CLIENT_BUG = 'CLIENT_BUG',
  /** Sai cấu hình hạ tầng (IP allow list, lệch giờ) — KHÔNG retry, cần sửa hệ thống. */
  CONFIG = 'CONFIG',
  /** Lỗi nghiệp vụ khác — KHÔNG retry. */
  BUSINESS = 'BUSINESS',
}

/** Lớp lỗi được phép retry tự động. */
export const RETRYABLE_ERROR_CLASSES: readonly TiktokErrorClass[] = [
  TiktokErrorClass.NETWORK,
  TiktokErrorClass.RATE_LIMIT,
  TiktokErrorClass.SERVER,
];

/**
 * Phân lớp lỗi từ (httpStatus, code, message).
 * `36009004` phải xét thêm keyword — đúng hướng dẫn chính thức.
 */
export function classifyTiktokError(
  httpStatus: number,
  code: number,
  message: string,
): TiktokErrorClass {
  if (httpStatus === 429 || code === TIKTOK_ERROR_CODES.RATE_LIMITED) {
    return TiktokErrorClass.RATE_LIMIT;
  }
  if (
    httpStatus >= 500 ||
    code === TIKTOK_ERROR_CODES.INTERNAL_ERROR ||
    code === TIKTOK_ERROR_CODES.TIMEOUT
  ) {
    return TiktokErrorClass.SERVER;
  }
  if (code === TIKTOK_ERROR_CODES.TOKEN_EXPIRED) return TiktokErrorClass.TOKEN_EXPIRED;
  if (
    code === TIKTOK_ERROR_CODES.SCOPE_DENIED ||
    code === TIKTOK_ERROR_CODES.INVALID_CREDENTIAL ||
    code === TIKTOK_ERROR_CODES.INVALID_AUTH_CODE
  ) {
    return TiktokErrorClass.AUTH;
  }
  if (code === TIKTOK_ERROR_CODES.IP_NOT_ALLOWED) return TiktokErrorClass.CONFIG;
  if (code === TIKTOK_ERROR_CODES.INVALID_VERSION) return TiktokErrorClass.CLIENT_BUG;
  if (
    code === TIKTOK_ERROR_CODES.INVALID_SIGN ||
    code === TIKTOK_ERROR_CODES.INVALID_PATH ||
    code === TIKTOK_ERROR_CODES.INVALID_METHOD ||
    code === TIKTOK_ERROR_CODES.MISSING_SHOP_CIPHER
  ) {
    return TiktokErrorClass.CLIENT_BUG;
  }
  if (code === TIKTOK_ERROR_CODES.INVALID_REQUEST) {
    const m = message.toLowerCase();
    // Lệch giờ server / sai app_key → lỗi cấu hình hạ tầng.
    if (m.includes('timestamp') || m.includes('app_key')) return TiktokErrorClass.CONFIG;
    if (m.includes('version')) return TiktokErrorClass.CLIENT_BUG;
    // Còn lại (thiếu signature, header token sai, cipher thừa...) → lỗi lập trình.
    return TiktokErrorClass.CLIENT_BUG;
  }
  return TiktokErrorClass.BUSINESS;
}
