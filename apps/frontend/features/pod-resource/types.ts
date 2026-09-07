/**
 * Tài nguyên TikTok **của tổ chức** — thứ mỗi Organization tự đồng bộ.
 *
 * 🔴 CATEGORY / BRAND / CATEGORY_ATTRIBUTE đã RỜI khỏi đây: chúng là dữ liệu master toàn
 * cục, chỉ Super Admin đồng bộ (`features/pod-master-data`). Còn lại đúng kho hàng — thứ
 * thật sự khác nhau giữa các shop.
 */
export const POD_RESOURCE_TYPES = ['WAREHOUSE'] as const;
export type PodResourceType = (typeof POD_RESOURCE_TYPES)[number];

export type PodResourceSyncStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

/** Một dòng trên màn hình Resources. */
export interface PodResourceStatus {
  resource: PodResourceType;
  /** Số bản ghi ĐANG CÓ trong cache (đếm thật trong database). */
  totalRecords: number;
  status: PodResourceSyncStatus;
  lastSyncAt: string | null;
  durationMs: number | null;
  lastError: string | null;
  jobId: string | null;
}

/** Kết quả một lần bấm Sync. */
export interface PodResourceSyncResult {
  resource: PodResourceType;
  jobId: string;
  status: PodResourceSyncStatus;
  totalRecords: number;
  durationMs: number;
  shops: number;
  failedShops: number;
  error: string | null;
  details: Array<{ shopId: string; shopName: string; records: number; error?: string }>;
}

/** Một dòng nhật ký. `shopName = null` là dòng tổng kết của cả lượt. */
export interface PodResourceSyncLog {
  id: string;
  resource: PodResourceType;
  jobId: string;
  status: PodResourceSyncStatus;
  shopId: string | null;
  shopName: string | null;
  totalRecords: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}
