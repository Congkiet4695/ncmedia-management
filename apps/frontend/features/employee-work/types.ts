import type { PaginationMeta } from '@/types/api';

/** Cột sắp xếp của bảng — khớp `EMPLOYEE_WORK_SORT_FIELDS` phía backend. */
export const EMPLOYEE_WORK_SORT_FIELDS = ['listings', 'orders', 'profit', 'name'] as const;
export type EmployeeWorkSortField = (typeof EMPLOYEE_WORK_SORT_FIELDS)[number];

/** Bộ lọc gửi lên backend. Tổ chức KHÔNG có ở đây — backend luôn lấy từ JWT. */
export interface EmployeeWorkFilters {
  /** `YYYY-MM-DD` theo giờ vận hành. Bỏ trống ⇒ backend lấy HÔM NAY. */
  from?: string;
  to?: string;
  userId?: string;
  shopId?: string;
  currency?: string;
}

export interface EmployeeWorkQuery extends EmployeeWorkFilters {
  sort?: EmployeeWorkSortField;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export type EmployeeWorkShopStatus = 'ACTIVE' | 'INACTIVE' | 'DEAUTHORIZED';

export interface EmployeeWorkAccount {
  shopId: string;
  shopName: string;
  accountName: string;
  /** Trạng thái SHOP (không phải TikTok Account): ACTIVE = Live, INACTIVE = Die. */
  shopStatus: EmployeeWorkShopStatus;
  /** Người này phụ trách shop (TikTok Account được gán cho họ). */
  assigned: boolean;
  listings: number;
  orders: number;
  profitOrders: number;
  /** `null` = chưa đơn nào tính được lợi nhuận (KHÔNG phải 0). */
  profit: number | null;
}

export interface EmployeeWorkRow {
  /** Chỉ dùng làm khoá — giao diện không hiển thị. */
  userId: string;
  name: string;
  email: string;
  isEmployee: boolean;
  active: boolean;
  accounts: number;
  listings: number;
  orders: number;
  profitOrders: number;
  profit: number | null;
  profitPerOrder: number | null;
  accountDetails: EmployeeWorkAccount[];
}

export interface EmployeeWorkSummary {
  activeEmployees: number;
  accountsListed: number;
  productsListed: number;
  orders: number;
  profitOrders: number;
  profit: number | null;
  profitPerOrder: number | null;
}

export interface EmployeeWorkPage {
  from: string;
  to: string;
  currency: string | null;
  timezoneOffsetMinutes: number;
  summary: EmployeeWorkSummary;
  items: EmployeeWorkRow[];
  meta: PaginationMeta;
}

/** Popup của hai thẻ "Nhân viên có listing" / "Shop được listing" — cùng bộ lọc với thẻ. */
export interface EmployeeWorkListingDetails {
  from: string;
  to: string;
  /** Mỗi người MỘT dòng — số dòng = thẻ "Nhân viên có listing". */
  employees: Array<{
    userId: string;
    name: string;
    email: string;
    isEmployee: boolean;
    active: boolean;
    /** Tài khoản đã xoá sau khi listing — listing vẫn được tính trong khoảng. */
    deleted: boolean;
    listings: number;
    shops: number;
  }>;
  /** Mỗi cặp (shop × người listing) MỘT dòng — một shop có thể nhiều dòng. */
  shops: Array<{
    shopId: string;
    shopName: string;
    accountName: string;
    shopStatus: EmployeeWorkShopStatus;
    userId: string;
    userName: string;
    userEmail: string;
    listings: number;
  }>;
  /** Số shop DUY NHẤT = thẻ "Shop được listing". */
  uniqueShops: number;
}

export interface EmployeeWorkFilterOptions {
  currencies: string[];
  users: Array<{ id: string; name: string; isEmployee: boolean; active: boolean }>;
  shops: Array<{ id: string; name: string; accountName: string; region: string }>;
}
