import type { Paginated } from '@/types/api';
import type { PodDatePreset } from './order-types';

/**
 * Trạng thái chi trả — GIỮ NGUYÊN giá trị TikTok trả về.
 *
 * 🔴 TikTok Finance API chỉ định nghĩa 3 trạng thái này (Get Payments `status`).
 * KHÔNG có `CANCELLED` — không thêm giá trị không tồn tại vào bộ lọc.
 */
export const POD_PAYOUT_STATUSES = ['PROCESSING', 'PAID', 'FAILED'] as const;
export type PodPayoutStatus = (typeof POD_PAYOUT_STATUSES)[number];

/** Nhãn hiển thị nằm ở `i18n/locales/<lang>/pod.json` (khoá `payout.status.*`). */

/** Bộ lọc dùng chung cho cả 3 API báo cáo. */
export interface PodPayoutFilter {
  datePreset?: PodDatePreset;
  fromDate?: string;
  toDate?: string;
  payoutStatus?: PodPayoutStatus;
  search?: string;
}

export interface PodPayoutBreakdownQuery extends PodPayoutFilter {
  page?: number;
  pageSize?: number;
  sortField?: PodPayoutSortField;
  sortOrder?: 'asc' | 'desc';
}

export const POD_PAYOUT_SORT_FIELDS = [
  'totalPayout',
  'orderCount',
  'accountCount',
  'name',
] as const;
export type PodPayoutSortField = (typeof POD_PAYOUT_SORT_FIELDS)[number];

export interface PodPayoutRange {
  from: string | null;
  to: string | null;
}

export interface PodPayoutSummary {
  /** Chuỗi thập phân — KHÔNG parse sang number khi hiển thị để không mất độ chính xác. */
  totalPayout: string;
  currency: string | null;
  paymentCount: number;
  accountCount: number;
  sellerCount: number;
  orderCount: number;
  range: PodPayoutRange;
  /** Nhiều hơn một đơn vị tiền tệ ⇒ tổng cộng dồn không có ý nghĩa, phải cảnh báo. */
  currencies: string[];
}

export interface PodPayoutSeller {
  /** ID Employee phụ trách. NULL = chưa phân công. */
  sellerId: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  accountCount: number;
  orderCount: number;
  totalPayout: string;
  currency: string | null;
}

export interface PodPayoutAccount {
  accountId: string;
  accountName: string;
  shopName: string | null;
  /** ID Employee phụ trách. NULL = chưa phân công. */
  sellerId: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  orderCount: number;
  totalPayout: string;
  currency: string | null;
}

export type PodPayoutSellerListResult = Paginated<PodPayoutSeller>;
export type PodPayoutAccountListResult = Paginated<PodPayoutAccount>;

export interface TriggerPayoutSyncPayload {
  shopId?: string;
  full?: boolean;
}

export interface PodPayoutSyncResult {
  shopsTotal: number;
  shopsSucceeded: number;
  shopsFailed: number;
  paymentsCreated: number;
  paymentsUpdated: number;
  statementsCreated: number;
  statementsUpdated: number;
  statementsWithTransactions: number;
  apiCalls: number;
  durationMs: number;
}
