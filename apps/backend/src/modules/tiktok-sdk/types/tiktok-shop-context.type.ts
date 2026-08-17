/**
 * Ngữ cảnh gọi API cho MỘT shop TikTok.
 *
 * 🔴 Mọi API nhóm `Shop` đều cần cả access token lẫn `shop_cipher`
 * (01-tiktok-documentation-summary §4.3). Gói chung một object để không thể quên
 * một trong hai, và để không service nào phải tự đi giải mã credential.
 */
export interface TiktokShopContext {
  /** Access token đã GIẢI MÃ. Chỉ sống trong bộ nhớ, không log, không trả ra API. */
  accessToken: string;
  /** `shop_cipher` đã GIẢI MÃ của shop đích. */
  shopCipher: string;
  /** ID shop nội bộ (UUID) — chỉ dùng để log/metric, không gửi đi TikTok. */
  shopId?: string;
  /** Organization sở hữu shop — dùng cho log tenant-aware (ADR-004). */
  organizationId?: string;
}

/** Kết quả một lần gọi SDK: dữ liệu nghiệp vụ + `request_id` để mở ticket với TikTok. */
export interface TiktokSdkResult<T> {
  data: T;
  requestId?: string;
}

/** Một trang dữ liệu phân trang theo `page_token` của TikTok. */
export interface TiktokPage<T> {
  items: T[];
  nextPageToken?: string;
  totalCount?: number;
}
