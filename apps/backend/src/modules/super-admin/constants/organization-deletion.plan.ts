import type { Prisma } from '@prisma/client';

/**
 * KẾ HOẠCH XOÁ CỨNG một Organization — nguồn DUY NHẤT trả lời "xoá những bảng nào, theo thứ tự nào".
 *
 * 🔴 Danh sách TƯỜNG MINH, không tự suy ra từ schema: thêm một bảng nghiệp vụ mới mà quên khai ở đây
 * thì việc xoá tổ chức bị TỪ CHỐI (xem `validateDeletionPlan` + phép quét `organization_id` lúc chạy),
 * chứ không âm thầm xoá một bảng chưa ai xem xét quyền sở hữu. Unit test khoá cả hai chiều.
 *
 * Thứ tự: bảng CON trước bảng CHA ở mọi quan hệ `Restrict` (Postgres chặn xoá cha khi còn con).
 * Quan hệ `Cascade` / `SetNull` không ràng buộc thứ tự, nhưng vẫn xoá con trước để mỗi lệnh DELETE
 * chỉ chạm đúng bảng của nó — số dòng báo về là số dòng thật của bảng đó.
 *
 * Mỗi bước là `DELETE FROM <bảng> WHERE organization_id = :id` — mọi bảng ở đây đều mang cột đó
 * (ADR-003), nên KHÔNG bao giờ chạm dữ liệu của tổ chức khác.
 */
export const ORGANIZATION_DELETION_ORDER: readonly Prisma.ModelName[] = [
  // --- Listing: log → item → job → payload → Draft Product → lượt đăng ---
  'PodListingLog',
  'PodListingJobItem',
  'PodListingJob',
  'PodListingPayloadItem',
  'PodListingPayload',
  'PodListingSessionProductImage',
  'PodListingSessionProduct',
  'PodListingSessionTemplate',
  'PodListingSessionShop',
  'PodListingSession',

  // --- Template (Listing / Group trỏ Restrict tới 5 template con) ---
  'PodListingTemplateItem',
  'PodListingTemplateScope',
  'PodListingTemplate',
  'PodGroupTemplate',
  'PodCategoryTemplateAttributeCustomValue',
  'PodCategoryTemplateAttributeValue',
  'PodCategoryTemplateAttribute',
  'PodCategoryTemplate',
  'PodSkuTemplateItemValue',
  'PodSkuTemplateItem',
  'PodSkuTemplateVariantValue',
  'PodSkuTemplateVariant',
  'PodSkuTemplate',
  'PodDescriptionTemplateToken',
  'PodDescriptionTemplate',
  'PodImageTemplateItem',
  'PodImageTemplate',
  'PodPricingStrategy',

  // --- Flash Sale ---
  'PodFlashSaleLog',
  'PodFlashSaleItem',
  'PodFlashSale',
  'PodFlashSaleTemplate',
  'PodFlashSaleAutoConfig',
  'PodFlashSaleTombstone',

  // --- Fulfillment (đơn trỏ Restrict tới tài khoản fulfillment) ---
  'FulfillmentWebhookLog',
  'FulfillmentErrorLog',
  'FulfillmentHistory',
  'FulfillmentOrderItem',
  'FulfillmentOrder',
  'FulfillmentSyncLog',
  'FulfillmentMappingCandidate',
  'FulfillmentProductDesign',
  'FulfillmentProductMapping',
  'FulfillmentVariant',
  'FulfillmentProduct',
  'FulfillmentCatalogue',

  // --- Return / Refund ---
  'PodReturnRequestItem',
  'PodReturnRequest',

  // --- Đơn TikTok (design trỏ Restrict tới storage_files) ---
  'PodOrderItemDesign',
  'PodOrderPackage',
  'PodOrderItem',
  'PodOrder',

  // --- Tài chính TikTok ---
  'PodTiktokStatementTransaction',
  'PodTiktokStatement',
  'PodTiktokUnsettledTransaction',
  'PodTiktokPayment',

  // --- Sản phẩm đã đồng bộ ---
  'PodProductRawData',
  'PodProductAttribute',
  'PodProductVideo',
  'PodProductImage',
  'PodProductVariant',
  'PodProduct',
  'PodTiktokDescriptionImage',

  // --- Đồng bộ / kho ---
  'PodResourceSyncLog',
  'PodResourceSync',
  'PodShopSyncStatus',
  'PodTiktokWarehouse',

  // --- Kết nối TikTok ---
  'PodTiktokOAuthState',
  'PodTiktokTokenAudit',
  'PodTiktokAccountCredentialAudit',
  'EmployeeAccountHandoverTransaction',
  'PodTiktokShop',
  'PodTiktokAccount',
  'FulfillmentAccount',

  // --- Storage (metadata; file vật lý KHÔNG bị xoá ở đây) — trỏ Restrict tới users ---
  'StorageFile',

  // --- Thông báo ---
  'NotificationEvent',
  'OrganizationNotificationPreference',
  'OrganizationTelegramConfig',

  // --- Order nhập tay + Shop Account (order_items/logs/notes/status_histories, account_credentials: CASCADE) ---
  'Order',
  'AccountCredentialAccessLog',
  'Account',

  // --- Nhân sự + đăng nhập + phân quyền (refresh_tokens, role_permissions: CASCADE) ---
  'Employee',
  'User',
  'Role',

  // --- Nhật ký duyệt của Super Admin (CASCADE theo organizations — xoá tường minh cho đủ số liệu) ---
  'OrganizationApprovalLog',
];

/**
 * Bảng KHÔNG mang `organization_id` mà hệ thống biết rõ vì sao an toàn:
 *  - DỮ LIỆU DÙNG CHUNG toàn nền tảng — không bao giờ bị xoá theo tổ chức.
 *  - BẢNG CON chỉ tồn tại dưới một cha của tổ chức — đi theo cha bằng `ON DELETE CASCADE`.
 *
 * Model nào không nằm ở đây cũng không nằm trong `ORGANIZATION_DELETION_ORDER` ⇒ kế hoạch không hợp lệ.
 */
export const ORGANIZATION_DELETION_GLOBAL_MODELS: readonly Prisma.ModelName[] = [
  'Organization',
  'Permission',
  'Platform',
  'PodProductCategory',
  'PodCategoryAttribute',
  'PodProductBrand',
  'PodMasterDataSync',
  'PodMasterDataSyncLog',
];

export const ORGANIZATION_DELETION_CASCADE_CHILD_MODELS: readonly Prisma.ModelName[] = [
  'RefreshToken',
  'RolePermission',
  'AccountCredential',
  'OrderItem',
  'OrderStatusHistory',
  'OrderLog',
  'OrderNote',
];

/** Cột phân tách tenant — quy ước của mọi bảng nghiệp vụ (ADR-003, CLAUDE.md Mục 11). */
export const TENANT_COLUMN = 'organization_id';
const TENANT_FIELD = 'organizationId';

/** Một bước DELETE của kế hoạch. */
export interface DeletionStep {
  model: string;
  table: string;
}

/**
 * Một quan hệ giữa hai bảng nghiệp vụ — kiểm lúc chạy: dòng của tổ chức KHÁC (hoặc không thuộc tổ
 * chức nào, khi quan hệ là CASCADE) trỏ vào dòng của tổ chức sắp xoá ⇒ xoá sẽ lan sang dữ liệu không
 * thuộc tổ chức này ⇒ TỪ CHỐI.
 */
export interface CrossTenantReference {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  /** CASCADE ⇒ dòng con không thuộc tổ chức nào cũng bị xoá theo ⇒ cũng phải chặn. */
  cascades: boolean;
}

export interface OrganizationDeletionPlan {
  steps: DeletionStep[];
  crossTenantReferences: CrossTenantReference[];
  /** Rỗng = hợp lệ. Có phần tử ⇒ không được xoá bất kỳ tổ chức nào cho tới khi sửa kế hoạch. */
  problems: string[];
}

/** Hình dạng tối thiểu của `Prisma.dmmf.datamodel` mà kế hoạch cần (tách ra để test dựng được). */
export interface DatamodelLike {
  models: ReadonlyArray<{
    name: string;
    dbName?: string | null;
    fields: ReadonlyArray<{
      name: string;
      dbName?: string | null;
      kind: string;
      type: string;
      isRequired: boolean;
      relationFromFields?: readonly string[];
      relationToFields?: readonly string[];
      relationOnDelete?: string;
    }>;
  }>;
}

type ModelLike = DatamodelLike['models'][number];

/**
 * Dựng kế hoạch từ schema thật (`Prisma.dmmf.datamodel`) và tự kiểm chứng nó.
 *
 * Kiểm: (1) mọi model mang `organizationId` đều có trong thứ tự xoá; (2) mọi model còn lại được phân
 * loại rõ (dùng chung / bảng con CASCADE); (3) thứ tự tôn trọng mọi quan hệ `Restrict`; (4) bảng con
 * không mang `organizationId` chỉ trỏ tới bảng nghiệp vụ bằng CASCADE / SET NULL (không chặn, không
 * sống sót mồ côi); (5) không bảng dùng chung nào trỏ tới bảng nghiệp vụ.
 */
export function buildOrganizationDeletionPlan(datamodel: DatamodelLike): OrganizationDeletionPlan {
  const problems: string[] = [];
  const byName = new Map(datamodel.models.map((model) => [model.name, model]));
  const isTenant = (model: ModelLike): boolean =>
    model.fields.some((field) => field.name === TENANT_FIELD && field.kind === 'scalar');
  const tableOf = (model: ModelLike): string => model.dbName ?? model.name;
  const columnOf = (model: ModelLike, fieldName: string): string =>
    model.fields.find((field) => field.name === fieldName)?.dbName ?? fieldName;

  const order = new Map(ORGANIZATION_DELETION_ORDER.map((name, index) => [name as string, index]));
  const globals = new Set<string>(ORGANIZATION_DELETION_GLOBAL_MODELS);
  const cascadeChildren = new Set<string>(ORGANIZATION_DELETION_CASCADE_CHILD_MODELS);

  if (order.size !== ORGANIZATION_DELETION_ORDER.length)
    problems.push('Thứ tự xoá có model bị lặp');

  for (const model of datamodel.models) {
    const planned = order.has(model.name);
    const tenant = isTenant(model);
    if (tenant && !planned)
      problems.push(`${model.name}: mang organizationId nhưng chưa có trong kế hoạch xoá`);
    if (!tenant && planned)
      problems.push(`${model.name}: có trong kế hoạch xoá nhưng không mang organizationId`);
    if (!tenant && !globals.has(model.name) && !cascadeChildren.has(model.name)) {
      problems.push(
        `${model.name}: không mang organizationId và chưa được phân loại (dùng chung / bảng con CASCADE)`,
      );
    }
  }
  for (const name of order.keys()) {
    if (!byName.has(name))
      problems.push(`${name}: có trong kế hoạch xoá nhưng không tồn tại trong schema`);
  }

  const crossTenantReferences: CrossTenantReference[] = [];
  for (const model of datamodel.models) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
      const parent = byName.get(field.type);
      if (!parent || parent.name === 'Organization') continue;
      // Prisma: không khai `onDelete` ⇒ Restrict với quan hệ bắt buộc, SetNull với quan hệ tuỳ chọn.
      const onDelete = field.relationOnDelete ?? (field.isRequired ? 'Restrict' : 'SetNull');
      const blocks = onDelete === 'Restrict' || onDelete === 'NoAction';
      const parentTenant = isTenant(parent);
      const childTenant = isTenant(model);

      if (parentTenant && globals.has(model.name)) {
        problems.push(
          `${model.name}.${field.name}: bảng dùng chung trỏ tới bảng nghiệp vụ ${parent.name}`,
        );
      }
      if (
        parentTenant &&
        !childTenant &&
        cascadeChildren.has(model.name) &&
        onDelete !== 'Cascade'
      ) {
        problems.push(
          `${model.name}.${field.name}: bảng con phải đi theo ${parent.name} bằng CASCADE (đang là ${onDelete})`,
        );
      }
      if (childTenant && parentTenant && blocks) {
        const childIndex = order.get(model.name);
        const parentIndex = order.get(parent.name);
        if (childIndex !== undefined && parentIndex !== undefined && childIndex >= parentIndex) {
          problems.push(
            `${model.name} phải đứng TRƯỚC ${parent.name} trong thứ tự xoá (quan hệ ${onDelete})`,
          );
        }
      }
      if (childTenant && parentTenant && field.relationFromFields.length === 1) {
        crossTenantReferences.push({
          childTable: tableOf(model),
          childColumn: columnOf(model, field.relationFromFields[0]),
          parentTable: tableOf(parent),
          parentColumn: columnOf(parent, field.relationToFields?.[0] ?? 'id'),
          cascades: onDelete === 'Cascade',
        });
      } else if (childTenant && parentTenant) {
        problems.push(
          `${model.name}.${field.name}: khoá ngoại nhiều cột — chưa hỗ trợ kiểm xuyên tenant`,
        );
      }
    }
  }

  const steps = ORGANIZATION_DELETION_ORDER.flatMap((name) => {
    const model = byName.get(name);
    return model ? [{ model: model.name, table: tableOf(model) }] : [];
  });

  return { steps, crossTenantReferences, problems };
}
