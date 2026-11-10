import { OrganizationStatus } from '@prisma/client';

/**
 * Hằng số module Super Admin — quản trị NỀN TẢNG (duyệt đăng ký Organization).
 *
 * 🔴 Đây là module duy nhất của hệ thống đọc dữ liệu XUYÊN TENANT. Nó hợp lệ vì bảng
 * `organizations` chính là **sổ đăng ký tenant**, không phải bảng nghiệp vụ của một tenant —
 * nó không mang `organization_id` và ADR-004 không áp dụng. Mọi module khác vẫn phải nhận
 * `organizationId`.
 */

/** Trường sắp xếp cho danh sách Organization (whitelist chống injection qua orderBy). */
export const SUPER_ADMIN_ORG_SORT_FIELDS = ['createdAt', 'name', 'status'] as const;
export type SuperAdminOrgSortField = (typeof SUPER_ADMIN_ORG_SORT_FIELDS)[number];

/**
 * Trạng thái được phép DUYỆT: `PENDING` và `REJECTED` (DUYỆT LẠI — yêu cầu nghiệp vụ 2026-11-11, thay quyết định cũ
 * "chỉ PENDING"). Duyệt lại gửi lại email "Organization Approved" nên người đăng ký biết hồ sơ đã được mở lại.
 * Duyệt một tổ chức ACTIVE / SUSPENDED là vô nghĩa — dùng Kích hoạt / Vô hiệu hoá.
 */
export const APPROVABLE_STATUSES: readonly OrganizationStatus[] = [
  OrganizationStatus.PENDING,
  OrganizationStatus.REJECTED,
];

/** Trạng thái được phép TỪ CHỐI — chỉ hồ sơ đang chờ duyệt. Tổ chức đã hoạt động thì Vô hiệu hoá, không "từ chối". */
export const REJECTABLE_STATUSES: readonly OrganizationStatus[] = [OrganizationStatus.PENDING];

/** VÔ HIỆU HOÁ được từ: ACTIVE / TRIAL (tổ chức đang hoạt động — kể cả đã hết hạn). */
export const DEACTIVATABLE_STATUSES: readonly OrganizationStatus[] = [
  OrganizationStatus.ACTIVE,
  OrganizationStatus.TRIAL,
];

/** KÍCH HOẠT lại được từ: SUSPENDED (đã bị vô hiệu hoá). Hồ sơ PENDING / REJECTED đi qua Duyệt, không qua đây. */
export const ACTIVATABLE_STATUSES: readonly OrganizationStatus[] = [OrganizationStatus.SUSPENDED];

/**
 * Trạng thái được đổi gói (giới hạn Shop / ngày hết hạn): mọi tổ chức đã từng được duyệt. Hồ sơ PENDING / REJECTED
 * chưa có gói — gói được đặt ở lần duyệt.
 */
export const PLAN_EDITABLE_STATUSES: readonly OrganizationStatus[] = [
  OrganizationStatus.ACTIVE,
  OrganizationStatus.TRIAL,
  OrganizationStatus.SUSPENDED,
];

/**
 * Ba nhóm thống kê của Dashboard (§10).
 *
 * `APPROVED` trên màn hình chính là `ACTIVE` trong database: Organization được duyệt xong thì
 * chuyển thẳng sang ACTIVE, không có trạng thái "đã duyệt nhưng chưa hoạt động".
 */
export const DASHBOARD_STATUS_GROUPS = {
  PENDING: OrganizationStatus.PENDING,
  APPROVED: OrganizationStatus.ACTIVE,
  REJECTED: OrganizationStatus.REJECTED,
} as const;

// ---------------------------------------------------------------------------
// Xoá cứng Organization (xem `constants/organization-deletion.plan.ts`)
// ---------------------------------------------------------------------------

/**
 * Trần thời gian của transaction xoá. Toàn bộ dữ liệu của một tổ chức đi trong MỘT transaction để lỗi
 * giữa chừng hoàn tác sạch — tổ chức lớn (hàng triệu dòng flash sale / đơn) cần nhiều phút.
 */
export const ORGANIZATION_DELETE_TX_OPTIONS = { timeout: 15 * 60_000, maxWait: 10_000 } as const;

/** Chờ khoá hàng tối đa cho mỗi lệnh — tiến trình nền đang giữ dòng của tổ chức thì báo lỗi, không treo. */
export const ORGANIZATION_DELETE_LOCK_TIMEOUT = '30s';

/** Khoá Redis chống hai lượt xoá cùng một tổ chức (bấm lặp / hai tab / hai Super Admin). */
export const ORGANIZATION_DELETE_LOCK_PREFIX = 'platform:organization-delete:';
