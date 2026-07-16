import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * @RequirePermissions('account.read', ...) — khai báo permission `resource.action` cần có
 * để truy cập route. Dùng cùng PermissionsGuard (ADR-010).
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
