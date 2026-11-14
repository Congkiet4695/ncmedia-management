import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentCatalogItemStatus, Prisma } from '@prisma/client';
import type {
  CatalogueUpsertInput,
  ProductUpsertInput,
  VariantUpsertInput,
} from '../../repositories/fulfillment-catalog.repository';
import { PressifyApiClient } from '../clients/pressify-api.client';
import { PRESSIFY_CURRENCY } from '../constants/pressify.constants';
import type { PressifyProduct, PressifyVariant } from '../types/pressify-api.types';
import {
  PressifyCredentialService,
  type PressifyAccountCredentialRef,
} from './pressify-credential.service';

/** Danh mục Pressify đã chuẩn hoá — đúng đầu vào của `FulfillmentCatalogRepository`. */
export interface PressifyCatalogSnapshot {
  catalogues: CatalogueUpsertInput[];
  products: ProductUpsertInput[];
  variants: VariantUpsertInput[];
  apiCalls: number;
  /** Rỗng = đọc ĐỦ; có phần tử = dữ liệu thiếu / lệch ⇒ KHÔNG được archive. */
  warnings: string[];
}

/**
 * PressifyCatalogService — đọc TOÀN BỘ danh mục Pressify để đồng bộ vào bản sao chung.
 *
 * ```
 *   GET /all-product (không key, không phân trang) → fulfillment_catalogues  (suy từ `style`)
 *                                                  → fulfillment_products    (id sản phẩm)
 *                                                  → fulfillment_variants    (variant_id)
 * ```
 *
 * Định danh (đã kiểm trên API thật 2026-11-11, 29 sản phẩm / 807 biến thể):
 *   - `external_product_id` = `product.id` (số nguyên).
 *   - `external_variant_id` = `variant_id` (số nguyên, duy nhất toàn danh mục) — chính là giá trị gửi vào
 *     `line_items[].variant_id`. `variant.id` của API luôn NULL (tài liệu: "Use variant_id, not id").
 *   - `sku` = SKU Pressify nguyên văn; biến thể KHÔNG có SKU (294/807) ⇒ `sku` = chính `variant_id`.
 *     🔴 Vì sao: `fulfillment_product_mappings.provider_sku` có CHECK `length(btrim(provider_sku)) > 0` (từ
 *     migration đầu của module) — lưu SKU rỗng làm Save configuration lỗi 500 và không tạo được ánh xạ. Dùng
 *     `variant_id` là đúng ngữ nghĩa Pressify: tài liệu GET /products nhận `sku` = "A variant_id, to fetch one
 *     variant". SKU vẫn KHÔNG phải định danh — định danh / giá trị gửi đi luôn là `external_variant_id`.
 *
 * Danh mục: Pressify không có thực thể danh mục (`catalog_id` luôn rỗng). Nhóm theo `style` — trường
 * thật của sản phẩm (T-shirt, Hoodie, Poster…), không bịa nhóm. Sản phẩm không có style ⇒ không danh mục.
 *
 * Giá: danh mục công khai chỉ có giá theo BẬC (`product_prices[]`). Giá ghi vào biến thể (lớp theo tài
 * khoản) = giá của bậc khai ở tài khoản; chưa khai bậc ⇒ NULL. Các field `price` / `basecost` /
 * `landed_cost*` là giá NỘI BỘ (tài liệu: "not what you pay") ⇒ KHÔNG bao giờ dùng làm giá vốn.
 */
@Injectable()
export class PressifyCatalogService {
  private readonly logger = new Logger(PressifyCatalogService.name);

  constructor(private readonly client: PressifyApiClient) {}

  async fetchCatalog(account: PressifyAccountCredentialRef): Promise<PressifyCatalogSnapshot> {
    const warnings: string[] = [];
    const tierId = PressifyCredentialService.readConfig(account.providerConfig).tierId;

    // Một lời gọi. Lỗi ở đây (mạng, 5xx, JSON hỏng) ⇒ ném ra: lượt đồng bộ FAILED, bảng cũ GIỮ NGUYÊN.
    const result = await this.client.listAllProducts(account.baseUrlOverride);
    const response = result.data;
    if (!response || !Array.isArray(response.data)) {
      throw new Error(
        'Pressify trả về danh sách sản phẩm không đúng định dạng (thiếu mảng `data`).',
      );
    }
    if (response.data.length === 0) {
      // Danh mục rỗng chưa từng xảy ra; coi là bất thường ⇒ KHÔNG archive toàn bộ bản sao.
      warnings.push(
        'Pressify trả về danh mục RỖNG — giữ nguyên bản sao hiện có, không đánh dấu ngừng bán.',
      );
    }
    if (tierId && response.tiers && !(tierId in response.tiers)) {
      this.logger.warn({
        module: 'fulfillment',
        provider: 'PRESSIFY',
        operation: 'catalog.tier',
        accountId: account.id,
        tierId,
        msg: 'Bậc giá khai ở tài khoản không có trong danh sách bậc công khai — giá biến thể để trống',
      });
    }

    const catalogues = new Map<string, CatalogueUpsertInput>();
    const products: ProductUpsertInput[] = [];
    const variants: VariantUpsertInput[] = [];
    const seenVariant = new Set<string>();

    for (const product of response.data) {
      if (product?.id === undefined || product.id === null) {
        warnings.push('Có sản phẩm Pressify không có id — bỏ qua bản ghi đó.');
        continue;
      }
      const productId = String(product.id);
      const style = product.style?.trim() || null;
      if (style && !catalogues.has(style)) {
        catalogues.set(style, { externalCatalogueId: style, name: style, rawData: { style } });
      }

      const productVariants = Array.isArray(product.variants) ? product.variants : [];
      products.push(this.toProductInput(product, productId, style, productVariants.length));

      for (const variant of productVariants) {
        const input = this.toVariantInput(productId, product, variant, tierId);
        if (!input) {
          warnings.push(`Biến thể của sản phẩm ${productId} thiếu variant_id — bỏ qua bản ghi đó.`);
          continue;
        }
        if (seenVariant.has(input.externalVariantId)) {
          // variant_id phải duy nhất (đã kiểm). Trùng ⇒ dữ liệu bất thường: giữ bản đầu, không archive.
          warnings.push(
            `variant_id ${input.externalVariantId} xuất hiện hai lần — giữ bản đầu tiên.`,
          );
          continue;
        }
        seenVariant.add(input.externalVariantId);
        variants.push(input);
      }
    }

    this.logger.log({
      module: 'fulfillment',
      provider: 'PRESSIFY',
      operation: 'catalog.fetch',
      accountId: account.id,
      catalogues: catalogues.size,
      products: products.length,
      variants: variants.length,
      variantsWithoutSku: variants.filter((variant) => !variant.sku).length,
      tierConfigured: Boolean(tierId),
      apiCalls: 1,
      complete: warnings.length === 0,
      msg: 'Đã đọc danh mục Pressify',
    });

    return { catalogues: [...catalogues.values()], products, variants, apiCalls: 1, warnings };
  }

  private toProductInput(
    product: PressifyProduct,
    productId: string,
    style: string | null,
    variationsCount: number,
  ): ProductUpsertInput {
    // Biến thể được lưu riêng — không nhân đôi mảng biến thể vào payload sản phẩm.
    const { variants: _variants, ...raw } = product;
    void _variants;
    return {
      externalProductId: productId,
      externalCatalogueId: style,
      name: product.name?.trim() || productId,
      // Pressify không có SKU cấp sản phẩm.
      sku: null,
      image: product.mockup_src?.trim() || null,
      basePrice: null,
      currency: PRESSIFY_CURRENCY,
      variationsCount,
      status:
        product.status === 0
          ? FulfillmentCatalogItemStatus.INACTIVE
          : FulfillmentCatalogItemStatus.ACTIVE,
      rawData: raw as unknown as Prisma.InputJsonValue,
    };
  }

  private toVariantInput(
    productId: string,
    product: PressifyProduct,
    variant: PressifyVariant,
    tierId: string,
  ): VariantUpsertInput | null {
    if (variant?.variant_id === undefined || variant.variant_id === null) return null;
    const externalVariantId = String(variant.variant_id).trim();
    if (!externalVariantId) return null;

    const color = variant.color?.trim() || null;
    const size = variant.size?.trim() || null;
    return {
      externalProductId: productId,
      externalVariantId,
      // SKU thật nếu có; không có ⇒ variant_id (giá trị tra `sku` của Pressify, thoả CHECK provider_sku của ánh xạ).
      sku: variant.sku?.trim() || externalVariantId,
      name: [color, size].filter(Boolean).join(' / ') || product.name?.trim() || externalVariantId,
      color,
      size,
      price: tierId ? tierPrice(variant, tierId) : null,
      status: isActive(variant.active)
        ? FulfillmentCatalogItemStatus.ACTIVE
        : FulfillmentCatalogItemStatus.INACTIVE,
      // `style` cần cho kiểm tra DTG khi gửi đơn — giữ nguyên payload biến thể + style của sản phẩm.
      rawData: {
        ...variant,
        product_style: product.style ?? null,
      } as unknown as Prisma.InputJsonValue,
    };
  }
}

/** API thật trả `active` = 1 / 0. Thiếu field ⇒ coi là đang bán (GET /all-product chỉ trả sản phẩm đang bán). */
function isActive(value: PressifyVariant['active']): boolean {
  if (value === undefined || value === null) return true;
  return value === true || value === 1;
}

/**
 * Giá của biến thể ở MỘT bậc. API thật trả hai dòng mỗi bậc (`shipping_type` 0 / 1) với cùng giá (đã kiểm
 * 807/807 biến thể không có giá lệch) — ưu tiên `shipping_type = 0`. Không có giá ⇒ NULL.
 */
export function tierPrice(variant: PressifyVariant, tierId: string): string | null {
  const rows = (variant.product_prices ?? []).filter((row) => String(row.tier_id) === tierId);
  const row = rows.find((candidate) => Number(candidate.shipping_type ?? 0) === 0) ?? rows[0];
  if (!row || row.price === null || row.price === undefined) return null;
  const text = String(row.price).trim();
  return text && Number.isFinite(Number(text)) ? text : null;
}
