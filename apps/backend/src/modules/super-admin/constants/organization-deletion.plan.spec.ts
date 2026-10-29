import { Prisma } from '@prisma/client';
import {
  buildOrganizationDeletionPlan,
  ORGANIZATION_DELETION_ORDER,
  type DatamodelLike,
} from './organization-deletion.plan';

/**
 * Kế hoạch xoá Organization phải khớp schema THẬT: thêm bảng nghiệp vụ mới mà quên khai ⇒ test này đỏ
 * (và lúc chạy, lệnh xoá bị từ chối) — không bao giờ âm thầm bỏ sót hay xoá nhầm bảng.
 */
describe('organization deletion plan', () => {
  const plan = buildOrganizationDeletionPlan(Prisma.dmmf.datamodel);

  it('🔴 khớp schema hiện tại: không có vấn đề nào', () => {
    expect(plan.problems).toEqual([]);
  });

  it('mọi bảng mang organization_id đều có trong kế hoạch, bảng dùng chung KHÔNG có', () => {
    const tenantModels = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'organizationId'))
      .map((model) => model.name)
      .sort();
    expect([...ORGANIZATION_DELETION_ORDER].sort()).toEqual(tenantModels);
    const tables = plan.steps.map((step) => step.table);
    for (const shared of [
      'platforms',
      'permissions',
      'pod_product_categories',
      'pod_product_brands',
      'organizations',
    ]) {
      expect(tables).not.toContain(shared);
    }
  });

  it('bảng con trước bảng cha (vài quan hệ RESTRICT tiêu biểu)', () => {
    const index = (table: string) => plan.steps.findIndex((step) => step.table === table);
    expect(index('storage_files')).toBeGreaterThan(index('pod_order_item_designs'));
    expect(index('storage_files')).toBeGreaterThan(index('pod_image_template_items'));
    expect(index('users')).toBeGreaterThan(index('storage_files'));
    expect(index('roles')).toBeGreaterThan(index('users'));
    expect(index('fulfillment_accounts')).toBeGreaterThan(index('fulfillment_orders'));
    expect(index('pod_sku_templates')).toBeGreaterThan(index('pod_listing_templates'));
  });

  it('kiểm xuyên tenant phủ cả quan hệ CASCADE lẫn SET NULL giữa các bảng nghiệp vụ', () => {
    expect(plan.crossTenantReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          childTable: 'pod_flash_sale_items',
          parentTable: 'pod_products',
          cascades: true,
        }),
        expect.objectContaining({
          childTable: 'pod_tiktok_accounts',
          parentTable: 'fulfillment_accounts',
          cascades: false,
        }),
      ]),
    );
  });

  // ---- Bộ kiểm chặn đúng những gì nó phải chặn (datamodel giả) ----

  function model(
    name: string,
    opts: {
      tenant?: boolean;
      relations?: Array<{ to: string; onDelete?: string; required?: boolean }>;
    } = {},
  ): DatamodelLike['models'][number] {
    return {
      name,
      dbName: name.toLowerCase(),
      fields: [
        { name: 'id', kind: 'scalar', type: 'String', isRequired: true },
        ...(opts.tenant
          ? [
              {
                name: 'organizationId',
                dbName: 'organization_id',
                kind: 'scalar',
                type: 'String',
                isRequired: true,
              },
            ]
          : []),
        ...(opts.relations ?? []).map((rel, i) => ({
          name: `rel${i}`,
          kind: 'object',
          type: rel.to,
          isRequired: rel.required ?? true,
          relationFromFields: [`fk${i}`],
          relationToFields: ['id'],
          relationOnDelete: rel.onDelete,
        })),
      ],
    };
  }

  it('bảng nghiệp vụ mới chưa khai trong kế hoạch ⇒ vấn đề', () => {
    const fake = {
      models: [...Prisma.dmmf.datamodel.models, model('BrandNewTenantTable', { tenant: true })],
    };
    expect(buildOrganizationDeletionPlan(fake as DatamodelLike).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('BrandNewTenantTable: mang organizationId')]),
    );
  });

  it('bảng không mang organization_id chưa phân loại ⇒ vấn đề', () => {
    const fake = { models: [...Prisma.dmmf.datamodel.models, model('MysteryChild')] };
    expect(buildOrganizationDeletionPlan(fake as DatamodelLike).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('MysteryChild: không mang organizationId')]),
    );
  });

  it('bảng dùng chung trỏ tới bảng nghiệp vụ ⇒ vấn đề (xoá tổ chức sẽ đụng dữ liệu dùng chung)', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) =>
      m.name === 'Platform'
        ? model('Platform', { relations: [{ to: 'User', onDelete: 'SetNull', required: false }] })
        : m,
    );
    expect(buildOrganizationDeletionPlan({ models }).problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Platform.rel0: bảng dùng chung trỏ tới bảng nghiệp vụ User'),
      ]),
    );
  });

  it('quan hệ RESTRICT ngược thứ tự ⇒ vấn đề', () => {
    // Role (đứng SAU User) giả vờ trỏ RESTRICT tới Employee (đứng TRƯỚC User) ⇒ Role phải đứng trước Employee.
    const models = Prisma.dmmf.datamodel.models.map((m) =>
      m.name === 'Role'
        ? model('Role', { tenant: true, relations: [{ to: 'Employee', onDelete: 'Restrict' }] })
        : m,
    );
    expect(buildOrganizationDeletionPlan({ models }).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('Role phải đứng TRƯỚC Employee')]),
    );
  });

  it('bảng con CASCADE mà khoá ngoại không phải CASCADE ⇒ vấn đề (sẽ chặn lệnh xoá)', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) =>
      m.name === 'OrderItem'
        ? model('OrderItem', { relations: [{ to: 'Order', onDelete: 'Restrict' }] })
        : m,
    );
    expect(buildOrganizationDeletionPlan({ models }).problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('OrderItem.rel0: bảng con phải đi theo Order bằng CASCADE'),
      ]),
    );
  });
});
