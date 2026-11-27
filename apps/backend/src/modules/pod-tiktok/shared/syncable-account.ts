import { PodTiktokAccountStatus } from '@prisma/client';

/**
 * Trạng thái KẾT NỐI TikTok còn đáng gọi API trong các tiến trình ĐỒNG BỘ (đơn hàng, payout, Sync Shops).
 *
 * - `ACTIVE`: token dùng được.
 * - `ERROR`: refresh token lỗi TẠM THỜI nhiều lần liên tiếp (mạng, 5xx…) — token có thể dùng lại
 *   được. 🔴 Phải tiếp tục thử: `ERROR` chỉ trở về `ACTIVE` khi một lần refresh thành công, nên nếu
 *   bỏ qua kết nối `ERROR` thì không tiến trình nền nào refresh nữa và đơn của mọi shop thuộc kết nối
 *   đó NGỪNG cập nhật vĩnh viễn (vd đơn đã huỷ trên TikTok vẫn hiện trạng thái cũ). Lỗi lặp lại đã
 *   có circuit breaker theo shop chặn lại, không dội TikTok.
 *
 * `REAUTH_REQUIRED` / `DEAUTHORIZED` / `DISCONNECTED` / `PENDING` thì gọi chắc chắn hỏng (uỷ quyền
 * đã mất) — chỉ đốt quota chung của app — nên KHÔNG thuộc danh sách này.
 */
export const SYNCABLE_ACCOUNT_STATUSES: readonly PodTiktokAccountStatus[] = [
  PodTiktokAccountStatus.ACTIVE,
  PodTiktokAccountStatus.ERROR,
];
