import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';
export const ANY_PERMISSIONS_KEY = 'required_any_permissions';

/**
 * @RequirePermissions('account.read', ...) — permission `resource.action` cần có để truy cập
 * route. Ngữ nghĩa **VÀ**: phải có ĐỦ mọi quyền liệt kê. Dùng cùng PermissionsGuard (ADR-010).
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * @RequireAnyPermission('a', 'b') — ngữ nghĩa **HOẶC**: có MỘT trong số đó là đủ.
 *
 * 🔴 Vì sao cần đến biến thể này: có những màn hình mà hai loại người dùng khác hẳn nhau
 * cùng phải xem được, và họ không chia sẻ quyền nào. Ví dụ TikTok Master Data — Admin tổ
 * chức đọc bằng `pod.product.read` (quyền phạm vi tổ chức), Super Admin nền tảng đọc bằng
 * `platform.masterdata.read`. Super Admin KHÔNG có `pod.product.read` và cũng không nên có:
 * đó là quyền của một tổ chức, còn Super Admin không thuộc tổ chức nghiệp vụ nào.
 *
 * Cách sai: cấp thêm quyền `pod.*` cho Super Admin — làm nhoè đúng ranh giới nền tảng /
 * tổ chức mà `SuperAdminGuard` dựng lên.
 *
 * Kết hợp được với `@RequirePermissions` trên cùng một route: bên kia là điều kiện VÀ, bên
 * này là điều kiện HOẶC, cả hai phải thoả.
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
