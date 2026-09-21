import { Injectable } from '@nestjs/common';
import {
  PodBrandMode,
  PodImageAssetType,
  PodListingJobItemStatus,
  PodListingJobType,
  PodListingMarket,
  type Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import {
  POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID,
  POD_TIKTOK_NO_BRAND_NAME,
  isNoBrandName,
} from '../../pod-product/constants/pod-product.constants';
import { POD_DRAFT_ISSUE_CODES } from '../constants/pod-listing.constants';
import type {
  ResolveIssue,
  ResolveResult,
  ResolvedListing,
  ResolvedVariant,
} from './pod-listing-resolver.service';
import { resolveListingCurrency } from './pod-market-currency';

/** Những gì resolver cần của sản phẩm nguồn — chọn đúng cột, không kéo cả aggregate. */
export const CLONE_SOURCE_SELECT = {
  id: true,
  organizationId: true,
  shopId: true,
  tiktokProductId: true,
  title: true,
  description: true,
  status: true,
  deactivatedAt: true,
  tiktokBrandId: true,
  brandName: true,
  tiktokCategoryId: true,
  categoryName: true,
  categoryPath: true,
  packageLength: true,
  packageWidth: true,
  packageHeight: true,
  dimensionUnit: true,
  packageWeight: true,
  weightUnit: true,
  searchTerms: true,
  keyProductFeatures: true,
  sizeChartUri: true,
  sizeChartUrl: true,
  sizeChartTemplateId: true,
  currency: true,
  shop: { select: { id: true, name: true, region: true } },
  variants: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      tiktokSkuId: true,
      sellerSku: true,
      variantName: true,
      salesAttributes: true,
      salePrice: true,
      listPrice: true,
      currency: true,
      inventoryTotal: true,
      imageUrl: true,
    },
  },
  images: {
    where: { variantId: null },
    orderBy: { sortOrder: 'asc' },
    select: { uri: true, url: true, width: true, height: true, sortOrder: true },
  },
  videos: { orderBy: { createdAt: 'asc' }, select: { url: true, tiktokVideoId: true } },
  attributes: {
    orderBy: { name: 'asc' },
    select: { tiktokAttributeId: true, name: true, values: true },
  },
} satisfies Prisma.PodProductSelect;

export type CloneSourceProduct = Prisma.PodProductGetPayload<{ select: typeof CLONE_SOURCE_SELECT }>;

/** Shop đích — đúng ba cột resolver cần. */
export interface CloneTargetShop {
  id: string;
  name: string;
  region: string | null;
}

/** Danh mục đã tra trong cây master TOÀN CỤC. `null` = không có / không phải lá. */
export interface CloneCategory {
  tiktokCategoryId: string;
  localName: string | null;
  path: string | null;
}

/** Ngữ cảnh đã nạp sẵn — hàm `resolveCloneListing` là hàm THUẦN để unit test không cần DB. */
export interface CloneResolveContext {
  product: CloneSourceProduct;
  targetShop: CloneTargetShop;
  /** Thị trường của lượt chạy (suy từ shop NGUỒN — xem `marketOfRegion`). */
  market: PodListingMarket;
  category: CloneCategory | null;
}

/**
 * `region` của shop (Get Authorized Shops, mã ISO) ⇒ `PodListingMarket` của hệ thống.
 *
 * Chỉ khác nhau ở Vương quốc Anh (`GB` ↔ `UK`). Vùng không có trong enum ⇒ `null` — job không
 * tạo được vì `market` là cột bắt buộc, và đó là điều đúng: một shop ở thị trường hệ thống
 * chưa biết thì cũng chưa biết tiền tệ để đăng.
 */
export function marketOfRegion(region: string | null | undefined): PodListingMarket | null {
  if (!region) return null;
  const code = region.trim().toUpperCase();
  const alias = code === 'GB' ? 'UK' : code;
  return (Object.values(PodListingMarket) as string[]).includes(alias)
    ? (alias as PodListingMarket)
    : null;
}

/**
 * Sản phẩm đã đồng bộ ⇒ `ResolvedListing` cho MỘT shop đích — **không qua template**.
 *
 * ```
 *   PodProduct (nguồn)                        ResolvedListing (đích)
 *   ─────────────────                         ────────────────────────
 *   title / description / ST / highlights  →  chép nguyên
 *   tiktokCategoryId                       →  PHẢI có trong cây master toàn cục (lá) — không thì lỗi
 *   tiktokBrandId / brandName              →  SPECIFIC, hoặc NONE khi không có / "No brand"
 *   attributes[]                           →  product_attributes (id + values{id,name})
 *   images[] (variantId = null)            →  theo đúng sortOrder; `url` để publisher tải & upload lại
 *   variants[]                             →  optionValues từ sales_attributes, giá / tồn / SKU / ảnh SKU
 *   sizeChartUrl                           →  sizeChart.url (upload lại với SIZE_CHART_IMAGE)
 *   videos[0].url                          →  video.url (tải & Upload Product File lại)
 *   package*                               →  chép nguyên
 *   warehouse                              →  KHÔNG mang theo — publisher quyết theo shop đích
 * ```
 *
 * 🔴 **KHÔNG chép định danh của listing cũ**: TikTok Product ID, SKU ID, `uri` ảnh, video id,
 * warehouse id, size chart template id của shop nguồn đều bị bỏ. Chúng chỉ có nghĩa ở shop
 * nguồn; shop đích được cấp id mới sau Create Product. `source.tiktokProductId` chỉ để TRUY VẾT
 * (external_id / log), không đi vào request.
 *
 * 🔴 Tiền tệ theo **shop đích** (`resolveListingCurrency`): số tiền chép nguyên, mã tiền tệ
 * đổi theo shop. Khác tiền tệ nguồn ⇒ cảnh báo để người vận hành biết mà sửa giá sau.
 */
export function resolveCloneListing(ctx: CloneResolveContext): ResolveResult {
  const issues: ResolveIssue[] = [];
  const { product, targetShop, category, market } = ctx;

  if (!category) {
    issues.push({
      level: 'ERROR',
      field: 'category',
      code: POD_DRAFT_ISSUE_CODES.MISSING_CATEGORY,
      message: product.tiktokCategoryId
        ? `Danh mục "${product.categoryPath ?? product.categoryName ?? product.tiktokCategoryId}" ` +
          `(${product.tiktokCategoryId}) của sản phẩm nguồn không có trong cây danh mục TikTok đã đồng bộ ` +
          'hoặc không phải danh mục lá — không nhân bản được.'
        : 'Sản phẩm nguồn không có danh mục TikTok.',
    });
  }

  const currency = resolveListingCurrency({
    shopRegion: targetShop.region,
    market,
    fallback: product.currency,
  });
  if (!currency.currency) {
    issues.push({
      level: 'ERROR',
      field: 'variants.currency',
      code: POD_DRAFT_ISSUE_CODES.MISSING_CURRENCY,
      message: `Không xác định được tiền tệ cho shop "${targetShop.name}" (vùng ${targetShop.region ?? '?'}).`,
    });
  } else if (product.currency && product.currency.toUpperCase() !== currency.currency) {
    issues.push({
      level: 'WARNING',
      field: 'variants.currency',
      code: POD_DRAFT_ISSUE_CODES.CURRENCY_MISMATCH,
      message:
        `Sản phẩm nguồn niêm yết ${product.currency.toUpperCase()} nhưng shop "${targetShop.name}" dùng ` +
        `${currency.currency} — giá được chép nguyên số và gửi bằng ${currency.currency}; kiểm tra lại giá sau khi nhân bản.`,
    });
  }

  const images = resolveImages(product, issues);
  const variants = resolveVariants(product, currency.currency, issues);
  const sizeChart = resolveSizeChart(product, issues);

  const payload: ResolvedListing = {
    market,
    title: product.title ?? '',
    description: product.description ?? '',
    ...(toStringArray(product.searchTerms).length > 0
      ? { searchTerms: toStringArray(product.searchTerms) }
      : {}),
    ...(toStringArray(product.keyProductFeatures).length > 0
      ? { highlights: toStringArray(product.keyProductFeatures) }
      : {}),
    category: {
      tiktokCategoryId: category?.tiktokCategoryId ?? null,
      name: category?.localName ?? product.categoryName ?? null,
      path: category?.path ?? product.categoryPath ?? null,
    },
    brand: resolveBrand(product),
    attributes: product.attributes.map((attribute) => {
      const values = toAttributeValues(attribute.values);
      return {
        tiktokAttributeId: attribute.tiktokAttributeId,
        name: attribute.name,
        // Get Product chỉ trả `product_attributes` (thuộc tính sản phẩm); thuộc tính BÁN HÀNG
        // (Color/Size) nằm trong `skus[].sales_attributes` và đã đi vào `variants`.
        type: 'PRODUCT_PROPERTY',
        isRequired: false,
        values: values.filter((value) => value.id !== undefined),
        customValues: values
          .filter((value) => value.id === undefined && value.name)
          .map((value) => value.name as string),
      };
    }),
    images,
    sizeChart,
    video: resolveVideo(product),
    package: {
      weight: product.packageWeight,
      weightUnit: product.weightUnit,
      length: product.packageLength,
      width: product.packageWidth,
      height: product.packageHeight,
      dimensionUnit: product.dimensionUnit,
    },
    // 🔴 Kho là dữ liệu CỦA SHOP: kho của shop nguồn vô nghĩa ở shop đích. Publisher tra theo
    // Warehouse Mapping / kho duy nhất / kho mặc định của chính shop đích.
    warehouse: { id: null, tiktokWarehouseId: null, name: null },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: null,
    variants,
    source: {
      productId: product.id,
      sessionProductId: null,
      tiktokProductId: product.tiktokProductId,
      shopId: targetShop.id,
      // Không có Listing Template — cùng quy ước với template ghép trong bộ nhớ của session.
      listingTemplateId: '',
      imageTemplateId: null,
    },
  };

  if (!payload.package.weight) {
    issues.push({
      level: 'ERROR',
      field: 'package',
      code: POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE,
      message: 'Sản phẩm nguồn không có khối lượng kiện hàng',
    });
  }
  if (!payload.description.trim()) {
    issues.push({
      level: 'ERROR',
      field: 'description',
      code: POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION,
      message: 'Sản phẩm nguồn không có mô tả',
    });
  }

  return {
    payload,
    issues,
    payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

// ---------------------------------------------------------------------------
// Private (hàm thuần)
// ---------------------------------------------------------------------------

function resolveBrand(product: CloneSourceProduct): ResolvedListing['brand'] {
  const id = product.tiktokBrandId?.trim();
  // Không có brand, id giả cũ, hoặc tên là "No brand" ⇒ NONE: publisher bỏ hẳn `brand_id`.
  if (!id || id === POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID || isNoBrandName(product.brandName)) {
    return { mode: PodBrandMode.NONE, tiktokBrandId: null, name: POD_TIKTOK_NO_BRAND_NAME };
  }
  return { mode: PodBrandMode.SPECIFIC, tiktokBrandId: id, name: product.brandName ?? null };
}

/**
 * Bộ ảnh chính theo đúng `sortOrder` của sản phẩm nguồn.
 *
 * 🔴 `tiktokImageUri` để `null` CÓ CHỦ Ý dù nguồn có `uri`: `uri` đó do Seller Center (hoặc app
 * khác) upload cho shop nguồn, không có gì bảo đảm shop đích nhận. Publisher tải `url` về rồi
 * Upload Product Image lại (một lần cho cả lượt, dùng chung cho mọi shop đích nhờ cache).
 */
function resolveImages(product: CloneSourceProduct, issues: ResolveIssue[]): ResolvedListing['images'] {
  const seen = new Set<string>();
  const images: ResolvedListing['images'] = [];
  for (const image of [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const url = image.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      title: `Ảnh ${images.length + 1}`,
      assetType: images.length === 0 ? PodImageAssetType.MAIN_FRONT : PodImageAssetType.DETAIL,
      fileId: '',
      url,
      imageKey: '',
      width: image.width,
      height: image.height,
      isRequired: images.length === 0,
      tiktokImageUri: null,
      sortOrder: images.length,
    });
  }
  if (images.length === 0) {
    issues.push({
      level: 'ERROR',
      field: 'images',
      code: POD_DRAFT_ISSUE_CODES.MISSING_IMAGE,
      message: 'Sản phẩm nguồn không có ảnh chính nào tải về được',
    });
  }
  return images;
}

/**
 * Biến thể: đủ tổ hợp, đủ giá / tồn / Seller SKU / ảnh SKU — KHÔNG mang `tiktokSkuId`.
 *
 * Seller SKU trống ⇒ sinh từ tên biến thể (hoặc số thứ tự) vì bảng payload item bắt buộc có và
 * TikTok cũng cần mã để đối soát đơn. Seller SKU trùng trong cùng sản phẩm ⇒ lỗi chặn (TikTok
 * từ chối cả sản phẩm).
 */
function resolveVariants(
  product: CloneSourceProduct,
  currency: string | null,
  issues: ResolveIssue[],
): ResolvedVariant[] {
  if (product.variants.length === 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants',
      code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
      message: 'Sản phẩm nguồn không có biến thể (SKU) nào',
    });
    return [];
  }

  const seen = new Set<string>();
  const duplicated: string[] = [];
  const missingPrice: string[] = [];

  const variants = product.variants.map((variant, index): ResolvedVariant => {
    const optionValues = toOptionValues(variant.salesAttributes);
    const variantName =
      variant.variantName?.trim() ||
      optionValues.map((option) => option.value).join(' / ') ||
      `SKU ${index + 1}`;
    const sellerSku = variant.sellerSku?.trim() || slug(variantName) || `SKU-${index + 1}`;

    if (seen.has(sellerSku)) duplicated.push(sellerSku);
    else seen.add(sellerSku);

    const salePrice = positiveDecimal(variant.salePrice?.toString());
    if (!salePrice) missingPrice.push(sellerSku);

    return {
      variantName,
      sellerSku,
      barcode: null,
      optionValues,
      salePrice,
      retailPrice: positiveDecimal(variant.listPrice?.toString()),
      currency,
      quantity: Math.max(0, variant.inventoryTotal ?? 0),
      imageFileId: null,
      imageUrl: variant.imageUrl?.trim() || null,
      sortOrder: index,
    };
  });

  if (missingPrice.length > 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants.salePrice',
      code: POD_DRAFT_ISSUE_CODES.MISSING_PRICE,
      message: `Biến thể chưa có giá bán hợp lệ — SKU: ${missingPrice.slice(0, 3).join(', ')}${
        missingPrice.length > 3 ? `… (tổng ${missingPrice.length})` : ''
      }`,
    });
  }
  if (duplicated.length > 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants.sellerSku',
      code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
      message: `Seller SKU bị trùng trong sản phẩm nguồn: ${[...new Set(duplicated)].join(', ')}`,
    });
  }

  return variants;
}

/**
 * Bảng size.
 *
 * - Có ảnh (`sizeChartUrl`) ⇒ tải về, upload lại với `SIZE_CHART_IMAGE` (publisher; bắt buộc
 *   thành công — `sizeChartRequired`).
 * - Chỉ có `sizeChartTemplateId` ⇒ **lỗi chặn**: mẫu bảng size là dữ liệu RIÊNG của shop nguồn
 *   (Get Size Chart Templates theo shop), id đó không tồn tại ở shop đích. Không có cách nào
 *   nhân bản đúng ⇒ báo rõ thay vì đăng một bản sao thiếu bảng size.
 * - Không có ⇒ `null`.
 */
function resolveSizeChart(
  product: CloneSourceProduct,
  issues: ResolveIssue[],
): ResolvedListing['sizeChart'] {
  const url = product.sizeChartUrl?.trim();
  if (url) return { fileId: null, url, tiktokImageUri: null };
  if (product.sizeChartTemplateId) {
    issues.push({
      level: 'ERROR',
      field: 'sizeChart',
      code: POD_DRAFT_ISSUE_CODES.MISSING_IMAGE,
      message:
        `Bảng size của sản phẩm nguồn là mẫu riêng của shop nguồn (template ${product.sizeChartTemplateId}) ` +
        '— không nhân bản được sang shop khác. Sửa sản phẩm nguồn dùng ảnh bảng size rồi thử lại.',
    });
  }
  return null;
}

/** Video: chỉ mang URL để publisher tải & upload lại; `tiktokVideoId` nguồn KHÔNG dùng lại. */
function resolveVideo(product: CloneSourceProduct): ResolvedListing['video'] {
  const url = product.videos.find((video) => video.url?.trim())?.url?.trim();
  return url ? { fileId: null, url, tiktokVideoId: null } : null;
}

/** `sales_attributes[]` của SKU (đã lưu nguyên dạng SDK: `{ name, valueName, … }`) ⇒ trục/giá trị. */
function toOptionValues(value: Prisma.JsonValue | null): Array<{ name: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isJsonObject)
    .map((entry) => ({
      name: asString(entry.name) ?? '',
      value: asString(entry.valueName) ?? asString(entry.value_name) ?? '',
    }))
    .filter((entry) => entry.name !== '' && entry.value !== '');
}

function toAttributeValues(value: Prisma.JsonValue | null): Array<{ id?: string; name?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isJsonObject)
    .map((entry) => ({ id: asString(entry.id) ?? undefined, name: asString(entry.name) ?? undefined }))
    .filter((entry) => entry.id !== undefined || entry.name !== undefined);
}

function toStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((entry): entry is string => entry !== null);
}

function positiveDecimal(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? text : null;
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toUpperCase();
}

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Lý do một shop đích bị BỎ QUA (không tạo listing) — trả về cho màn hình kết quả. */
export interface CloneSkipReason {
  code: 'SOURCE_SHOP' | 'ALREADY_CLONED' | 'ALREADY_EXISTS' | 'IN_PROGRESS';
  message: string;
}

/**
 * PodProductCloneResolverService — nạp sản phẩm nguồn, tra danh mục toàn cục, và kiểm
 * "shop đích đã có sản phẩm này chưa".
 *
 * Phần giải nội dung là hàm thuần `resolveCloneListing`; service này chỉ làm việc với DB.
 */
@Injectable()
export class PodProductCloneResolverService {
  constructor(private readonly prisma: PrismaService) {}

  loadSource(organizationId: string, productId: string): Promise<CloneSourceProduct | null> {
    return this.prisma.podProduct.findFirst({
      where: { id: productId, organizationId, deletedAt: null },
      select: CLONE_SOURCE_SELECT,
    });
  }

  /**
   * Tra danh mục của sản phẩm nguồn trong cây master TOÀN CỤC (không theo tổ chức / shop).
   *
   * 🔴 Phải là danh mục LÁ: TikTok chỉ cho đăng ở lá. Không có / không phải lá ⇒ `null` ⇒
   * `resolveCloneListing` chặn bằng lỗi rõ ràng, KHÔNG chép mù id sang shop đích.
   */
  async resolveCategory(tiktokCategoryId: string | null): Promise<CloneCategory | null> {
    if (!tiktokCategoryId) return null;
    const category = await this.prisma.podProductCategory.findFirst({
      where: { tiktokCategoryId, deletedAt: null, isLeaf: true },
      select: { tiktokCategoryId: true, localName: true, path: true },
    });
    return category ?? null;
  }

  resolve(
    product: CloneSourceProduct,
    targetShop: CloneTargetShop,
    market: PodListingMarket,
    category: CloneCategory | null,
  ): ResolveResult {
    return resolveCloneListing({ product, targetShop, market, category });
  }

  /**
   * Shop đích đã có sản phẩm này chưa? — **kiểm TRƯỚC khi tạo item**, và kiểm lại trong pipeline.
   *
   * Ba dấu hiệu, theo thứ tự rẻ → đắt:
   *  1. Cùng shop nguồn ⇒ bỏ qua (nhân bản vào chính nó là tạo sản phẩm trùng).
   *  2. Đã có Draft Listing (payload) của cặp (sản phẩm nguồn, shop đích) mang `tiktokProductId`
   *     ⇒ lượt trước đã tạo xong trên sàn.
   *  3. Shop đích có sản phẩm ĐANG BÁN mang cùng Seller SKU với sản phẩm nguồn ⇒ coi là đã có.
   *  4. Đang có item CLONE chưa xong cho đúng cặp này ⇒ hai lần bấm liên tiếp, không chạy đôi.
   *
   * 🔴 Không tự ghi đè sản phẩm đang bán — quy tắc của yêu cầu: SKIPPED, nói rõ vì sao.
   */
  async findSkipReason(
    organizationId: string,
    product: CloneSourceProduct,
    targetShopId: string,
  ): Promise<CloneSkipReason | null> {
    if (targetShopId === product.shopId) {
      return { code: 'SOURCE_SHOP', message: 'Đây là shop nguồn của sản phẩm — không nhân bản vào chính nó.' };
    }

    const cloned = await this.prisma.podListingPayload.findFirst({
      where: {
        organizationId,
        shopId: targetShopId,
        productId: product.id,
        listingTemplateId: null,
        deletedAt: null,
        tiktokProductId: { not: null },
      },
      select: { tiktokProductId: true },
    });
    if (cloned) {
      return {
        code: 'ALREADY_CLONED',
        message: `Sản phẩm đã được nhân bản sang shop này trước đó (TikTok Product ID ${cloned.tiktokProductId}).`,
      };
    }

    const sellerSkus = product.variants
      .map((variant) => variant.sellerSku?.trim())
      .filter((sku): sku is string => Boolean(sku));
    if (sellerSkus.length > 0) {
      const existing = await this.prisma.podProduct.findFirst({
        where: {
          organizationId,
          shopId: targetShopId,
          deletedAt: null,
          deactivatedAt: null,
          variants: { some: { deletedAt: null, sellerSku: { in: sellerSkus } } },
        },
        select: { tiktokProductId: true, title: true },
      });
      if (existing) {
        return {
          code: 'ALREADY_EXISTS',
          message:
            `Shop đã có sản phẩm mang cùng Seller SKU (TikTok Product ID ${existing.tiktokProductId}` +
            `${existing.title ? ` · ${existing.title.slice(0, 60)}` : ''}) — không tạo bản trùng.`,
        };
      }
    }

    const inProgress = await this.prisma.podListingJobItem.findFirst({
      where: {
        organizationId,
        productId: product.id,
        shopId: targetShopId,
        status: {
          in: [
            PodListingJobItemStatus.PENDING,
            PodListingJobItemStatus.PROCESSING,
            PodListingJobItemStatus.RETRYING,
          ],
        },
        job: { type: PodListingJobType.CLONE, deletedAt: null },
      },
      select: { jobId: true },
    });
    if (inProgress) {
      return {
        code: 'IN_PROGRESS',
        message: 'Đang có một lượt nhân bản khác chạy cho shop này — không chạy trùng.',
      };
    }

    return null;
  }
}
