/**
 * Phiên bị chặn vì TỔ CHỨC (không phải vì người dùng): chờ duyệt, bị từ chối, bị vô hiệu hoá, hết hạn gói.
 *
 * Backend trả 403 kèm một trong các mã dưới đây ở login, `/auth/me` VÀ mọi API (JwtAuthGuard kiểm trạng thái tổ
 * chức mỗi request). `api-client` gặp mã này ⇒ kết thúc phiên và chuyển về `/login?reason=<mã>`; màn đăng nhập đọc
 * `reason` để nói đúng lý do (bản dịch `validation:serverError.<mã>`).
 */
export const ORGANIZATION_BLOCK_CODES: ReadonlySet<string> = new Set([
  'AUTH_ORGANIZATION_EXPIRED',
  'AUTH_ORGANIZATION_DEACTIVATED',
  'AUTH_ORGANIZATION_INACTIVE',
  'AUTH_ORGANIZATION_PENDING',
  'AUTH_ORGANIZATION_REJECTED',
]);

/** Tham số trên URL `/login` mang lý do phiên bị kết thúc. */
export const LOGIN_REASON_PARAM = 'reason';
