/**
 * Kiểu dữ liệu RAW của TikTok Shop Open API (external contract).
 *
 * Đặt tên field theo ĐÚNG snake_case mà TikTok trả về — đây là ranh giới
 * Anti-Corruption Layer: chỉ mapper được phép chuyển sang model nội bộ.
 *
 * ⚠️ Parser phải KHOAN DUNG: TikTok bổ sung field mới thường xuyên (additive),
 * nên các interface này chỉ khai báo field ĐANG DÙNG + field đã có trong tài liệu.
 */

/** Envelope chuẩn của mọi response TikTok Shop API. */
export interface TiktokApiEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
}

/**
 * `data` của Get Access Token / Get Refresh Token.
 * Nguồn: Authorization overview (doc 678e3a3292b0f40314a92d75).
 */
export interface TiktokTokenData {
  /** Access token — gửi ở header `x-tts-access-token` (API 202309+). */
  access_token: string;
  /** Unix timestamp hết hạn access token. Mặc định TikTok cấp 7 ngày. */
  access_token_expire_in: number;
  /** Refresh token — dùng để lấy access token mới (Sprint sau). */
  refresh_token: string;
  /** Unix timestamp hết hạn refresh token = đúng thời hạn seller cấp quyền. */
  refresh_token_expire_in: number;
  /** ID của người dùng đã uỷ quyền. */
  open_id: string;
  /** Tên seller. */
  seller_name?: string;
  /** Vùng của seller (vd US). */
  seller_base_region?: string;
  /** 0=Seller · 1=Creator · 2/3=Partner · 4/5=Global Selling seller. */
  user_type: number;
  /** Scope thực tế được cấp — dùng cảnh báo sớm trước khi API lỗi 105005. */
  granted_scopes?: string[];
}

/**
 * Một shop trong `data.shops[]` của Get Authorized Shops.
 * Nguồn: Get Authorized Shops (doc 6507ead7b99d5302be949ba9).
 */
export interface TiktokShopItem {
  /** Định danh nội bộ của TikTok Shop. */
  id: string;
  /** Tên shop. */
  name: string;
  /** Vùng của shop (vd GB, US). */
  region: string;
  /** LOCAL | CROSS_BORDER. */
  seller_type: string;
  /** shop_cipher — BẮT BUỘC cho mọi API entity tag `Shop`. Không cần giải mã phía dev. */
  cipher: string;
  /** Mã shop hiển thị ở Seller Center. */
  code: string;
}

/** `data` của Get Authorized Shops. */
export interface TiktokAuthorizedShopsData {
  shops: TiktokShopItem[];
}

/** Tham số gọi một API TikTok đã ký. */
export interface TiktokSignedRequestOptions {
  /** Path đầy đủ sau host, bao gồm category/version/resource. */
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Query params (chưa gồm `sign`; `app_key`/`timestamp` do client tự thêm). */
  query?: Record<string, string | number | undefined>;
  /** Body đã serialize sẵn — dùng ĐÚNG chuỗi này cho cả ký lẫn gửi. */
  bodyJson?: string;
  /** Access token (plaintext) — đi ở header, KHÔNG tham gia ký. */
  accessToken?: string;
}
