import { Injectable, Logger } from '@nestjs/common';
import { PodMasterDataProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import {
  TiktokBrandCrawlerService,
  type TiktokBrandCrawlProgress,
} from '../../tiktok-sdk/tiktok-brand-crawler.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokBrand, TiktokCategoryNode } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import { isNoBrandName } from '../constants/pod-product.constants';
import { PodProductMapper } from '../mappers/pod-product.mapper';
import type { ProductSyncTarget } from '../repositories/pod-product-sync.repository';

/**
 * Số danh mục lá lấy thuộc tính trong MỘT lượt (mỗi danh mục là một lời gọi TikTok).
 *
 * 🔴 Có trần vì cây danh mục TikTok có hàng nghìn nút lá: quét hết trong một lượt là hàng
 * nghìn call và chắc chắn chạm rate limit của app. Mỗi lượt lấy các danh mục **lâu chưa
 * đồng bộ nhất** trước, nên chạy Sync định kỳ sẽ dần phủ hết cây thay vì kẹt mãi ở đầu
 * danh sách.
 */
export const CATEGORY_ATTRIBUTE_BATCH = 200;

/**
 * Số thương hiệu ghi trong MỘT câu `INSERT … ON CONFLICT`. 500 dòng × 10 tham số nằm xa trần
 * 65.535 tham số của PostgreSQL; nhỏ hơn nữa chỉ thêm round-trip.
 */
export const BRAND_UPSERT_BATCH = 500;

/** Tiến độ đồng bộ thương hiệu — phát định kỳ để giao diện biết lượt chạy còn sống. */
export interface BrandSyncProgress extends TiktokBrandCrawlProgress {
  /** Bản ghi MỚI đã chèn vào database tính tới lúc này. */
  inserted: number;
}

/**
 * Kết quả đồng bộ thương hiệu — đủ số liệu để đối chiếu "TikTok có bao nhiêu / lấy được bao
 * nhiêu / database có bao nhiêu" (xem BRAND_SYNC_FIX_REPORT.md).
 */
export interface BrandSyncSummary {
  /** Bản ghi DUY NHẤT được ghi trong lượt này (chèn mới + cập nhật). */
  records: number;
  inserted: number;
  updated: number;
  /** Tổng số thương hiệu đang có trong database sau lượt. */
  databaseTotal: number;
  apiCalls: number;
  fetched: number;
  prefixes: number;
  cappedPrefixes: number;
  refinedPrefixes: number;
  incomplete: Array<{ prefix: string; total: number; unique: number }>;
  failed: Array<{ prefix: string; error: string }>;
  durationMs: number;
  /** Tổng hợp prefix hỏng / thiếu — `null` khi lượt sạch. Master data dùng để đánh dấu PARTIAL. */
  warning: string | null;
}

/**
 * PodProductCatalogService — nạp **dữ liệu master TOÀN CỤC** của TikTok: cây Category,
 * Brand và định nghĩa thuộc tính theo danh mục.
 *
 * 🔴 **Ba bảng này KHÔNG còn thuộc về tổ chức hay shop nào.** Trước đây mỗi shop có một bản
 * sao riêng (`shop_id` + `organization_id`), nghĩa là mỗi Organization phải tự bấm Sync
 * trước khi dùng được Template, và cùng một cây danh mục 12.000 dòng bị nhân lên theo số
 * shop. Nay chỉ Super Admin đồng bộ và mọi tổ chức cùng đọc — xem `PodMasterDataSyncService`.
 *
 * 🔴 Vì sao vẫn cần `TiktokShopContext`: API `GetCategories` / `GetBrands` /
 * `GetCategoryAttributes` của TikTok BẮT BUỘC có `shop_cipher` + access token của một shop
 * đã uỷ quyền. Không có endpoint "master data" vô danh. Nên đồng bộ toàn cục vẫn phải MƯỢN
 * token của một shop làm nguồn — dữ liệu ghi ra là dùng chung, chỉ đường vào là qua một shop.
 */
@Injectable()
export class PodProductCatalogService {
  private readonly logger = new Logger(PodProductCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: PodProductMapper,
    private readonly productApi: TiktokProductApiService,
    private readonly brandCrawler: TiktokBrandCrawlerService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  /** Dựng ngữ cảnh gọi TikTok từ một shop nguồn (access token + shop cipher). */
  async buildContext(target: ProductSyncTarget): Promise<TiktokShopContext> {
    const token = await this.tokenService.ensureValidAccessToken(target.account);
    if (!token.ok) {
      throw new Error(`Không lấy được access token (${token.reason}): ${token.message}`);
    }
    return {
      accessToken: token.accessToken,
      shopCipher: this.encryption.decrypt(target.shopCipherEnc),
      shopId: target.id,
      organizationId: target.organizationId,
    };
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ TỪNG tài nguyên master (mỗi nút Sync một tài nguyên)
  //
  // 🔴 Tách lẻ vì ba thứ này đổi với nhịp khác nhau và tốn quota rất khác nhau: cây danh
  // mục là một call, thuộc tính là hàng trăm. Gộp cứng nghĩa là muốn làm mới danh mục thì
  // phải trả giá bằng quota của cả ba.
  // ---------------------------------------------------------------------------

  /**
   * Đồng bộ cây danh mục TOÀN CỤC.
   *
   * API trả về danh sách phẳng; `level` và `path` được dựng TẠI ĐÂY (một lần khi ghi) để
   * mọi truy vấn sau này khỏi phải đệ quy — danh mục TikTok sâu 4–6 tầng.
   *
   * Idempotent: `upsert` theo (provider, tiktokCategoryId). Chạy hai lần không sinh bản ghi
   * trùng, chỉ cập nhật tại chỗ.
   */
  async syncGlobalCategories(ctx: TiktokShopContext): Promise<number> {
    const { data: nodes } = await this.productApi.getCategories(ctx);
    const rows = nodes
      .map((node) => this.mapper.toCategoryRow(node))
      .filter((row): row is NonNullable<ReturnType<PodProductMapper['toCategoryRow']>> =>
        Boolean(row),
      );
    if (rows.length === 0) return 0;

    const paths = this.buildPaths(nodes);

    for (const row of rows) {
      const computed = paths.get(row.tiktokCategoryId);
      // `permissionStatuses` không còn được lưu: nó là câu trả lời THEO SELLER
      // ("shop này có được bán ở danh mục này không") và không có chỗ trong bảng dùng chung.
      // Mapper vẫn trả về trường đó, nên loại nó ra ở đây thay vì sửa mapper — mapper là ACL
      // của TikTok, nhiệm vụ của nó là phản ánh API đúng như API trả về.
      const { permissionStatuses, ...category } = row;
      void permissionStatuses;

      await this.prisma.podProductCategory.upsert({
        where: {
          provider_tiktokCategoryId: {
            provider: PodMasterDataProvider.TIKTOK,
            tiktokCategoryId: row.tiktokCategoryId,
          },
        },
        create: {
          provider: PodMasterDataProvider.TIKTOK,
          ...category,
          level: computed?.level ?? 0,
          path: computed?.path ?? row.localName,
        },
        update: {
          ...category,
          level: computed?.level ?? 0,
          path: computed?.path ?? row.localName,
          syncedAt: new Date(),
          deletedAt: null,
        },
      });
    }

    return rows.length;
  }

  /**
   * Đồng bộ thương hiệu TOÀN CỤC. Idempotent theo (provider, tiktokBrandId).
   *
   * 🔴 Vì sao KHÔNG phải "gọi Get Brands rồi đi hết page_token": TikTok kẹp MỖI truy vấn ở
   * 10.000 bản ghi (trang 101 bị từ chối, `total_count` cũng bị kẹp) và thứ tự trang đổi giữa
   * các lần gọi. Cách cũ vì thế chỉ lấy được 10.000 thương hiệu đầu bảng — đúng hiện tượng
   * "chỉ đồng bộ tới chữ F". `TiktokBrandCrawlerService` chia không gian theo prefix
   * `brand_name` và đi lại cho tới khi khớp `total_count` từng prefix.
   *
   * Ghi database **theo từng prefix** (batch `INSERT … ON CONFLICT`), không gói cả lượt trong
   * một transaction: lượt quét kéo dài hàng giờ, prefix cuối hỏng thì hàng trăm nghìn bản ghi
   * trước đó vẫn nằm yên trong bảng.
   *
   * 🔴 Bảng này chỉ chứa thương hiệu **TikTok thật sự trả về**. Trước đây có thêm bước
   * `ensureNoBrand()` tự tạo một bản ghi "No brand" quanh một `brand_id` viết cứng khi
   * `Get Brands` không liệt kê nó — và chính bản ghi bịa đó đã khiến sản phẩm lên sàn mang
   * thương hiệu người dùng không chọn. "No brand" nay là một TRẠNG THÁI của template
   * (`PodBrandMode.NONE`), không phải một dòng trong bảng thương hiệu.
   */
  async syncGlobalBrands(
    ctx: TiktokShopContext,
    options: { onProgress?: (progress: BrandSyncProgress) => void | Promise<void> } = {},
  ): Promise<BrandSyncSummary> {
    const startedAt = new Date();
    let inserted = 0;

    this.logger.log({
      module: 'pod-product',
      operation: 'catalog.brands.sync.start',
      sourceShopId: ctx.shopId,
      msg: 'Bắt đầu đồng bộ thương hiệu TikTok toàn cục',
    });

    const { onProgress } = options;
    const report = await this.brandCrawler.crawl(ctx, {
      onBatch: async (brands) => {
        inserted += await this.upsertBrands(brands);
      },
      onProgress: onProgress ? (progress) => onProgress({ ...progress, inserted }) : undefined,
    });

    const [records, databaseTotal] = await Promise.all([
      this.prisma.podProductBrand.count({
        where: { provider: PodMasterDataProvider.TIKTOK, syncedAt: { gte: startedAt } },
      }),
      this.prisma.podProductBrand.count({
        where: { provider: PodMasterDataProvider.TIKTOK, deletedAt: null },
      }),
    ]);

    const summary: BrandSyncSummary = {
      records,
      inserted,
      updated: Math.max(records - inserted, 0),
      databaseTotal,
      apiCalls: report.apiCalls,
      fetched: report.fetched,
      prefixes: report.prefixesDone,
      cappedPrefixes: report.cappedPrefixes,
      refinedPrefixes: report.refinedPrefixes,
      incomplete: report.incomplete,
      failed: report.failed,
      durationMs: report.durationMs,
      warning: this.brandSyncWarning(report.incomplete, report.failed),
    };

    this.logger.log({
      module: 'pod-product',
      operation: 'catalog.brands.sync.done',
      sourceShopId: ctx.shopId,
      ...summary,
      incomplete: summary.incomplete.length,
      failed: summary.failed.length,
      msg: summary.warning ?? 'Đã đồng bộ thương hiệu TikTok toàn cục',
    });

    return summary;
  }

  /**
   * Ghi một lô thương hiệu bằng MỘT câu `INSERT … ON CONFLICT` cho mỗi 500 dòng. Trả về số
   * bản ghi MỚI (`xmax = 0` ⇒ dòng vừa chèn, ngược lại là cập nhật).
   *
   * Khoá tự nhiên (provider, tiktok_brand_id) — không dùng tên: tên đổi theo lần đồng bộ và
   * TikTok có nhiều thương hiệu trùng tên với id khác nhau.
   */
  private async upsertBrands(brands: TiktokBrand[]): Promise<number> {
    // Khử trùng trong lô: cùng một id xuất hiện hai lần trong một VALUES là PostgreSQL từ chối
    // cả câu ("cannot affect row a second time").
    const byId = new Map<string, TiktokBrand>();
    for (const brand of brands) {
      if (brand.id) byId.set(brand.id, brand);
    }
    const rows = [...byId.values()];
    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += BRAND_UPSERT_BATCH) {
      const batch = rows.slice(offset, offset + BRAND_UPSERT_BATCH);
      const syncedAt = new Date();
      const values = batch.map(
        (brand) => Prisma.sql`(
          gen_random_uuid(),
          ${PodMasterDataProvider.TIKTOK}::"pod_master_data_provider",
          ${brand.id},
          ${brand.name?.slice(0, 255) ?? null},
          ${brand.authorizedStatus?.slice(0, 40) ?? null},
          ${brand.brandStatus?.slice(0, 40) ?? null},
          ${isNoBrandName(brand.name)},
          false,
          ${syncedAt},
          ${syncedAt},
          ${syncedAt},
          NULL
        )`,
      );

      const result = await this.prisma.$queryRaw<Array<{ inserted: boolean }>>`
        INSERT INTO "pod_product_brands"
          ("id", "provider", "tiktok_brand_id", "name", "authorized_status", "brand_status",
           "is_no_brand", "is_system", "synced_at", "created_at", "updated_at", "deleted_at")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("provider", "tiktok_brand_id") DO UPDATE SET
          "name"              = EXCLUDED."name",
          "authorized_status" = EXCLUDED."authorized_status",
          "brand_status"      = EXCLUDED."brand_status",
          "is_no_brand"       = EXCLUDED."is_no_brand",
          -- TikTok đã trả về thật ⇒ bản ghi "No brand" không còn là do hệ thống tự tạo.
          "is_system"         = CASE WHEN EXCLUDED."is_no_brand" THEN false
                                     ELSE "pod_product_brands"."is_system" END,
          "synced_at"         = EXCLUDED."synced_at",
          "updated_at"        = EXCLUDED."updated_at",
          -- Thương hiệu quay lại sau khi từng bị ẩn ⇒ sống lại, không tạo bản ghi thứ hai.
          "deleted_at"        = NULL
        RETURNING (xmax = 0) AS "inserted"`;

      inserted += result.filter((row) => row.inserted).length;
    }

    return inserted;
  }

  /** Gộp prefix hỏng/thiếu thành một câu cảnh báo ngắn — đủ để người vận hành biết chạy lại. */
  private brandSyncWarning(
    incomplete: BrandSyncSummary['incomplete'],
    failed: BrandSyncSummary['failed'],
  ): string | null {
    const parts: string[] = [];

    if (failed.length > 0) {
      const sample = failed
        .slice(0, 3)
        .map((item) => `"${item.prefix}": ${item.error}`)
        .join('; ');
      parts.push(`${failed.length} prefix hỏng (${sample})`);
    }
    if (incomplete.length > 0) {
      const missing = incomplete.reduce((sum, item) => sum + (item.total - item.unique), 0);
      const sample = incomplete
        .slice(0, 3)
        .map((item) => `"${item.prefix}" ${item.unique}/${item.total}`)
        .join('; ');
      parts.push(`${incomplete.length} prefix thiếu ~${missing} bản ghi (${sample})`);
    }

    return parts.length > 0 ? `Đồng bộ thương hiệu chưa trọn vẹn: ${parts.join(' · ')}` : null;
  }

  /**
   * Đồng bộ định nghĩa thuộc tính cho các danh mục LÁ.
   *
   * `categoryIds` = danh mục nội bộ cần lấy thuộc tính (dùng khi người vận hành vừa chọn
   * đúng danh mục đó trong Category Template). Bỏ trống ⇒ lấy các danh mục lá **lâu chưa
   * đồng bộ nhất**, tối đa `CATEGORY_ATTRIBUTE_BATCH` danh mục mỗi lượt.
   *
   * 🔴 Đổi so với mô hình cũ: trước đây chỉ lấy thuộc tính của danh mục "đang có sản phẩm
   * của shop này" — hợp lý khi cache thuộc về một shop, nhưng vô nghĩa với dữ liệu dùng
   * chung: Organization vừa đăng ký chưa có sản phẩm nào thì cũng cần chọn được thuộc tính.
   */
  async syncGlobalCategoryAttributes(
    ctx: TiktokShopContext,
    options: { categoryIds?: string[] } = {},
  ): Promise<number> {
    const where = options.categoryIds?.length
      ? { id: { in: options.categoryIds }, deletedAt: null }
      : { isLeaf: true, deletedAt: null };

    const categories = await this.prisma.podProductCategory.findMany({
      where,
      select: { id: true, tiktokCategoryId: true },
      take: CATEGORY_ATTRIBUTE_BATCH,
      // 🔴 `attributesSyncedAt`, KHÔNG phải `syncedAt`. `syncedAt` bị lượt đồng bộ CÂY DANH
      // MỤC ghi đè cho cả 11.892 bản ghi trong vài giây, nên xếp theo nó là xoá sạch con trỏ
      // tiến độ ở mỗi lần đồng bộ danh mục — vòng quét dậm chân và 9.873 danh mục lá không
      // bao giờ được phủ hết. `nulls: 'first'` để danh mục CHƯA TỪNG có thuộc tính đi trước.
      orderBy: { attributesSyncedAt: { sort: 'asc', nulls: 'first' } },
    });

    let count = 0;
    for (const category of categories) {
      count += await this.pullCategoryAttributes(ctx, category);
    }

    return count;
  }

  /**
   * Lấy và ghi thuộc tính của ĐÚNG MỘT danh mục. Trả về số thuộc tính đã ghi.
   *
   * 🔴 Endpoint `GET /product/202309/categories/{id}/attributes` KHÔNG phân trang (SDK
   * không có tham số page_token/page_size) — TikTok trả trọn bộ trong một lần. Nên ở đây
   * không có vòng lặp cursor nào để bỏ sót.
   */
  async pullCategoryAttributes(
    ctx: TiktokShopContext,
    category: { id: string; tiktokCategoryId: string },
  ): Promise<number> {
    const { data: attributes } = await this.productApi.getCategoryAttributes(
      ctx,
      category.tiktokCategoryId,
    );

    let count = 0;
    for (const attribute of attributes) {
      const row = this.mapper.toCategoryAttributeRow(attribute);
      if (!row) continue;

      await this.prisma.podCategoryAttribute.upsert({
        where: {
          categoryId_tiktokAttributeId: {
            categoryId: category.id,
            tiktokAttributeId: row.tiktokAttributeId,
          },
        },
        create: {
          categoryId: category.id,
          ...row,
          values: row.values ?? Prisma.JsonNull,
        },
        update: { ...row, values: row.values ?? Prisma.JsonNull, syncedAt: new Date() },
      });
      count += 1;
    }

    // Đóng dấu con trỏ để lượt sau nhường chỗ cho danh mục khác. Ghi cả khi TikTok trả về
    // RỖNG: "đã hỏi, danh mục này không có thuộc tính" cũng là một câu trả lời, và không
    // ghi thì danh mục rỗng sẽ chiếm suất quét mãi mãi.
    await this.prisma.podProductCategory.update({
      where: { id: category.id },
      data: { attributesSyncedAt: new Date() },
    });

    return count;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Dựng `level` + `path` ("A > B > C") từ danh sách phẳng, an toàn với dữ liệu vòng. */
  private buildPaths(nodes: TiktokCategoryNode[]): Map<string, { level: number; path: string }> {
    const byId = new Map(nodes.filter((node) => node.id).map((node) => [node.id as string, node]));
    const result = new Map<string, { level: number; path: string }>();

    for (const node of byId.values()) {
      const names: string[] = [];
      let current: TiktokCategoryNode | undefined = node;
      const seen = new Set<string>();

      // Chặn vòng lặp vô hạn nếu TikTok trả dữ liệu cha-con vòng tròn.
      while (current?.id && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.localName) names.unshift(current.localName);
        const parentId: string | undefined = current.parentId;
        current = parentId && parentId !== '0' ? byId.get(parentId) : undefined;
      }

      result.set(node.id as string, {
        level: Math.max(names.length - 1, 0),
        path: names.join(' > ').slice(0, 1024),
      });
    }

    return result;
  }
}
