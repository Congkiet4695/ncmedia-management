/**
 * Hợp đồng response chuẩn toàn hệ thống (CLAUDE.md Mục 12 + ADR-022).
 */
export interface ApiErrorItem {
  field: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  errors: ApiErrorItem[] | null;
  data: T | null;
  timestamp: string;
}
