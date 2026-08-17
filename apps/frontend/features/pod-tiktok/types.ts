import type { Paginated, PaginationParams } from '@/types/api';

/** Trạng thái kết nối TikTok Shop (khớp enum PodTiktokAccountStatus của backend). */
export const POD_TIKTOK_STATUSES = [
  'PENDING',
  'ACTIVE',
  'REAUTH_REQUIRED',
  'DEAUTHORIZED',
  'DISCONNECTED',
  'ERROR',
] as const;
export type PodTiktokStatus = (typeof POD_TIKTOK_STATUSES)[number];

/** Thị trường dùng để dựng authorization link. */
export type TiktokRegion = 'US' | 'ROW';

/** Shop TikTok đã liên kết (KHÔNG chứa shop_cipher). */
export interface PodTiktokShop {
  id: string;
  tiktokShopId: string;
  shopCode: string | null;
  name: string;
  region: string;
  sellerType: string;
  syncEnabled: boolean;
  lastOrderSyncAt: string | null;
  createdAt: string;
}

/** Chi tiết kết nối (KHÔNG chứa access/refresh token). */
export interface PodTiktokAccount {
  id: string;
  accountName: string;
  openIdMasked: string;
  sellerName: string | null;
  /** Nhà cung cấp fulfillment đang gán. NULL = chưa cấu hình ⇒ không gửi sản xuất được. */
  fulfillmentAccountId: string | null;
  fulfillmentProviderName: string | null;
  fulfillmentProviderType: string | null;
  fulfillmentProviderActive: boolean | null;

  /** Employee phụ trách (Seller). NULL = chưa phân công. Nguồn duy nhất cho Order/Payout/Dashboard. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  sellerBaseRegion: string | null;
  userType: number;
  status: PodTiktokStatus;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  accessTokenExpired: boolean;
  daysUntilReauthorize: number;
  grantedScopes: string[];
  lastRefreshedAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  shops: PodTiktokShop[];
  createdAt: string;
  updatedAt: string;
}

/** Hàng danh sách kết nối. */
export interface PodTiktokAccountListItem {
  id: string;
  accountName: string;
  sellerName: string | null;
  /** Nhà cung cấp fulfillment đang gán. NULL = chưa cấu hình ⇒ không gửi sản xuất được. */
  fulfillmentAccountId: string | null;
  fulfillmentProviderName: string | null;
  fulfillmentProviderType: string | null;
  fulfillmentProviderActive: boolean | null;

  /** Employee phụ trách (Seller). NULL = chưa phân công. Nguồn duy nhất cho Order/Payout/Dashboard. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  shopName: string | null;
  tiktokShopId: string | null;
  region: string | null;
  shopCount: number;
  status: PodTiktokStatus;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  accessTokenExpired: boolean;
  daysUntilReauthorize: number;
  lastSyncedAt: string | null;
  createdAt: string;
}

export type PodTiktokAccountListResult = Paginated<PodTiktokAccountListItem>;

export interface PodTiktokAccountQuery extends PaginationParams {
  search?: string;
  status?: PodTiktokStatus;
  sortBy?: 'createdAt' | 'accountName' | 'status' | 'accessTokenExpiresAt' | 'refreshTokenExpiresAt' | 'lastSyncedAt';
  sortOrder?: 'asc' | 'desc';
}

/** Payload tạo Authorization URL — chỉ Account Name là do người dùng nhập. */
export interface StartTiktokAuthorizationPayload {
  accountName: string;
  region?: TiktokRegion;
}

/**
 * Authorization URL để người dùng copy.
 * `state` KHÔNG được trả về đây — nó chỉ nằm trong `authorizeUrl` do backend dựng.
 */
export interface PodTiktokAuthorizeUrl {
  authorizeUrl: string;
  /** Tên kết nối đã nhập — backend gán khi callback hoàn tất. */
  accountName: string;
  region: string;
  /** Thời điểm phiên uỷ quyền hết hạn (ISO-8601). */
  expiresAt: string;
}

/**
 * Body gửi lên `POST /tiktok/oauth/complete` — đúng các tham số TikTok đặt trên URL callback.
 * 🔴 `code` chỉ đi qua bộ nhớ của trang rồi gửi thẳng xuống backend: không hiển thị,
 * không lưu localStorage/sessionStorage, không log.
 */
export interface CompleteTiktokOAuthPayload {
  code: string;
  state: string;
  appKey?: string;
  locale?: string;
  shopRegion?: string;
}

/** Kết quả `POST /tiktok/oauth/complete` — đủ để dựng màn hình kết quả. */
export interface PodTiktokOAuthCompleteResult {
  success: boolean;
  accountName: string | null;
  shopName: string | null;
  region: string | null;
  shopCount: number;
  linkedAt: string | null;
  errorCode: string | null;
  message: string | null;
}

/**
 * Kết quả một phiên uỷ quyền, đọc bằng vé `ref` trên trang kết quả công khai.
 * KHÔNG chứa auth_code hay token — backend không bao giờ trả những giá trị đó ra frontend.
 */
export interface PodTiktokLinkResult {
  success: boolean;
  accountName: string | null;
  sellerName: string | null;
  shopName: string | null;
  region: string | null;
  shopCount: number;
  linkedAt: string | null;
  errorCode: string | null;
}

/** Một lựa chọn trong dropdown "Seller phụ trách" (Employee ACTIVE + Role EMPLOYEE). */
export interface PodSellerOption {
  id: string;
  fullName: string;
  email: string;
}
