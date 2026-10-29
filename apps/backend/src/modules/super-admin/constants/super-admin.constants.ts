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
 * Trạng thái được phép DUYỆT hoặc TỪ CHỐI.
 *
 * 🔴 Chỉ `PENDING`. Duyệt lại một Organization đang ACTIVE là thao tác vô nghĩa; "duyệt lại"
 * một Organization đã REJECTED cũng vậy — người đăng ký đã nhận email từ chối rồi, đường
 * đúng là họ đăng ký lại chứ không phải Super Admin lặng lẽ bật nó lên.
 */
export const REVIEWABLE_STATUSES: readonly OrganizationStatus[] = [OrganizationStatus.PENDING];

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
