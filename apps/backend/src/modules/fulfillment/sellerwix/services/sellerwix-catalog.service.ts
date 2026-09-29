import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentCatalogItemStatus, Prisma } from '@prisma/client';
import type {
  CatalogueUpsertInput,
  ProductUpsertInput,
  VariantUpsertInput,
} from '../../repositories/fulfillment-catalog.repository';
import { SellerwixApiClient } from '../clients/sellerwix-api.client';
import { SELLERWIX_MAX_PAGES_PER_PRODUCT } from '../constants/sellerwix.constants';
import type { SellerwixCategoryProduct, SellerwixVariant } from '../types/sellerwix-api.types';
import {
  SellerwixCredentialService,
  type SellerwixAccountCredentialRef,
} from './sellerwix-credential.service';

/** Danh mục Sellerwix đã chuẩn hoá — đúng đầu vào của `FulfillmentCatalogRepository`. */
export interface SellerwixCatalogSnapshot {
  catalogues: CatalogueUpsertInput[];
  products: ProductUpsertInput[];
  variants: VariantUpsertInput[];
  apiCalls: number;
  /** Rỗng = đọc ĐỦ; có phần tử = có lượt đọc bị cụt ⇒ KHÔNG được archive. */
  warnings: string[];
}

/**
 * SellerwixCatalogService — đọc TOÀN BỘ danh mục Sellerwix để đồng bộ vào bản sao chung.
 *
 * ```
 *   GET /v1/category                     → fulfillment_catalogues   (id, title)
 *   GET /v1/category/{id}/product        → fulfillment_products     (sku sản phẩm, title, ảnh)
 *   GET /v1/product/{sku}?limit&next_page → fulfillment_variants     (sku biến thể, màu, size, giá vốn,
 *                                                                    print_areas trong raw_data)
 * ```
 *
 * 🔴 Không có bảng riêng cho Sellerwix: dùng lại `fulfillment_catalogues/products/variants` với
 * `provider = SELLERWIX`. Định danh nhà cung cấp:
 *   - `external_product_id` = `sku` sản phẩm (Sellerwix KHÔNG trả id số cho sản phẩm — tham số của
 *     Get product variants chính là sku) và `sku` = cùng giá trị đó: đây là mã NGHIỆP VỤ người vận
 *     hành đọc được (vd `SW-MD-MPT`), không phải UUID.
 *   - `external_variant_id` = `sku` biến thể = giá trị gửi trong `line_items[].sku`.
 *
 * Endpoint `GET /v1/catalog` (product master, cursor) KHÔNG dùng: response của nó không trỏ tới
 * danh sách biến thể; luồng category → product → variant là luồng tài liệu mô tả để lấy SKU biến thể.
 */
@Injectable()
export class SellerwixCatalogService {
  private readonly logger = new Logger(SellerwixCatalogService.name);

  constructor(
    private readonly client: SellerwixApiClient,
    private readonly credentials: SellerwixCredentialService,
  ) {}

  async fetchCatalog(account: SellerwixAccountCredentialRef): Promise<SellerwixCatalogSnapshot> {
    const ctx = this.credentials.buildContext(account);
    const warnings: string[] = [];
    let apiCalls = 0;

    // --- 1. Danh mục ---
    const categories = await this.client.listCategories(ctx);
    apiCalls += 1;
    const catalogues: CatalogueUpsertInput[] = (categories.data ?? [])
      .filter((category) => category.id !== undefined && category.id !== null)
      .map((category) => ({
        externalCatalogueId: String(category.id),
        name: category.title?.trim() || String(category.id),
        rawData: category as unknown as Prisma.InputJsonValue,
      }));

    // --- 2. Sản phẩm theo từng danh mục ---
    // Một sản phẩm có thể nằm ở nhiều danh mục ⇒ giữ MỘT bản ghi (danh mục đọc được đầu tiên),
    // danh sách đầy đủ các danh mục nằm trong `raw_data.categories`.
    const productBySku = new Map<
      string,
      { item: SellerwixCategoryProduct; catalogueId: string; categoryIds: string[] }
    >();
    for (const catalogue of catalogues) {
      try {
        const result = await this.client.listCategoryProducts(ctx, catalogue.externalCatalogueId);
        apiCalls += 1;
        for (const item of result.data ?? []) {
          const sku = item.sku?.trim();
          if (!sku) continue;
          const existing = productBySku.get(sku);
          if (existing) existing.categoryIds.push(catalogue.externalCatalogueId);
          else {
            productBySku.set(sku, {
              item,
              catalogueId: catalogue.externalCatalogueId,
              categoryIds: [catalogue.externalCatalogueId],
            });
          }
        }
      } catch (error) {
        apiCalls += 1;
        warnings.push(
          `Không đọc được sản phẩm của danh mục "${catalogue.name}": ${(error as Error).message}`,
        );
      }
    }

    const products: ProductUpsertInput[] = [...productBySku.entries()].map(([sku, entry]) => ({
      externalProductId: sku,
      externalCatalogueId: entry.catalogueId,
      name: entry.item.title?.trim() || sku,
      sku,
      image: entry.item.img_src?.trim() || null,
      basePrice: null,
      currency: null,
      variationsCount: null,
      status:
        entry.item.active === false
          ? FulfillmentCatalogItemStatus.INACTIVE
          : FulfillmentCatalogItemStatus.ACTIVE,
      rawData: { ...entry.item, categories: entry.categoryIds },
    }));

    // --- 3. Biến thể của từng sản phẩm (tuần tự — trần 100 req/60s do client giữ) ---
    const variants: VariantUpsertInput[] = [];
    for (const product of products) {
      const fetched = await this.fetchVariants(ctx, product.externalProductId);
      apiCalls += fetched.apiCalls;
      if (fetched.warning) warnings.push(fetched.warning);
      for (const variant of fetched.items) {
        const input = this.toVariantInput(product.externalProductId, variant);
        if (input) variants.push(input);
      }
    }

    this.logger.log({
      module: 'fulfillment',
      provider: 'SELLERWIX',
      operation: 'catalog.fetch',
      accountId: account.id,
      catalogues: catalogues.length,
      products: products.length,
      variants: variants.length,
      apiCalls,
      complete: warnings.length === 0,
      msg: 'Đã đọc danh mục Sellerwix',
    });

    return { catalogues, products, variants, apiCalls, warnings };
  }

  /**
   * Mọi trang biến thể của một sản phẩm (`next_page` là cursor; rỗng = hết).
   * Đọc đủ khi số bản ghi gom được khớp `paging.total` (nếu Sellerwix báo).
   */
  private async fetchVariants(
    ctx: Parameters<SellerwixApiClient['listVariants']>[0],
    productSku: string,
  ): Promise<{ items: SellerwixVariant[]; apiCalls: number; warning: string | null }> {
    const items: SellerwixVariant[] = [];
    let apiCalls = 0;
    let cursor: string | null = null;
    let reportedTotal: number | null = null;

    try {
      for (let page = 1; ; page += 1) {
        if (page > SELLERWIX_MAX_PAGES_PER_PRODUCT) {
          return {
            items,
            apiCalls,
            warning: `Biến thể của ${productSku} dừng ở trần ${SELLERWIX_MAX_PAGES_PER_PRODUCT} trang (${items.length}/${reportedTotal ?? '?'}).`,
          };
        }
        const result = await this.client.listVariants(ctx, productSku, cursor);
        apiCalls += 1;
        items.push(...(result.data?.data ?? []));
        if (typeof result.data?.paging?.total === 'number')
          reportedTotal = result.data.paging.total;

        cursor = result.data?.paging?.next_page?.trim() || null;
        if (!cursor) break;
      }
    } catch (error) {
      return {
        items,
        apiCalls: apiCalls + 1,
        warning: `Biến thể của ${productSku} đọc THIẾU (${items.length}/${reportedTotal ?? '?'}): ${(error as Error).message}`,
      };
    }

    const warning =
      reportedTotal !== null && items.length < reportedTotal
        ? `Biến thể của ${productSku} đọc THIẾU: ${items.length}/${reportedTotal}.`
        : null;
    return { items, apiCalls, warning };
  }

  private toVariantInput(productSku: string, item: SellerwixVariant): VariantUpsertInput | null {
    const sku = item.sku?.trim();
    if (!sku) return null;
    const color = item.color?.name?.trim() || null;
    const size = item.size?.name?.trim() || null;
    return {
      externalProductId: productSku,
      externalVariantId: sku,
      sku,
      name: item.title?.trim() || [color, size].filter(Boolean).join(' / ') || sku,
      color,
      size,
      // Giữ nguyên số Sellerwix báo, dạng chuỗi — cột `price` là chuỗi để không mất định dạng.
      price: typeof item.cost === 'number' ? String(item.cost) : null,
      status:
        item.active === false
          ? FulfillmentCatalogItemStatus.INACTIVE
          : FulfillmentCatalogItemStatus.ACTIVE,
      // `print_areas`, `label_support`, `is_rush_service` nằm ở đây — luồng gửi đơn đọc lại.
      rawData: item as unknown as Prisma.InputJsonValue,
    };
  }
}
