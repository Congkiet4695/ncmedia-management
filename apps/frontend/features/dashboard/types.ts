import type { PaginationMeta } from '@/types/api';

/** Bộ lọc chung của Dashboard — tổ chức / phạm vi seller do backend lấy từ JWT. */
export interface DashboardFilters {
  currency?: string;
  shopId?: string;
  sellerId?: string;
}

/**
 * Khoảng ngày "YYYY-MM-DD" theo giờ vận hành (gồm trọn hai ngày mút).
 * `allTime` ⇒ "Tất cả thời gian": `from` / `to` để trống (không gửi), backend lấy từ ngày có dữ liệu sớm nhất.
 */
export interface DashboardRange extends DashboardFilters {
  from: string;
  to: string;
  allTime?: boolean;
}

/** Lựa chọn nhanh của bộ lọc thời gian (đúng thứ tự hiển thị); `CUSTOM` = người dùng tự chọn ngày. */
export const DASHBOARD_DATE_PRESETS = ['TODAY', 'YESTERDAY', 'THIS_MONTH', 'LAST_MONTH', 'ALL'] as const;
export type DashboardDatePreset = (typeof DASHBOARD_DATE_PRESETS)[number] | 'CUSTOM';

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
  /** false: chưa shop nào trong phạm vi đồng bộ TikTok Return & Refund thành công. */
  returnsAvailable: boolean;
  /**
   * Return/Refund của các đơn trong khoảng. `settledRefund` = doanh thu bị trừ trong statement đã quyết
   * toán — ĐÃ nằm trong Est. Revenue / Profit (chỉ để xem, không trừ thêm). NULL khi chưa có dữ liệu.
   */
  returns: { requests: number; returnedOrders: number; refundedOrders: number; settledRefund: number } | null;
}

export const SELLER_SORT_FIELDS = [
  'name',
  'orders',
  'revenue',
  'baseCost',
  'shippingFee',
  'label',
  'profit',
  'currentProfit',
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
  /** Số đơn có yêu cầu Return/Refund còn hiệu lực. null: chưa có dữ liệu hoàn hàng. */
  returns: number | null;
  /** Σ tiền thu về từng đơn: đã quyết toán nếu có, chưa thì ước tính (mỗi đơn MỘT giá trị). */
  revenue: number;
  /** Số đơn có tiền thu về — phần còn lại chưa có dữ liệu tài chính. */
  revenueOrders: number;
  /** Σ giá vốn đã xác nhận của lần fulfill đang giữ đơn. */
  baseCost: number;
  baseCostOrders: number;
  /** Σ phí ship Seller từng đơn (mỗi đơn MỘT giá trị — cùng nguồn màn Order). */
  shippingFee: number;
  /** Số đơn đã xác định được phí ship Seller — phần còn lại chưa có dữ liệu. */
  shippingFeeOrders: number;
  /** Số đơn đã fulfill (mỗi đơn một label). */
  fulfilledOrders: number;
  /** Σ label của đơn đã fulfill; `null` khi label khác đơn vị tiền đang xem. */
  label: number | null;
  /** Phần của Shipping Fee ĐÃ nằm trong Doanh thu (TikTok đã trừ) — Profit Dự kiến không trừ lần hai. */
  shippingIncluded: number;
  /**
   * Profit Dự kiến = Revenue − Basecost − Shipping Fee − Label, không trừ hai lần phần phí ship đã nằm trong
   * Revenue (backend tính); `null` khi Label khác đơn vị tiền.
   */
  profit: number | null;
  /** Số đơn tính được lợi nhuận từng đơn đủ dữ kiện (công thức màn Order) — tham khảo. */
  profitOrders: number;
  /** Current Profit = Paid − Basecost − Label − Shipping Fee (backend tính); `null` khi Label khác đơn vị tiền. */
  currentProfit: number | null;
  paid: number;
  processing: number;
  hold: number;
}

/** Bộ lọc chung + trang — popup của thẻ tổng quan. */
export interface DashboardPageQuery extends DashboardFilters {
  page: number;
  limit: number;
}

/** Trạng thái shop thật — Live = ACTIVE, Die = INACTIVE. */
export type DashboardShopStatus = 'ACTIVE' | 'INACTIVE' | 'DEAUTHORIZED';

export interface DashboardHoldShopPage {
  currency: string | null;
  /** Σ hold mọi shop (mọi trang) — bằng số trên thẻ. */
  totalAmount: number;
  items: Array<DashboardShopSeller & { shopId: string; shopName: string | null; accountName: string | null; amount: number }>;
  meta: PaginationMeta;
}

/** Seller Employee phụ trách shop (gán ở TikTok Account của shop); chưa gán ⇒ cả ba `null`. */
export interface DashboardShopSeller {
  sellerId: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
}

export interface DashboardShopListPage {
  status: DashboardShopStatus;
  items: Array<DashboardShopSeller & { shopId: string; shopName: string; accountName: string | null; region: string | null }>;
  meta: PaginationMeta;
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
