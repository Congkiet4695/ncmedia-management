/**
 * Điểm export tập trung cho types dùng chung.
 * Type nghiệp vụ (User, Organization, Order...) sẽ bổ sung theo từng module — chưa implement.
 */
export type {
  ApiResponse,
  ApiErrorItem,
  ApiErrorResponse,
  PaginationMeta,
  Paginated,
  PaginationParams,
} from './api';
