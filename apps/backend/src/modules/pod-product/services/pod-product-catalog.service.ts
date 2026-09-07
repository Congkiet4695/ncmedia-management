import { Injectable, Logger } from '@nestjs/common';
import { PodMasterDataProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokCategoryNode } from '../../tiktok-sdk/types/tiktok-product.types';
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
   * 🔴 Bảng này chỉ chứa thương hiệu **TikTok thật sự trả về**. Trước đây có thêm bước
   * `ensureNoBrand()` tự tạo một bản ghi "No brand" quanh một `brand_id` viết cứng khi
   * `Get Brands` không liệt kê nó — và chính bản ghi bịa đó đã khiến sản phẩm lên sàn mang
   * thương hiệu người dùng không chọn. "No brand" nay là một TRẠNG THÁI của template
   * (`PodBrandMode.NONE`), không phải một dòng trong bảng thương hiệu.
   */
  async syncGlobalBrands(ctx: TiktokShopContext): Promise<number> {
    const brands = await this.productApi.getAllBrands(ctx);
    let count = 0;

    for (const brand of brands) {
      if (!brand.id) continue;
      const noBrand = isNoBrandName(brand.name);
      await this.prisma.podProductBrand.upsert({
        where: {
          provider_tiktokBrandId: {
            provider: PodMasterDataProvider.TIKTOK,
            tiktokBrandId: brand.id,
          },
        },
        create: {
          provider: PodMasterDataProvider.TIKTOK,
          tiktokBrandId: brand.id,
          name: brand.name ?? null,
          authorizedStatus: brand.authorizedStatus ?? null,
          brandStatus: brand.brandStatus ?? null,
          isNoBrand: noBrand,
        },
        update: {
          name: brand.name ?? null,
          authorizedStatus: brand.authorizedStatus ?? null,
          brandStatus: brand.brandStatus ?? null,
          isNoBrand: noBrand,
          // TikTok đã trả về thật ⇒ đây không còn là bản ghi hệ thống tự tạo.
          ...(noBrand ? { isSystem: false } : {}),
          syncedAt: new Date(),
          deletedAt: null,
        },
      });
      count += 1;
    }

    return count;
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
      orderBy: { syncedAt: 'asc' },
    });

    let count = 0;
    for (const category of categories) {
      const { data: attributes } = await this.productApi.getCategoryAttributes(
        ctx,
        category.tiktokCategoryId,
      );

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

      // Đánh dấu danh mục vừa lấy xong thuộc tính để lượt sau nhường chỗ cho danh mục khác
      // (`orderBy: syncedAt asc`). Không có bước này thì mọi lượt đều lấy đúng 200 danh mục
      // đầu tiên và phần còn lại của cây không bao giờ tới lượt.
      await this.prisma.podProductCategory.update({
        where: { id: category.id },
        data: { syncedAt: new Date() },
      });
    }

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
