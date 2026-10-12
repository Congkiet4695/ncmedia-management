import type { PaginationMeta } from '@/types/api';
import type { PodDatePreset } from '@/features/pod-tiktok/order-types';

/** Nhóm trạng thái nội bộ — backend quyết định ánh xạ từ `return_status` TikTok. */
export const RETURN_STATUS_GROUPS = ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'OTHER'] as const;
export type ReturnStatusGroup = (typeof RETURN_STATUS_GROUPS)[number];

export interface PodReturnItemGroup {
  productName: string | null;
  sellerSku: string | null;
  skuName: string | null;
  productImageUrl: string | null;
  quantity: number;
}

/** Tiền là chuỗi thập phân (Decimal) — chỉ đổi sang số ở bước hiển thị. */
export interface PodReturn {
  id: string;
  tiktokReturnId: string;
  tiktokOrderId: string;
  /** Đơn POD tương ứng (nếu đã đồng bộ) — link sang chi tiết đơn. */
  orderId: string | null;
  shopId: string;
  shopName: string | null;
  accountId: string;
  accountName: string | null;
  /** Giá trị TikTok nguyên văn. */
  returnType: string;
  returnStatus: string;
  statusGroup: ReturnStatusGroup;
  /** TikTok xác nhận đã hoàn tiền cho người mua. */
  refundCompleted: boolean;
  reasonCode: string | null;
  reasonText: string | null;
  role: string | null;
  arbitrationStatus: string | null;
  sellerProposedReturnType: string | null;
  partialRefundAmount: string | null;
  currency: string | null;
  paidAmount: string | null;
  requestedRefund: string | null;
  refundSubtotal: string | null;
  refundShippingFee: string | null;
  refundTax: string | null;
  /** Doanh thu của ĐƠN bị trừ lại trong statement đã quyết toán (cấp đơn). */
  orderSettledRefund: string | null;
  itemQuantity: number;
  itemGroups: PodReturnItemGroup[];
  returnTrackingNumber: string | null;
  requestedAt: string;
  tiktokUpdatedAt: string;
  lastSyncedAt: string;
}

export interface PodReturnListResult {
  items: PodReturn[];
  meta: PaginationMeta;
}

export interface PodReturnFilter {
  search?: string;
  shopId?: string;
  accountId?: string;
  returnType?: string;
  statusGroup?: ReturnStatusGroup;
  returnStatus?: string;
  reason?: string;
  dateField?: 'requestedAt' | 'updatedAt';
  datePreset?: PodDatePreset;
  from?: string;
  to?: string;
}

export interface PodReturnQuery extends PodReturnFilter {
  page?: number;
  limit?: number;
  sortBy?: 'requestedAt' | 'tiktokUpdatedAt' | 'refundTotal';
  sortOrder?: 'asc' | 'desc';
}

export interface PodReturnMoneyByCurrency {
  currency: string;
  requestedRefund: string;
  refundedByRequest: string;
  settledRefund: string;
}

export interface PodReturnSummary {
  totalRequests: number;
  byGroup: Record<ReturnStatusGroup, number>;
  orders: number;
  refundedOrders: number;
  itemQuantity: number;
  amounts: PodReturnMoneyByCurrency[];
}

export interface PodReturnFilterOptions {
  returnTypes: string[];
  returnStatuses: string[];
  reasons: Array<{ value: string; label: string | null }>;
}

export interface PodReturnHistoryEntry {
  time: string | null;
  event: string | null;
  role: string | null;
  description: string | null;
  note: string | null;
  reason: string | null;
  attachments: number;
}

export interface PodReturnHistory {
  entries: PodReturnHistoryEntry[];
  syncedAt: string | null;
  live: boolean;
  errorCode: string | null;
}

export interface PodReturnShopSyncResult {
  shopId: string;
  shopName: string | null;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'RUNNING';
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  notified: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PodReturnSyncResult {
  shops: PodReturnShopSyncResult[];
}
