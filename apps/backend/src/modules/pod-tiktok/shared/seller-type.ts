import { TIKTOK_SELLER_TYPES } from '../constants/tiktok.constants';

/**
 * Chuẩn hoá `seller_type` TikTok trả về (chuỗi) về giá trị hợp lệ của cột
 * `pod_tiktok_shops.seller_type` (CHECK constraint: LOCAL | CROSS_BORDER).
 *
 * Giá trị lạ ⇒ `LOCAL` + `known = false` để NƠI GỌI ghi cảnh báo — TikTok thêm enum mới không
 * được làm hỏng việc liên kết / đồng bộ shop. Dùng chung cho OAuth callback và Shop Sync.
 */
export function normalizeSellerType(value: string | null | undefined): {
  value: string;
  known: boolean;
} {
  const upper = (value ?? '').toUpperCase();
  if ((TIKTOK_SELLER_TYPES as readonly string[]).includes(upper)) {
    return { value: upper, known: true };
  }
  return { value: 'LOCAL', known: false };
}
