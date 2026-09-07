/**
 * Tên sự kiện cho log Auth có cấu trúc.
 *
 * 🔴 Một danh sách đóng, không phải chuỗi tự do rải rác trong code: log auth là thứ duy
 * nhất còn lại để dựng lại một phiên đã hỏng trên production. Grep được `AUTH_REFRESH_FAILED`
 * ra đúng mọi lần thất bại chỉ đúng khi tên sự kiện là hằng số dùng chung.
 */
export const AUTH_EVENT = {
  LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
  LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  ACCESS_TOKEN_EXPIRED: 'AUTH_ACCESS_TOKEN_EXPIRED',
  REFRESH_STARTED: 'AUTH_REFRESH_STARTED',
  REFRESH_SUCCESS: 'AUTH_REFRESH_SUCCESS',
  REFRESH_FAILED: 'AUTH_REFRESH_FAILED',
  REFRESH_REUSE_DETECTED: 'AUTH_REFRESH_REUSE_DETECTED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  LOGOUT: 'AUTH_LOGOUT',
} as const;

export type AuthEvent = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

/**
 * Lý do một lần refresh bị từ chối. Đi vào log dưới trường `reason` và là thứ đầu tiên
 * người vận hành đọc khi có báo cáo "tự nhiên bị đăng xuất".
 */
export const AUTH_REFRESH_FAILURE = {
  /** Chữ ký sai / sai secret / payload không đúng định dạng. */
  MALFORMED: 'MALFORMED',
  /** JWT còn đúng nhưng đã quá hạn `exp`. */
  EXPIRED: 'EXPIRED',
  /** Không có bản ghi nào trong `refresh_tokens` khớp hash → token chưa từng được phát. */
  NOT_FOUND: 'NOT_FOUND',
  /** Bản ghi đã bị thu hồi quá cửa sổ ân hạn → nghi ngờ token bị đánh cắp. */
  REUSED: 'REUSED',
  /** Bản ghi hết hạn trong database. */
  DB_EXPIRED: 'DB_EXPIRED',
  /** User không còn / bị xoá mềm / khác tenant. */
  SUBJECT_GONE: 'SUBJECT_GONE',
  /** User bị vô hiệu hoá / khoá. */
  USER_DISABLED: 'USER_DISABLED',
  /** Organization rời khỏi trạng thái cho phép đăng nhập. */
  ORGANIZATION_BLOCKED: 'ORGANIZATION_BLOCKED',
} as const;

export type AuthRefreshFailure =
  (typeof AUTH_REFRESH_FAILURE)[keyof typeof AUTH_REFRESH_FAILURE];
