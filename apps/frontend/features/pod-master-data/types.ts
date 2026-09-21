/**
 * TikTok Master Data **TOÀN CỤC** — Categories / Brands / Category Attributes.
 *
 * 🔴 Ba tài nguyên này KHÔNG còn thuộc về tổ chức nào. Super Admin đồng bộ một lần, mọi
 * Organization đọc chung. Vì thế không có `shopId` ở bất kỳ đâu trong file này.
 */
export const POD_MASTER_DATA_RESOURCES = ['CATEGORY', 'BRAND', 'CATEGORY_ATTRIBUTE'] as const;
export type PodMasterDataResource = (typeof POD_MASTER_DATA_RESOURCES)[number];

export type PodMasterDataStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

/**
 * Tiến độ của lượt ĐANG chạy — chỉ có khi tài nguyên ở trạng thái RUNNING.
 *
 * 🔴 Quét thương hiệu là hàng chục nghìn lời gọi TikTok kéo dài hàng giờ. Không có con số
 * này, người vận hành nhìn badge RUNNING suốt hai tiếng sẽ tưởng lượt đã treo và bấm lại.
 */
export interface PodMasterDataSyncProgress {
  jobId: string;
  resource: PodMasterDataResource;
  /** Số lời gọi TikTok đã thực hiện. */
  apiCalls: number;
  /** Số bản ghi thô đã nhận từ TikTok. */
  fetched: number;
  /** Số bản ghi MỚI đã ghi vào database. */
  records: number;
  /** Vị trí đang xử lý (vd prefix thương hiệu đang quét). */
  detail: string | null;
  updatedAt: string;
}

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
  /** Tiến độ lượt đang chạy — chỉ khác null khi `status = RUNNING`. */
  progress: PodMasterDataSyncProgress | null;
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

/**
 * Xác nhận đã NHẬN lượt đồng bộ (HTTP 202).
 *
 * 🔴 `POST /sync` không đợi lượt chạy xong: quét thương hiệu kéo dài hàng giờ. Kết quả
 * cuối đọc từ `status` (polling khi còn RUNNING) — xem `useSyncMasterDataWithToast`.
 */
export interface PodMasterDataSyncStarted {
  jobId: string;
  status: PodMasterDataStatus;
  resources: PodMasterDataResource[];
  sourceShopId: string;
  startedAt: string;
}

/** Kết quả một lượt đồng bộ (đọc từ nhật ký / trạng thái sau khi lượt kết thúc). */
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
