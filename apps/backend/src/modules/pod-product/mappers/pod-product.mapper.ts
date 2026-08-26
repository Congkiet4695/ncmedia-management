import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type {
  TiktokCategoryAttribute,
  TiktokCategoryNode,
  TiktokProductDetail,
  TiktokProductSku,
} from '../../tiktok-sdk/types/tiktok-product.types';

/** Dữ liệu ghi cho bảng `pod_products` (chưa gồm quan hệ). */
export interface PodProductWriteData {
  tiktokProductId: string;
  title: string | null;
  description: string | null;
  status: string | null;
  auditStatus: string | null;
  tiktokBrandId: string | null;
  brandName: string | null;
  tiktokCategoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  packageLength: string | null;
  packageWidth: string | null;
  packageHeight: string | null;
  dimensionUnit: string | null;
  packageWeight: string | null;
  weightUnit: string | null;
  isNotForSale: boolean;
  hasDraft: boolean;
  listingQualityTier: string | null;
  productTags: string[] | null;
  salesRegions: string[] | null;
  productTypes: string[] | null;
  skuCount: number;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  currency: string | null;
  totalInventory: number;
  tiktokCreateTime: bigint | null;
  tiktokUpdateTime: bigint | null;
  tiktokCreatedAt: Date | null;
  tiktokUpdatedAt: Date | null;
  payloadHash: string;
}

/** Dữ liệu ghi cho một biến thể (SKU). */
export interface PodProductVariantWriteData {
  tiktokSkuId: string;
  sellerSku: string | null;
  externalSkuId: string | null;
  variantName: string | null;
  salesAttributes: Prisma.InputJsonValue | undefined;
  salePrice: Prisma.Decimal | null;
  listPrice: Prisma.Decimal | null;
  taxExclusivePrice: Prisma.Decimal | null;
  currency: string | null;
  inventoryTotal: number;
  inventory: Prisma.InputJsonValue | undefined;
  skuWeight: string | null;
  weightUnit: string | null;
  skuLength: string | null;
  skuWidth: string | null;
  skuHeight: string | null;
  dimensionUnit: string | null;
  status: string | null;
  imageUrl: string | null;
}

/** Ảnh — `variantSkuId` khác null nghĩa là ảnh thuộc SKU chứ không phải ảnh chính. */
export interface PodProductImageWriteData {
  uri: string | null;
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  variantSkuId: string | null;
}

export interface PodProductVideoWriteData {
  tiktokVideoId: string | null;
  url: string | null;
  coverUrl: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  size: bigint | null;
}

export interface PodProductAttributeWriteData {
  tiktokAttributeId: string;
  name: string | null;
  values: Prisma.InputJsonValue | undefined;
}

/** Toàn bộ dữ liệu ghi của MỘT sản phẩm sau khi ánh xạ. */
export interface MappedProduct {
  product: PodProductWriteData;
  variants: PodProductVariantWriteData[];
  images: PodProductImageWriteData[];
  videos: PodProductVideoWriteData[];
  attributes: PodProductAttributeWriteData[];
}

/**
 * PodProductMapper — Anti-Corruption Layer giữa dữ liệu TikTok và schema NCMedia.
 *
 * Nguyên tắc:
 *  - **Không tin dữ liệu ngoài (P7):** mọi trường đều có thể thiếu; số tiền TikTok trả
 *    dạng CHUỖI nên parse có kiểm soát, sai định dạng ⇒ NULL chứ không ném lỗi làm hỏng
 *    cả lượt đồng bộ.
 *  - **Cắt độ dài** theo đúng giới hạn cột: một tiêu đề dài bất thường không được phép
 *    làm fail cả transaction.
 *  - `payloadHash` tính trên payload GỐC ⇒ payload không đổi thì bỏ qua mọi lệnh ghi.
 */
@Injectable()
export class PodProductMapper {
  /** Ánh xạ chi tiết sản phẩm (Get Product) sang dữ liệu ghi. */
  toWriteData(detail: TiktokProductDetail, rawPayload: unknown): MappedProduct {
    const variants = (detail.skus ?? []).map((sku) => this.toVariant(sku));
    const prices = variants
      .map((variant) => variant.salePrice)
      .filter((price): price is Prisma.Decimal => price !== null);

    const categoryChain = detail.categoryChains ?? [];
    const leaf = categoryChain.find((node) => node.isLeaf) ?? categoryChain.at(-1);

    return {
      product: {
        tiktokProductId: detail.id ?? '',
        title: this.truncate(detail.title, 1024),
        description: detail.description ?? null,
        status: this.truncate(detail.status, 40),
        auditStatus: this.truncate(detail.audit?.status, 40),
        tiktokBrandId: this.truncate(detail.brand?.id, 64),
        brandName: this.truncate(detail.brand?.name, 255),
        tiktokCategoryId: this.truncate(leaf?.id, 64),
        categoryName: this.truncate(leaf?.localName, 255),
        // Đường dẫn dựng từ chuỗi danh mục TikTok trả kèm sản phẩm — không phải tra cây.
        categoryPath: this.truncate(
          categoryChain
            .map((node) => node.localName)
            .filter((name): name is string => Boolean(name))
            .join(' > '),
          1024,
        ),
        packageLength: this.truncate(detail.packageDimensions?.length, 32),
        packageWidth: this.truncate(detail.packageDimensions?.width, 32),
        packageHeight: this.truncate(detail.packageDimensions?.height, 32),
        dimensionUnit: this.truncate(detail.packageDimensions?.unit, 16),
        packageWeight: this.truncate(detail.packageWeight?.value, 32),
        weightUnit: this.truncate(detail.packageWeight?.unit, 16),
        isNotForSale: detail.isNotForSale ?? false,
        hasDraft: detail.hasDraft ?? false,
        listingQualityTier: this.truncate(detail.listingQualityTier, 40),
        productTags: detail.productTags ?? null,
        salesRegions: detail.salesRegions ?? null,
        productTypes: detail.productTypes ?? null,
        skuCount: variants.length,
        minPrice: prices.length ? prices.reduce((a, b) => (a.lessThan(b) ? a : b)) : null,
        maxPrice: prices.length ? prices.reduce((a, b) => (a.greaterThan(b) ? a : b)) : null,
        currency: variants.find((variant) => variant.currency)?.currency ?? null,
        totalInventory: variants.reduce((sum, variant) => sum + variant.inventoryTotal, 0),
        tiktokCreateTime: this.toBigInt(detail.createTime),
        tiktokUpdateTime: this.toBigInt(detail.updateTime),
        tiktokCreatedAt: this.unixToDate(detail.createTime),
        tiktokUpdatedAt: this.unixToDate(detail.updateTime),
        payloadHash: this.hash(rawPayload),
      },
      variants,
      images: this.toImages(detail),
      videos: this.toVideos(detail),
      attributes: (detail.productAttributes ?? [])
        .filter((attribute) => Boolean(attribute.id))
        .map((attribute) => ({
          tiktokAttributeId: attribute.id as string,
          name: this.truncate(attribute.name, 255),
          values: attribute.values ?? [],
        })),
    };
  }

  /** Ánh xạ node danh mục (Get Categories) — `path`/`level` do repository dựng sau. */
  toCategoryRow(node: TiktokCategoryNode): {
    tiktokCategoryId: string;
    parentTiktokId: string | null;
    localName: string | null;
    isLeaf: boolean;
    permissionStatuses: Prisma.InputJsonValue | undefined;
  } | null {
    if (!node.id) return null;
    return {
      tiktokCategoryId: node.id,
      // TikTok dùng "0" cho node gốc — quy về NULL để dựng cây bằng một quy tắc duy nhất.
      parentTiktokId: node.parentId && node.parentId !== '0' ? node.parentId : null,
      localName: this.truncate(node.localName, 255),
      isLeaf: node.isLeaf ?? false,
      permissionStatuses: (node.permissionStatuses ?? []) as unknown as Prisma.InputJsonValue,
    };
  }

  /** Ánh xạ định nghĩa thuộc tính của danh mục. */
  toCategoryAttributeRow(attribute: TiktokCategoryAttribute): {
    tiktokAttributeId: string;
    name: string | null;
    type: string | null;
    isRequired: boolean;
    isMultipleSelection: boolean;
    isCustomizable: boolean;
    valueDataFormat: string | null;
    values: Prisma.InputJsonValue | undefined;
  } | null {
    if (!attribute.id) return null;
    return {
      tiktokAttributeId: attribute.id,
      name: this.truncate(attribute.name, 255),
      type: this.truncate(attribute.type, 40),
      // ⚠️ `isRequried` — sai chính tả nằm ở API gốc của TikTok, đọc đúng tên đó mới có dữ liệu.
      isRequired: attribute.isRequried ?? false,
      isMultipleSelection: attribute.isMultipleSelection ?? false,
      isCustomizable: attribute.isCustomizable ?? false,
      valueDataFormat: this.truncate(attribute.valueDataFormat, 40),
      values: (attribute.values ?? []) as unknown as Prisma.InputJsonValue,
    };
  }

  /** sha256 của payload — khoá so sánh "có gì đổi không". */
  hash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? {}))
      .digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toVariant(sku: TiktokProductSku): PodProductVariantWriteData {
    const inventory = sku.inventory ?? [];
    return {
      tiktokSkuId: sku.id ?? '',
      sellerSku: this.truncate(sku.sellerSku, 255),
      externalSkuId: this.truncate(sku.externalSkuId, 255),
      // "Black / L" — ghép theo đúng thứ tự TikTok trả về để khớp với `sku_name` của đơn.
      variantName: this.truncate(
        (sku.salesAttributes ?? [])
          .map((attribute) => attribute.valueName)
          .filter((name): name is string => Boolean(name))
          .join(' / '),
        512,
      ),
      salesAttributes: (sku.salesAttributes ?? []) as unknown as Prisma.InputJsonValue,
      salePrice: this.toDecimal(sku.price?.salePrice),
      listPrice: this.toDecimal(sku.listPrice?.amount),
      taxExclusivePrice: this.toDecimal(sku.price?.taxExclusivePrice),
      currency: this.truncate(sku.price?.currency ?? sku.listPrice?.currency, 10),
      inventoryTotal: inventory.reduce((sum, item) => sum + (item.quantity ?? 0), 0),
      inventory: inventory as unknown as Prisma.InputJsonValue,
      skuWeight: this.truncate(sku.skuWeight?.value, 32),
      weightUnit: this.truncate(sku.skuWeight?.unit, 16),
      skuLength: this.truncate(sku.skuDimensions?.length, 32),
      skuWidth: this.truncate(sku.skuDimensions?.width, 32),
      skuHeight: this.truncate(sku.skuDimensions?.height, 32),
      dimensionUnit: this.truncate(sku.skuDimensions?.unit, 16),
      status: this.truncate(sku.statusInfo?.status, 40),
      imageUrl: this.truncate(
        sku.salesAttributes?.find((attribute) => attribute.skuImg?.urls?.length)?.skuImg?.urls?.[0],
        2048,
      ),
    };
  }

  /** Ảnh chính (thứ tự giữ nguyên) + ảnh riêng của từng SKU. */
  private toImages(detail: TiktokProductDetail): PodProductImageWriteData[] {
    const images: PodProductImageWriteData[] = (detail.mainImages ?? []).map((image, index) => ({
      uri: this.truncate(image.uri, 512),
      url: this.truncate(image.urls?.[0], 2048),
      thumbUrl: this.truncate(image.thumbUrls?.[0], 2048),
      width: image.width ?? null,
      height: image.height ?? null,
      sortOrder: index,
      variantSkuId: null,
    }));

    for (const sku of detail.skus ?? []) {
      for (const attribute of sku.salesAttributes ?? []) {
        const skuImage = attribute.skuImg;
        if (!skuImage || !sku.id) continue;
        images.push({
          uri: this.truncate(skuImage.uri, 512),
          url: this.truncate(skuImage.urls?.[0], 2048),
          thumbUrl: this.truncate(skuImage.thumbUrls?.[0], 2048),
          width: skuImage.width ?? null,
          height: skuImage.height ?? null,
          sortOrder: 0,
          variantSkuId: sku.id,
        });
      }
    }

    return images;
  }

  private toVideos(detail: TiktokProductDetail): PodProductVideoWriteData[] {
    const video = detail.video;
    if (!video || (!video.id && !video.url)) return [];
    return [
      {
        tiktokVideoId: this.truncate(video.id, 128),
        url: this.truncate(video.url, 2048),
        coverUrl: this.truncate(video.coverUrl, 2048),
        format: this.truncate(video.format, 20),
        width: video.width ?? null,
        height: video.height ?? null,
        size: this.toBigInt(video.size),
      },
    ];
  }

  private toDecimal(value?: string | null): Prisma.Decimal | null {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return new Prisma.Decimal(value);
  }

  private toBigInt(value?: number | null): bigint | null {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return BigInt(Math.trunc(num));
  }

  private unixToDate(seconds?: number | null): Date | null {
    const value = this.toBigInt(seconds);
    return value === null ? null : new Date(Number(value) * 1000);
  }

  private truncate(value: string | undefined | null, max: number): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  }
}
