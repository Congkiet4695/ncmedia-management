import type { PaginationParams } from '@/types/api';

/**
 * Trạng thái Organization.
 *
 * 🔴 `PENDING` / `REJECTED` thuộc luồng duyệt đăng ký; `SUSPENDED` / `DELETED` là trạng thái
 * của một tổ chức ĐÃ từng hoạt động. Màn Super Admin lọc theo cả sáu nhưng chỉ thao tác được
 * trên `PENDING`.
 */
export const ORGANIZATION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'TRIAL',
  'SUSPENDED',
  'DELETED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Trạng thái trên bộ lọc chính: chờ duyệt / đã duyệt / bị từ chối / bị vô hiệu hoá. */
export const ORGANIZATION_FILTER_STATUSES: OrganizationStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];

/** Trạng thái được Duyệt (PENDING) hoặc Duyệt lại (REJECTED) — khớp backend. */
export const APPROVABLE_STATUSES: OrganizationStatus[] = ['PENDING', 'REJECTED'];
/** Vô hiệu hoá được từ ACTIVE / TRIAL; kích hoạt lại từ SUSPENDED. */
export const DEACTIVATABLE_STATUSES: OrganizationStatus[] = ['ACTIVE', 'TRIAL'];
export const ACTIVATABLE_STATUSES: OrganizationStatus[] = ['SUSPENDED'];
/** Đổi gói (giới hạn Shop / ngày hết hạn): tổ chức đã được duyệt. */
export const PLAN_EDITABLE_STATUSES: OrganizationStatus[] = ['ACTIVE', 'TRIAL', 'SUSPENDED'];

/** Chủ Organization — người đã bấm nút đăng ký. */
export interface OrganizationOwner {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
}

/** Một dòng trong danh sách Organization (§6). */
export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  /** Thời điểm đăng ký = thời điểm tạo Organization. */
  registeredAt: string;
  createdAt: string;
  /** Số Shop tối đa. `null` = chưa có gói (hồ sơ chưa từng được duyệt). */
  shopLimit: number | null;
  /** Shop TikTok đang kết nối (đã liên kết, chưa gỡ). */
  connectedShopCount: number;
  /** ISO 8601. Mặc định khi duyệt lần đầu = ngày ĐĂNG KÝ + 30 ngày. `null` = chưa có gói. */
  expiresAt: string | null;
  /** now >= expiresAt. */
  expired: boolean;
  owner: OrganizationOwner | null;
}

export const APPROVAL_ACTIONS = [
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'DEACTIVATE',
  'UPDATE_SHOP_LIMIT',
  'UPDATE_EXPIRATION',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** Một dòng nhật ký duyệt (§13). */
export interface OrganizationApprovalLog {
  id: string;
  action: ApprovalAction;
  oldStatus: OrganizationStatus;
  newStatus: OrganizationStatus;
  reason: string | null;
  operatorEmail: string;
  operatorFullName: string;
  createdAt: string;
}

/** Chi tiết Organization (§7). */
export interface OrganizationDetail extends OrganizationRow {
  userCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  updatedAt: string;
  approvalLogs: OrganizationApprovalLog[];
  /** Chỉ có trong response của Approve/Reject: email thông báo đã gửi được chưa. */
  emailSent?: boolean;
}

export interface OrganizationQuery extends PaginationParams {
  status?: OrganizationStatus;
  search?: string;
  sortBy?: 'createdAt' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/** Bốn con số của Super Admin Dashboard (§10). */
export interface SuperAdminDashboard {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

/** Kết quả XOÁ CỨNG một Organization (số dòng đã xoá theo bảng). */
export interface OrganizationDeletionResult {
  organizationId: string;
  name: string;
  slug: string;
  deletedRows: number;
  tables: Array<{ table: string; deleted: number }>;
  /** Bản ghi file đã xoá — file vật lý trên kho lưu trữ KHÔNG bị xoá. */
  storageFilesDeleted: number;
  durationMs: number;
}
