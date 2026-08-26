import { Injectable } from '@nestjs/common';
import {
  FulfillmentAutoMapStatus,
  FulfillmentCatalogItemStatus,
  FulfillmentProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Một danh mục sắp ghi xuống — đã chuẩn hoá khỏi payload của nhà cung cấp. */
export interface CatalogueUpsertInput {
  externalCatalogueId: string;
  name: string;
  rawData?: Prisma.InputJsonValue;
}

/** Một sản phẩm sắp ghi xuống. */
export interface ProductUpsertInput {
  externalProductId: string;
  externalCatalogueId: string | null;
  name: string;
  sku: string | null;
  image: string | null;
  basePrice: string | null;
  currency: string | null;
  variationsCount: number | null;
  status: FulfillmentCatalogItemStatus;
  rawData: Prisma.InputJsonValue;
}

/** Một biến thể sắp ghi xuống. */
export interface VariantUpsertInput {
  externalProductId: string;
  externalVariantId: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  status: FulfillmentCatalogItemStatus;
  rawData: Prisma.InputJsonValue;
}

/** Bối cảnh chung của mọi lần ghi — tenant + tài khoản nhà cung cấp. */
export interface CatalogScope {
  organizationId: string;
  accountId: string;
  provider: FulfillmentProvider;
}

/**
 * FulfillmentCatalogRepository — data access cho BẢN SAO danh mục nhà cung cấp.
 *
 * Tenant isolation (ADR-004): mọi method nhận `organizationId` qua `CatalogScope`.
 *
 * 🔴 **Ghi theo LÔ, không ghi từng dòng.** Một danh mục vài nghìn sản phẩm × mỗi sản phẩm
 * chục biến thể là hàng chục nghìn dòng; `upsert` từng dòng qua Prisma là hàng chục nghìn
 * lượt round-trip và một lần đồng bộ sẽ mất hàng chục phút. Ở đây dùng `INSERT ... ON
 * CONFLICT DO UPDATE` theo lô: một câu lệnh cho mỗi lô, và chính ràng buộc UNIQUE quyết định
 * "đã có thì UPDATE, chưa có thì INSERT" — không có khoảng trống chạy đua giữa hai request
 * như cách đọc-rồi-ghi.
 */
@Injectable()
export class FulfillmentCatalogRepository {
  /**
   * Số dòng mỗi câu lệnh ghi.
   *
   * PostgreSQL giới hạn 65535 tham số cho một câu lệnh có tham số. Sản phẩm là bảng nhiều
   * cột nhất (~14 cột × 500 dòng = 7000 tham số) nên 500 vẫn còn rất xa trần, đồng thời đủ
   * lớn để số lượt round-trip không đáng kể.
   */
  private static readonly BATCH_SIZE = 500;

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Ghi (đồng bộ)
  // ---------------------------------------------------------------------------

  /**
   * Ghi danh mục theo lô. Trả về `Map<externalCatalogueId, id>` để bước ghi sản phẩm nối
   * khoá ngoại mà không phải truy vấn lại từng dòng.
   */
  async upsertCatalogues(
    scope: CatalogScope,
    items: CatalogueUpsertInput[],
    syncedAt: Date,
  ): Promise<Map<string, string>> {
    for (const batch of this.chunk(items)) {
      const values = batch.map(
        (item) => Prisma.sql`(
          gen_random_uuid(),
          ${scope.organizationId}::uuid,
          ${scope.accountId}::uuid,
          ${scope.provider}::"fulfillment_provider",
          ${item.externalCatalogueId},
          ${item.name},
          'ACTIVE'::"fulfillment_catalog_item_status",
          ${item.rawData === undefined ? null : JSON.stringify(item.rawData)}::jsonb,
          ${syncedAt},
          CURRENT_TIMESTAMP,
          ${syncedAt},
          NULL
        )`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO "fulfillment_catalogues"
          ("id", "organization_id", "account_id", "provider", "external_catalogue_id",
           "name", "status", "raw_data", "synced_at", "created_at", "updated_at", "deleted_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("account_id", "external_catalogue_id") DO UPDATE SET
          "name"       = EXCLUDED."name",
          "status"     = 'ACTIVE'::"fulfillment_catalog_item_status",
          "raw_data"   = COALESCE(EXCLUDED."raw_data", "fulfillment_catalogues"."raw_data"),
          "synced_at"  = EXCLUDED."synced_at",
          "updated_at" = EXCLUDED."updated_at",
          -- Danh mục quay lại sau khi từng biến mất ⇒ sống lại, không tạo bản ghi thứ hai.
          "deleted_at" = NULL`;
    }

    return this.idMapForCatalogues(scope.accountId);
  }

  /** Ghi sản phẩm theo lô. Trả `Map<externalProductId, id>` cho bước ghi biến thể. */
  async upsertProducts(
    scope: CatalogScope,
    items: ProductUpsertInput[],
    catalogueIdByExternal: Map<string, string>,
    syncedAt: Date,
  ): Promise<Map<string, string>> {
    for (const batch of this.chunk(items)) {
      const values = batch.map((item) => {
        const catalogueId = item.externalCatalogueId
          ? (catalogueIdByExternal.get(item.externalCatalogueId) ?? null)
          : null;
        return Prisma.sql`(
          gen_random_uuid(),
          ${scope.organizationId}::uuid,
          ${scope.accountId}::uuid,
          ${scope.provider}::"fulfillment_provider",
          ${catalogueId}::uuid,
          ${item.externalProductId},
          ${item.name},
          ${item.sku},
          ${item.image},
          ${item.basePrice},
          ${item.currency},
          ${item.variationsCount},
          ${item.status}::"fulfillment_catalog_item_status",
          ${JSON.stringify(item.rawData)}::jsonb,
          ${syncedAt},
          CURRENT_TIMESTAMP,
          ${syncedAt},
          NULL
        )`;
      });

      await this.prisma.$executeRaw`
        INSERT INTO "fulfillment_products"
          ("id", "organization_id", "account_id", "provider", "catalogue_id",
           "external_product_id", "name", "sku", "image", "base_price", "currency",
           "variations_count", "status", "raw_data", "synced_at",
           "created_at", "updated_at", "deleted_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("account_id", "external_product_id") DO UPDATE SET
          "catalogue_id"     = EXCLUDED."catalogue_id",
          "name"             = EXCLUDED."name",
          "sku"              = EXCLUDED."sku",
          "image"            = EXCLUDED."image",
          "base_price"       = EXCLUDED."base_price",
          "currency"         = EXCLUDED."currency",
          "variations_count" = EXCLUDED."variations_count",
          "status"           = EXCLUDED."status",
          "raw_data"         = EXCLUDED."raw_data",
          "synced_at"        = EXCLUDED."synced_at",
          "updated_at"       = EXCLUDED."updated_at",
          "deleted_at"       = NULL`;
    }

    return this.idMapForProducts(scope.accountId);
  }

  /** Ghi biến thể theo lô. */
  async upsertVariants(
    scope: CatalogScope,
    items: VariantUpsertInput[],
    productIdByExternal: Map<string, string>,
    syncedAt: Date,
  ): Promise<number> {
    let written = 0;

    for (const batch of this.chunk(items)) {
      const values = batch
        .map((item) => {
          const productId = productIdByExternal.get(item.externalProductId);
          // Không có sản phẩm cha ⇒ bỏ qua, KHÔNG bịa khoá ngoại. Trường hợp này chỉ xảy ra
          // khi nhà cung cấp trả biến thể của một sản phẩm không có trong danh sách.
          if (!productId) return null;
          return Prisma.sql`(
            gen_random_uuid(),
            ${scope.organizationId}::uuid,
            ${scope.accountId}::uuid,
            ${scope.provider}::"fulfillment_provider",
            ${productId}::uuid,
            ${item.externalVariantId},
            ${item.sku},
            ${item.name},
            ${item.color},
            ${item.size},
            ${item.price},
            ${item.status}::"fulfillment_catalog_item_status",
            ${JSON.stringify(item.rawData)}::jsonb,
            ${syncedAt},
            CURRENT_TIMESTAMP,
            ${syncedAt},
            NULL
          )`;
        })
        .filter((value): value is Prisma.Sql => value !== null);

      if (values.length === 0) continue;

      await this.prisma.$executeRaw`
        INSERT INTO "fulfillment_variants"
          ("id", "organization_id", "account_id", "provider", "product_id",
           "external_variant_id", "sku", "name", "color", "size", "price",
           "status", "raw_data", "synced_at", "created_at", "updated_at", "deleted_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("product_id", "external_variant_id") DO UPDATE SET
          "sku"        = EXCLUDED."sku",
          "name"       = EXCLUDED."name",
          "color"      = EXCLUDED."color",
          "size"       = EXCLUDED."size",
          "price"      = EXCLUDED."price",
          "status"     = EXCLUDED."status",
          "raw_data"   = EXCLUDED."raw_data",
          "synced_at"  = EXCLUDED."synced_at",
          "updated_at" = EXCLUDED."updated_at",
          "deleted_at" = NULL`;
      written += values.length;
    }

    return written;
  }

  /**
   * Đánh dấu ARCHIVED những bản ghi nhà cung cấp KHÔNG còn trả về ở lượt đồng bộ này.
   *
   * 🔴 KHÔNG xoá cứng: một ánh xạ sản phẩm đang dùng có thể trỏ tới bản ghi đó, và xoá là
   * màn hình mất luôn tên/SKU để đối chiếu. ARCHIVED vẫn tra được nhưng không hiện ra ở các
   * ô chọn — người vận hành thấy đúng thực tế "nhà cung cấp đã ngừng bán".
   *
   * Nhận diện bằng `synced_at < syncedAt` của lượt hiện tại: mọi bản ghi còn tồn tại đều vừa
   * được cập nhật `synced_at` ở bước trên.
   */
  async archiveStale(
    scope: CatalogScope,
    syncedAt: Date,
  ): Promise<{ catalogues: number; products: number; variants: number }> {
    const archived = FulfillmentCatalogItemStatus.ARCHIVED;

    const [variants, products, catalogues] = await this.prisma.$transaction([
      this.prisma.fulfillmentVariant.updateMany({
        where: {
          accountId: scope.accountId,
          syncedAt: { lt: syncedAt },
          status: { not: archived },
        },
        data: { status: archived },
      }),
      this.prisma.fulfillmentProduct.updateMany({
        where: {
          accountId: scope.accountId,
          syncedAt: { lt: syncedAt },
          status: { not: archived },
        },
        data: { status: archived },
      }),
      this.prisma.fulfillmentCatalogue.updateMany({
        where: {
          accountId: scope.accountId,
          syncedAt: { lt: syncedAt },
          status: { not: archived },
        },
        data: { status: archived },
      }),
    ]);

    return {
      catalogues: catalogues.count,
      products: products.count,
      variants: variants.count,
    };
  }

  // ---------------------------------------------------------------------------
  // Đọc (giao diện + ánh xạ tự động)
  // ---------------------------------------------------------------------------

  /** Danh mục của một tài khoản. `includeArchived` chỉ dùng cho màn hình đối soát. */
  listCatalogues(accountId: string, organizationId: string, includeArchived = false) {
    return this.prisma.fulfillmentCatalogue.findMany({
      where: {
        accountId,
        organizationId,
        deletedAt: null,
        ...(includeArchived ? {} : { status: FulfillmentCatalogItemStatus.ACTIVE }),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Sản phẩm có lọc + phân trang.
   *
   * 🔴 Đếm biến thể bằng `_count` của Prisma (một truy vấn kèm theo), KHÔNG lặp qua từng sản
   * phẩm để đếm — đó chính là N+1 mà §8 cấm.
   */
  async listProductsPaged(params: {
    organizationId: string;
    accountId: string;
    catalogueId?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const keyword = params.search?.trim();
    const where: Prisma.FulfillmentProductWhereInput = {
      organizationId: params.organizationId,
      accountId: params.accountId,
      deletedAt: null,
      status: FulfillmentCatalogItemStatus.ACTIVE,
      ...(params.catalogueId ? { catalogueId: params.catalogueId } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { sku: { contains: keyword, mode: 'insensitive' } },
              { externalProductId: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.fulfillmentProduct.findMany({
        where,
        include: {
          catalogue: { select: { id: true, name: true } },
          _count: {
            select: {
              variants: {
                where: { deletedAt: null, status: FulfillmentCatalogItemStatus.ACTIVE },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.fulfillmentProduct.count({ where }),
    ]);

    return { items, total };
  }

  /** Biến thể của một sản phẩm (đọc theo id nội bộ, đã kiểm tenant ở tầng service). */
  listVariants(organizationId: string, productId: string) {
    return this.prisma.fulfillmentVariant.findMany({
      where: {
        organizationId,
        productId,
        deletedAt: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
      },
      orderBy: [{ name: 'asc' }, { sku: 'asc' }],
    });
  }

  findProductById(organizationId: string, id: string) {
    return this.prisma.fulfillmentProduct.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { catalogue: { select: { id: true, name: true } } },
    });
  }

  /** Thời điểm đồng bộ gần nhất của một tài khoản — giao diện cần để nói "dữ liệu lúc nào". */
  async lastSyncedAt(accountId: string): Promise<Date | null> {
    const row = await this.prisma.fulfillmentProduct.findFirst({
      where: { accountId, deletedAt: null },
      select: { syncedAt: true },
      orderBy: { syncedAt: 'desc' },
    });
    return row?.syncedAt ?? null;
  }

  /** Số bản ghi đang hoạt động — dùng cho màn hình cấu hình và kiểm chứng đồng bộ. */
  async countActive(accountId: string): Promise<{
    catalogues: number;
    products: number;
    variants: number;
  }> {
    const active = FulfillmentCatalogItemStatus.ACTIVE;
    const [catalogues, products, variants] = await this.prisma.$transaction([
      this.prisma.fulfillmentCatalogue.count({
        where: { accountId, deletedAt: null, status: active },
      }),
      this.prisma.fulfillmentProduct.count({
        where: { accountId, deletedAt: null, status: active },
      }),
      this.prisma.fulfillmentVariant.count({
        where: { accountId, deletedAt: null, status: active },
      }),
    ]);
    return { catalogues, products, variants };
  }

  // ---------------------------------------------------------------------------
  // Ánh xạ tự động — tra ứng viên
  // ---------------------------------------------------------------------------

  /**
   * Biến thể khớp CHÍNH XÁC một danh sách SKU, cho NHIỀU SKU trong MỘT truy vấn.
   *
   * 🔴 Tra theo lô là điểm mấu chốt về hiệu năng: rà 155 dòng hàng bằng 155 truy vấn là
   * đúng cái N+1 mà §8 cấm. Chỉ mục `(account_id, sku)` phục vụ đúng truy vấn này.
   */
  findVariantsBySkus(organizationId: string, accountId: string, skus: string[]) {
    if (skus.length === 0) return Promise.resolve([]);
    return this.prisma.fulfillmentVariant.findMany({
      where: {
        organizationId,
        accountId,
        deletedAt: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
        sku: { in: skus },
      },
      include: {
        product: {
          select: {
            id: true,
            externalProductId: true,
            name: true,
            catalogueId: true,
            catalogue: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Mọi biến thể đang hoạt động của một tài khoản, chỉ những cột cần để ghép.
   *
   * Dùng cho các tầng ghép theo TÊN (Product Title / Variant), vốn không tra được bằng chỉ
   * mục vì phải chuẩn hoá chuỗi trước khi so. Nạp MỘT lần cho cả lượt rà rồi ghép trong bộ
   * nhớ — không phải mỗi dòng hàng một truy vấn.
   */
  loadMatchIndexRows(organizationId: string, accountId: string) {
    return this.prisma.fulfillmentVariant.findMany({
      where: {
        organizationId,
        accountId,
        deletedAt: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
      },
      select: {
        id: true,
        externalVariantId: true,
        sku: true,
        name: true,
        color: true,
        size: true,
        price: true,
        product: {
          select: {
            id: true,
            externalProductId: true,
            name: true,
            sku: true,
            catalogueId: true,
            catalogue: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Kết quả ánh xạ tự động
  // ---------------------------------------------------------------------------

  /** Ghi/ghi đè KẾT QUẢ GẦN NHẤT cho một cặp khoá. Theo lô, một câu lệnh mỗi lô. */
  async upsertCandidates(
    organizationId: string,
    accountId: string,
    rows: Array<{
      tiktokProductId: string;
      sellerSku: string;
      status: FulfillmentAutoMapStatus;
      tier: string | null;
      candidateCount: number;
      candidates: Prisma.InputJsonValue | null;
      mappingId: string | null;
    }>,
    resolvedAt: Date,
  ): Promise<void> {
    for (const batch of this.chunk(rows)) {
      const values = batch.map(
        (row) => Prisma.sql`(
          gen_random_uuid(),
          ${organizationId}::uuid,
          ${accountId}::uuid,
          ${row.tiktokProductId},
          ${row.sellerSku},
          ${row.status}::"fulfillment_auto_map_status",
          ${row.tier}::"fulfillment_auto_map_tier",
          ${row.candidateCount},
          ${row.candidates === null ? null : JSON.stringify(row.candidates)}::jsonb,
          ${row.mappingId}::uuid,
          ${resolvedAt},
          CURRENT_TIMESTAMP,
          ${resolvedAt}
        )`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO "fulfillment_mapping_candidates"
          ("id", "organization_id", "account_id", "tiktok_product_id", "seller_sku",
           "status", "tier", "candidate_count", "candidates", "mapping_id",
           "resolved_at", "created_at", "updated_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("organization_id", "tiktok_product_id", "seller_sku") DO UPDATE SET
          "account_id"      = EXCLUDED."account_id",
          "status"          = EXCLUDED."status",
          "tier"            = EXCLUDED."tier",
          "candidate_count" = EXCLUDED."candidate_count",
          "candidates"      = EXCLUDED."candidates",
          "mapping_id"      = EXCLUDED."mapping_id",
          "resolved_at"     = EXCLUDED."resolved_at",
          "updated_at"      = EXCLUDED."updated_at"`;
    }
  }

  /** Kết quả rà gần nhất của một tổ chức — nạp MỘT lần cho cả trang đơn hàng. */
  listCandidates(organizationId: string) {
    return this.prisma.fulfillmentMappingCandidate.findMany({
      where: { organizationId },
    });
  }

  /** Xoá kết quả rà của những cặp khoá đã có ánh xạ thật — trạng thái cũ không còn ý nghĩa. */
  async deleteCandidates(
    organizationId: string,
    keys: Array<{ tiktokProductId: string; sellerSku: string }>,
  ): Promise<void> {
    if (keys.length === 0) return;
    await this.prisma.fulfillmentMappingCandidate.deleteMany({
      where: { organizationId, OR: keys },
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async idMapForCatalogues(accountId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.fulfillmentCatalogue.findMany({
      where: { accountId },
      select: { id: true, externalCatalogueId: true },
    });
    return new Map(rows.map((row) => [row.externalCatalogueId, row.id]));
  }

  private async idMapForProducts(accountId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.fulfillmentProduct.findMany({
      where: { accountId },
      select: { id: true, externalProductId: true },
    });
    return new Map(rows.map((row) => [row.externalProductId, row.id]));
  }

  private *chunk<T>(items: T[]): Generator<T[]> {
    for (let i = 0; i < items.length; i += FulfillmentCatalogRepository.BATCH_SIZE) {
      yield items.slice(i, i + FulfillmentCatalogRepository.BATCH_SIZE);
    }
  }
}
