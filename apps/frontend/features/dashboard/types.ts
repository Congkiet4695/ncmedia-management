import type { PaginationMeta } from '@/types/api';

/** Bộ lọc chung của Dashboard — tổ chức / phạm vi seller do backend lấy từ JWT. */
export interface DashboardFilters {
  currency?: string;
  shopId?: string;
  sellerId?: string;
}

/** Khoảng ngày "YYYY-MM-DD" theo giờ vận hành (gồm trọn hai ngày mút). */
export interface DashboardRange extends DashboardFilters {
  from: string;
  to: string;
}

export interface DashboardFilterOptions {
  currencies: string[];
  shops: Array<{ id: string; name: string; region: string | null }>;
  sellers: Array<{ id: string; name: string }>;
}

export interface DashboardPeriod {
  orders: number;
  estRevenue: number;
  payout: number;
  /** % thay đổi số đơn so với kỳ liền trước; null khi kỳ trước = 0 (hoặc không so sánh). */
  orderChange: number | null;
}

export interface DashboardOverview {
  currency: string | null;
  currencies: string[];
  hold: {
    currency: string | null;
    amount: number;
    shopCount: number;
    otherCurrencies: Array<{ currency: string; amount: number; shopCount: number }>;
  };
  holdBySeller: Array<{ sellerId: string | null; sellerName: string | null; shopCount: number; amount: number }>;
  shopStatus: { live: number; inactive: number; deauthorized: number; total: number };
  periods: {
    today: DashboardPeriod;
    yesterday: DashboardPeriod;
    thisMonth: DashboardPeriod;
    lastMonth: DashboardPeriod;
  };
  timezoneOffsetMinutes: number;
}

export type OrderStatusGroup =
  | 'UNPAID'
  | 'TO_SHIP'
  | 'AWAITING_COLLECTION'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'OTHER';

export interface DashboardSummary {
  currency: string | null;
  from: string;
  to: string;
  finance: { paid: number; processing: number };
  orders: {
    total: number;
    delivered: number;
    deliveredRate: number | null;
    groups: Array<{ group: OrderStatusGroup; count: number; amount: number }>;
  };
  /** false: chưa đồng bộ TikTok Return & Refund — không có số đơn hoàn. */
  returnsAvailable: boolean;
}

export const SELLER_SORT_FIELDS = [
  'name',
  'orders',
  'estRevenue',
  'revenue',
  'baseCost',
  'profit',
  'paid',
  'processing',
  'hold',
] as const;
export type SellerSortField = (typeof SELLER_SORT_FIELDS)[number];

export interface DashboardSellerQuery extends DashboardRange {
  activeOnly: boolean;
  search?: string;
  sort: SellerSortField;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface DashboardSellerRow {
  /** null = các TikTok Account chưa gán seller. */
  sellerId: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
  active: boolean;
  orders: number;
  /** null: chưa có dữ liệu hoàn hàng. */
  returns: number | null;
  estRevenue: number;
  revenue: number;
  baseCost: number;
  profit: number;
  paid: number;
  processing: number;
  hold: number;
}

export interface DashboardSellerPage {
  currency: string | null;
  items: DashboardSellerRow[];
  meta: PaginationMeta;
}

export interface DashboardTrends {
  currency: string | null;
  from: string;
  to: string;
  finance: Array<{ day: string; paid: number; processing: number }>;
  orders: Array<{ day: string; total: number; delivered: number; inProgress: number; cancelled: number }>;
}
