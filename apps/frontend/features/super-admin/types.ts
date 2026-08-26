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

/** Ba trạng thái xuất hiện trên bộ lọc chính (§6). */
export const ORGANIZATION_FILTER_STATUSES: OrganizationStatus[] = [
  'PENDING',
  'ACTIVE',
  'REJECTED',
];

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
  owner: OrganizationOwner | null;
}

export const APPROVAL_ACTIONS = ['APPROVE', 'REJECT'] as const;
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
