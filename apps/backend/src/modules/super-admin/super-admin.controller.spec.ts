import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  FULFILLMENT_DEFAULT_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '../auth/constants/default-roles';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { SuperAdminController } from './super-admin.controller';

/**
 * 🔴 Chỉ Super Admin được: duyệt / duyệt lại, kích hoạt, vô hiệu hoá, đổi giới hạn Shop, đổi ngày hết hạn, xoá.
 * Ẩn nút ở giao diện KHÔNG đủ — Admin / Employee gọi thẳng API phải bị chặn ở backend.
 */
describe('SuperAdminController — phân quyền', () => {
  const permissionsOf = (handler: keyof SuperAdminController): string[] =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      Object.getOwnPropertyDescriptor(SuperAdminController.prototype, handler)?.value as object,
    ) as string[];

  it('mọi route: JwtAuthGuard + SuperAdminGuard (role SUPER_ADMIN + tổ chức hệ thống) + PermissionsGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SuperAdminController)).toEqual([
      JwtAuthGuard,
      SuperAdminGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ['approve', 'platform.organization.approve'],
    ['reject', 'platform.organization.approve'],
    ['activate', 'platform.organization.manage'],
    ['deactivate', 'platform.organization.manage'],
    ['updateShopLimit', 'platform.organization.manage'],
    ['updateExpiration', 'platform.organization.manage'],
    ['remove', 'platform.organization.delete'],
    ['list', 'platform.organization.read'],
  ] as const)('%s đòi quyền %s', (handler, permission) => {
    expect(permissionsOf(handler)).toEqual([permission]);
  });

  it('quyền platform.organization.* chỉ thuộc SUPER_ADMIN — không role mặc định nào của tổ chức có', () => {
    for (const code of ['read', 'approve', 'manage', 'delete']) {
      expect(SUPER_ADMIN_PERMISSIONS).toContain(`platform.organization.${code}`);
    }
    // Role ADMIN của tổ chức nhận mọi quyền TRỪ tiền tố `platform.` (PermissionService + seed).
    const tenantDefaults: readonly string[] = [
      ...EMPLOYEE_DEFAULT_PERMISSIONS,
      ...FULFILLMENT_DEFAULT_PERMISSIONS,
    ];
    expect(tenantDefaults.filter((code) => code.startsWith('platform.'))).toEqual([]);
  });
});
