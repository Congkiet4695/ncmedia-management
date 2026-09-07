/**
 * TikTok Master Data **TOÀN CỤC** — Categories / Brands / Category Attributes.
 *
 * 🔴 Ba tài nguyên này KHÔNG còn thuộc về tổ chức nào. Super Admin đồng bộ một lần, mọi
 * Organization đọc chung. Vì thế không có `shopId` ở bất kỳ đâu trong file này.
 */
export const POD_MASTER_DATA_RESOURCES = ['CATEGORY', 'BRAND', 'CATEGORY_ATTRIBUTE'] as const;
export type PodMasterDataResource = (typeof POD_MASTER_DATA_RESOURCES)[number];

export type PodMasterDataStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

/** Một dòng trên bảng TikTok Master Data. */
export interface PodMasterDataResourceStatus {
  resource: PodMasterDataResource;
  /** Số bản ghi ĐANG CÓ (đếm thật trong database). */
  totalRecords: number;
  status: PodMasterDataStatus;
  /** Lần đồng bộ THÀNH CÔNG gần nhất. Lượt hỏng không đẩy mốc này lên. */
  lastSyncAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  durationMs: number | null;
  lastError: string | null;
  jobId: string | null;
  dependsOn: PodMasterDataResource | null;
  /** `false` ⇒ khoá nút Sync vì phụ thuộc chưa có dữ liệu. */
  ready: boolean;
}

/**
 * Toàn cảnh Master Data.
 *
 * 🔴 `canSync` đến từ SERVER (permission `platform.masterdata.sync`), không suy ra từ tên
 * role ở frontend: Role là động, một tổ chức tự tạo được role tên `SUPER_ADMIN`. Giao diện
 * chỉ ẩn/hiện nút theo cờ này; hàng rào thật nằm ở `SuperAdminGuard` phía backend.
 */
export interface PodMasterDataOverview {
  canSync: boolean;
  resources: PodMasterDataResourceStatus[];
}

/** Kết quả một lượt bấm Sync. */
export interface PodMasterDataSyncResult {
  jobId: string;
  status: PodMasterDataStatus;
  totalRecords: number;
  durationMs: number;
  sourceShopId: string | null;
  error: string | null;
  details: Array<{
    resource: PodMasterDataResource;
    status: PodMasterDataStatus;
    records: number;
    durationMs: number;
    error?: string;
  }>;
}

/** Một dòng nhật ký đồng bộ (chỉ Super Admin đọc được). */
export interface PodMasterDataSyncLog {
  id: string;
  resource: PodMasterDataResource;
  jobId: string;
  status: PodMasterDataStatus;
  totalRecords: number;
  durationMs: number;
  errorMessage: string | null;
  sourceShopId: string | null;
  startedAt: string;
  finishedAt: string | null;
}
