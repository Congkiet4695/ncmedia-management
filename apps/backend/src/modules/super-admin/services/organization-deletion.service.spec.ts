import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Prisma } from '@prisma/client';
import { SUPER_ADMIN_PERMISSIONS } from '../../auth/constants/default-roles';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import { SuperAdminController } from '../super-admin.controller';
import { OrganizationDeletionService } from './organization-deletion.service';
import { OrganizationNotFoundException } from './organization-review.service';

/**
 * Xoá cứng Organization — luật được khoá:
 *  1. Chỉ Super Admin (guard + quyền `platform.organization.delete` không cấp cho org admin).
 *  2. Slug xác nhận phải khớp; tổ chức hệ thống không bao giờ bị xoá.
 *  3. Bảng ngoài kế hoạch có dữ liệu / dữ liệu tổ chức khác tham chiếu vào ⇒ TỪ CHỐI, không DELETE nào.
 *  4. Lỗi giữa chừng ⇒ lỗi rõ ràng (transaction rollback), không báo thành công.
 * Hành vi thật trên Postgres (thứ tự FK, rollback, cô lập tổ chức): test/manual/e2e-hard-delete-retention.
 */

const ORG = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Co.', slug: 'acme-co' };
const operator: AuthenticatedUser = {
  userId: 'super-1',
  organizationId: 'platform',
  role: 'SUPER_ADMIN',
  jti: 'j',
};

function text(sql: Prisma.Sql): string {
  return sql.sql.replace(/\s+/g, ' ').trim();
}

function build(
  opts: {
    organization?: typeof ORG | null;
    lock?: boolean;
    extraTenantTables?: string[];
    existsWhen?: (sql: string) => boolean;
    deleteError?: Error;
  } = {},
) {
  const executed: string[] = [];
  const tenantTables = ['users', 'pod_orders', 'storage_files', ...(opts.extraTenantTables ?? [])];
  const tx = {
    $queryRaw: jest.fn((sql: Prisma.Sql) => {
      const q = text(sql);
      if (q.includes('set_config')) return Promise.resolve([{}]);
      if (q.includes('FROM organizations')) return Promise.resolve([{ id: ORG.id }]);
      if (q.includes('information_schema.columns')) {
        return Promise.resolve(tenantTables.map((table_name) => ({ table_name })));
      }
      if (q.includes('SELECT EXISTS'))
        return Promise.resolve([{ found: opts.existsWhen?.(q) ?? false }]);
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn((sql: Prisma.Sql) => {
      const q = text(sql);
      executed.push(q);
      if (opts.deleteError && q.includes('"pod_orders"')) return Promise.reject(opts.deleteError);
      return Promise.resolve(
        q.includes('"storage_files"') ? 4 : q.includes('"pod_orders"') ? 10 : 0,
      );
    }),
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]) },
  };
  const prisma = {
    organization: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.organization === undefined ? ORG : opts.organization),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const locks = {
    acquire: jest
      .fn()
      .mockResolvedValue(opts.lock === false ? null : { key: 'k', fenceToken: 'f' }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const refreshTokens = { dropCachedSessions: jest.fn().mockResolvedValue(undefined) };
  const service = new OrganizationDeletionService(
    prisma as never,
    locks as never,
    refreshTokens as never,
  );
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(service['logger'], level).mockImplementation(() => undefined);
  }
  return { service, prisma, tx, locks, refreshTokens, executed };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const body = (error as HttpException).getResponse() as { code: string };
    return body.code;
  }
  throw new Error('expected rejection');
}

describe('OrganizationDeletionService', () => {
  it('🔴 chỉ Super Admin: controller chặn bằng JwtAuthGuard + SuperAdminGuard + PermissionsGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SuperAdminController) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, SuperAdminGuard, PermissionsGuard]);
    const handler = Object.getOwnPropertyDescriptor(SuperAdminController.prototype, 'remove')
      ?.value as object;
    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[];
    expect(permissions).toEqual(['platform.organization.delete']);
    // Quyền thuộc nhóm platform.* — chỉ cấp cho SUPER_ADMIN (seed thu hồi platform.* khỏi mọi role khác).
    expect(SUPER_ADMIN_PERMISSIONS).toContain('platform.organization.delete');
  });

  it('xoá thành công: đúng thứ tự kế hoạch, mỗi lệnh lọc theo organization_id, xoá organizations CUỐI CÙNG', async () => {
    const { service, executed, refreshTokens, locks } = build();
    const result = await service.delete(operator, ORG.id, { confirmSlug: ORG.slug });

    const deletes = executed.filter((q) => q.startsWith('DELETE'));
    expect(deletes.at(-1)).toContain('DELETE FROM organizations WHERE id =');
    for (const q of deletes.slice(0, -1))
      expect(q).toMatch(/^DELETE FROM "\w+" WHERE "organization_id" = \?::uuid$/);
    const order = deletes.map((q) => /^DELETE FROM "(\w+)"/.exec(q)?.[1]).filter(Boolean);
    expect(order.indexOf('pod_listing_logs')).toBeLessThan(order.indexOf('pod_listing_jobs'));
    expect(order.indexOf('storage_files')).toBeLessThan(order.indexOf('users'));
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('roles'));

    expect(result).toMatchObject({
      organizationId: ORG.id,
      slug: ORG.slug,
      deletedRows: 14,
      storageFilesDeleted: 4,
    });
    expect(result.tables).toEqual([
      { table: 'pod_orders', deleted: 10 },
      { table: 'storage_files', deleted: 4 },
    ]);
    expect(refreshTokens.dropCachedSessions).toHaveBeenCalledWith('u-1');
    expect(refreshTokens.dropCachedSessions).toHaveBeenCalledWith('u-2');
    expect(locks.release).toHaveBeenCalledTimes(1);
  });

  it('🔴 không tìm thấy / tổ chức hệ thống ⇒ 404, không transaction nào', async () => {
    const { service, prisma } = build({ organization: null });
    await expect(
      service.delete(operator, ORG.id, { confirmSlug: ORG.slug }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundException);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORG.id, isPlatform: false } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 slug xác nhận sai ⇒ 400, không transaction nào', async () => {
    const { service, prisma } = build();
    expect(await codeOf(service.delete(operator, ORG.id, { confirmSlug: 'acme' }))).toBe(
      'PLATFORM_ORGANIZATION_DELETE_CONFIRMATION_MISMATCH',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đang có lượt xoá khác (khoá Redis) ⇒ 409 BUSY', async () => {
    const { service, prisma } = build({ lock: false });
    expect(await codeOf(service.delete(operator, ORG.id, { confirmSlug: ORG.slug }))).toBe(
      'PLATFORM_ORGANIZATION_DELETE_BUSY',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 bảng có organization_id NGOÀI kế hoạch mà có dữ liệu ⇒ TỪ CHỐI, không DELETE nào', async () => {
    const { service, executed, locks } = build({
      extraTenantTables: ['legacy_reports'],
      existsWhen: (q) => q.includes('"legacy_reports"'),
    });
    expect(await codeOf(service.delete(operator, ORG.id, { confirmSlug: ORG.slug }))).toBe(
      'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
    );
    expect(executed).toHaveLength(0);
    expect(locks.release).toHaveBeenCalledTimes(1);
  });

  it('🔴 dữ liệu tổ chức KHÁC tham chiếu vào ⇒ TỪ CHỐI, không DELETE nào (không xoá chéo tenant)', async () => {
    const { service, executed } = build({
      existsWhen: (q) => q.includes('FROM "pod_flash_sale_items" c JOIN "pod_products" p'),
    });
    let error: HttpException | undefined;
    try {
      await service.delete(operator, ORG.id, { confirmSlug: ORG.slug });
    } catch (caught) {
      error = caught as HttpException;
    }
    expect(error?.getResponse()).toMatchObject({
      code: 'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
      errors: [
        expect.objectContaining({ field: 'pod_flash_sale_items.product_id → pod_products' }),
      ],
    });
    expect(executed).toHaveLength(0);
  });

  it('🔴 còn sót dữ liệu sau khi xoá ⇒ ném lỗi trong transaction (rollback), không xoá organizations', async () => {
    let afterDeletes = false;
    const { service, executed, tx } = build({
      existsWhen: (q) => afterDeletes && q.includes('"pod_orders"'),
    });
    tx.$executeRaw.mockImplementation((sql: Prisma.Sql) => {
      const q = text(sql);
      executed.push(q);
      if (q.includes('"organization_approval_logs"')) afterDeletes = true;
      return Promise.resolve(0);
    });
    expect(await codeOf(service.delete(operator, ORG.id, { confirmSlug: ORG.slug }))).toBe(
      'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
    );
    expect(executed.some((q) => q.includes('DELETE FROM organizations'))).toBe(false);
  });

  it('🔴 lỗi database giữa chừng ⇒ 500 PLATFORM_ORGANIZATION_DELETE_FAILED (đã rollback), không dọn cache', async () => {
    const { service, refreshTokens, locks } = build({ deleteError: new Error('lock timeout') });
    expect(await codeOf(service.delete(operator, ORG.id, { confirmSlug: ORG.slug }))).toBe(
      'PLATFORM_ORGANIZATION_DELETE_FAILED',
    );
    expect(refreshTokens.dropCachedSessions).not.toHaveBeenCalled();
    expect(locks.release).toHaveBeenCalledTimes(1);
  });
});
