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

/** Payload Link Account — đúng 2 field theo yêu cầu Sprint 1. */
export interface LinkTiktokAccountPayload {
  accountName: string;
  authorizationCode: string;
}

/** Link uỷ quyền để Seller mở. */
export interface PodTiktokAuthorizeUrl {
  authorizeUrl: string;
  region: string;
}

/** Một lựa chọn trong dropdown "Seller phụ trách" (Employee ACTIVE + Role EMPLOYEE). */
export interface PodSellerOption {
  id: string;
  fullName: string;
  email: string;
}
