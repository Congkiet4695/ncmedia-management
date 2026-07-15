/**
 * Hợp đồng dữ liệu API dùng chung với Backend.
 * Bám theo CLAUDE.md Mục 12 + ADR-022 (errors[]) + ADR-023 (pagination page/limit).
 */

/** Envelope thành công chuẩn. */
export interface ApiResponse<T = unknown> {
  success: true;
  code: string;
  message: string;
  data: T;
  timestamp: string;
}

/** Một lỗi validate theo field (ADR-022). */
export interface ApiErrorItem {
  field: string;
  message: string;
}

/** Envelope lỗi chuẩn. */
export interface ApiErrorResponse {
  success: false;
  code: string;
  message: string;
  errors?: ApiErrorItem[];
  data: null;
  timestamp: string;
}

/** Metadata phân trang (ADR-023). */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Kết quả list có phân trang. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Tham số query phân trang gửi lên Backend. */
export interface PaginationParams {
  page?: number;
  limit?: number;
}
