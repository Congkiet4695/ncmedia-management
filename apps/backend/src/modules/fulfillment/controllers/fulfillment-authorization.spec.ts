import 'reflect-metadata';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import {
  ADMIN_ROLE_CODE,
  EMPLOYEE_DEFAULT_PERMISSIONS,
} from '../../auth/constants/default-roles';
import { PodScopeGuard } from '../../pod-tiktok/guards/pod-scope.guard';
import { FulfillmentController } from './fulfillment.controller';
import { PodOrderFulfillmentController } from './pod-order-fulfillment.controller';

/**
 * **Phân quyền Fulfill** — khoá lại ở mức metadata để lỗi "controller không có guard" không quay lại.
 *
 * 🔴 `PodOrderFulfillmentController` từng không có guard nào: `@RequirePermissions` không ai đọc,
 * `request.user` undefined ⇒ 500 "Internal server error" (lỗi Get label from TikTok).
 */

function permissionsOf(target: object, method: string): string[] {
  const handler = (target as Record<string, unknown>)[method] as object;
  return (Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[] | undefined) ?? [];
}

/** Handler có nhận `@PodScope()` không (tham số custom của route). */
function hasPodScopeParam(controller: new (...args: never[]) => unknown, method: string): boolean {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<string, unknown>;
  return Object.keys(args).some((key) => key.includes('__customRouteArgs__'));
}

describe('Phân quyền Fulfill', () => {
  it.each([
    ['PodOrderFulfillmentController', PodOrderFulfillmentController],
    ['FulfillmentController', FulfillmentController],
  ])('%s gắn đủ JwtAuthGuard + PermissionsGuard + PodScopeGuard', (_name, controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard, PodScopeGuard]);
  });

  it.each(['fulfill', 'getTiktokLabel', 'saveLabel', 'clearLabel', 'updateFulfillment'])(
    '/pod/orders — %s nhận phạm vi shop (@PodScope) để kiểm đơn thuộc shop người gọi',
    (method) => {
      expect(hasPodScopeParam(PodOrderFulfillmentController, method)).toBe(true);
    },
  );

  it.each(['fulfill', 'retry', 'cancel', 'getState', 'syncOne'])(
    '/fulfillment/orders — %s nhận phạm vi shop (@PodScope)',
    (method) => {
      expect(hasPodScopeParam(FulfillmentController, method)).toBe(true);
    },
  );

  it('Seller (EMPLOYEE) có quyền gửi đơn nhưng KHÔNG có huỷ / cấu hình nhà cung cấp / mọi shop', () => {
    const permissions: readonly string[] = EMPLOYEE_DEFAULT_PERMISSIONS;
    expect(permissions).toContain('fulfillment.create');
    expect(permissions).toContain('fulfillment.read');
    expect(permissions).toContain('fulfillment.mapping');
    expect(permissions).not.toContain('fulfillment.cancel');
    expect(permissions).not.toContain('fulfillment.config');
    expect(permissions).not.toContain('pod.shop.all');
    expect(ADMIN_ROLE_CODE).toBe('ADMIN');
  });

  it('🔴 đồng bộ HÀNG LOẠT cấp tổ chức đòi thêm pod.shop.all — Seller không chạy được', () => {
    expect(permissionsOf(FulfillmentController.prototype, 'triggerSync')).toEqual([
      'fulfillment.create',
      'pod.shop.all',
    ]);
  });

  it('gửi đơn / lấy nhãn vẫn chỉ đòi fulfillment.create (Admin không đổi hành vi)', () => {
    expect(permissionsOf(PodOrderFulfillmentController.prototype, 'fulfill')).toEqual(['fulfillment.create']);
    expect(permissionsOf(PodOrderFulfillmentController.prototype, 'getTiktokLabel')).toEqual(['fulfillment.create']);
    expect(permissionsOf(FulfillmentController.prototype, 'fulfill')).toEqual(['fulfillment.create']);
  });
});
