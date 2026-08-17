import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  PodProductDetailRow,
  PodProductListRow,
} from '../repositories/pod-product.repository';
import type {
  PodProductAttributeDto,
  PodProductDetailDto,
  PodProductListItemDto,
  PodProductSyncHistoryDto,
} from '../dto/pod-product-response.dto';

/** Bản ghi lịch sử kèm quan hệ (đúng shape repository trả về). */
type SyncHistoryRow = Prisma.PodProductSyncHistoryGetPayload<{
  include: {
    account: { select: { id: true; accountName: true } };
    shop: { select: { id: true; name: true } };
  };
}>;

/**
 * PodProductResponseMapper — DB → DTO.
 *
 * Quy tắc: số tiền trả ra dạng **chuỗi** để không mất độ chính xác khi qua JSON
 * (Decimal của Prisma là số thập phân chính xác; `number` của JS thì không).
 */
@Injectable()
export class PodProductResponseMapper {
  toListItem(row: PodProductListRow): PodProductListItemDto {
    return {
      id: row.id,
      tiktokProductId: row.tiktokProductId,
      title: row.title,
      status: row.status,
      auditStatus: row.auditStatus,
      thumbnailUrl: row.images[0]?.thumbUrl ?? row.images[0]?.url ?? null,
      categoryName: row.categoryName,
      brandName: row.brandName,
      skuCount: row.skuCount,
      totalInventory: row.totalInventory,
      minPrice: row.minPrice?.toString() ?? null,
      maxPrice: row.maxPrice?.toString() ?? null,
      currency: row.currency,
      shopName: row.shop?.name ?? null,
      accountName: row.account?.accountName ?? null,
      tiktokUpdatedAt: row.tiktokUpdatedAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  toDetail(row: PodProductDetailRow): PodProductDetailDto {
    return {
      ...this.toListItem({ ...row, images: row.images.filter((image) => !image.variantId) }),
      description: row.description,
      categoryPath: row.categoryPath,
      packageWeight: row.packageWeight,
      weightUnit: row.weightUnit,
      packageDimensions: this.formatDimensions(row),
      productTags: this.toStringArray(row.productTags),
      salesRegions: this.toStringArray(row.salesRegions),
      variants: row.variants.map((variant) => ({
        id: variant.id,
        tiktokSkuId: variant.tiktokSkuId,
        sellerSku: variant.sellerSku,
        variantName: variant.variantName,
        salePrice: variant.salePrice?.toString() ?? null,
        listPrice: variant.listPrice?.toString() ?? null,
        currency: variant.currency,
        inventoryTotal: variant.inventoryTotal,
        status: variant.status,
        imageUrl: variant.imageUrl,
      })),
      images: row.images.map((image) => ({
        id: image.id,
        url: image.url,
        thumbUrl: image.thumbUrl,
        uri: image.uri,
        variantId: image.variantId,
        sortOrder: image.sortOrder,
      })),
      videos: row.videos.map((video) => ({
        id: video.id,
        url: video.url,
        coverUrl: video.coverUrl,
        format: video.format,
      })),
      attributes: row.attributes.map((attribute) => this.toAttribute(attribute)),
    };
  }

  toSyncHistory(row: SyncHistoryRow): PodProductSyncHistoryDto {
    return {
      id: row.id,
      scope: row.scope,
      trigger: row.trigger,
      status: row.status,
      shopName: row.shop?.name ?? null,
      accountName: row.account?.accountName ?? null,
      productsFetched: row.productsFetched,
      productsCreated: row.productsCreated,
      productsUpdated: row.productsUpdated,
      productsSkipped: row.productsSkipped,
      productsFailed: row.productsFailed,
      apiCalls: row.apiCalls,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toAttribute(attribute: {
    id: string;
    tiktokAttributeId: string;
    name: string | null;
    values: Prisma.JsonValue;
  }): PodProductAttributeDto {
    const raw = Array.isArray(attribute.values) ? attribute.values : [];
    return {
      id: attribute.id,
      tiktokAttributeId: attribute.tiktokAttributeId,
      name: attribute.name,
      // JSON từ TikTok là `[{ id, name }]`, nhưng đây là cột Json nên không có bảo đảm
      // kiểu ở tầng DB ⇒ chỉ nhận đúng chuỗi, phần tử lạ bị bỏ qua thay vì in "[object Object]".
      values: raw
        .map((value) => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object' && 'name' in value) {
            const name = (value as { name?: unknown }).name;
            return typeof name === 'string' ? name : '';
          }
          return '';
        })
        .filter((value) => value !== ''),
    };
  }

  /** "20 x 15 x 5 cm" — gộp để UI không phải ghép chuỗi. */
  private formatDimensions(row: PodProductDetailRow): string | null {
    const parts = [row.packageLength, row.packageWidth, row.packageHeight].filter(
      (part): part is string => Boolean(part),
    );
    if (parts.length === 0) return null;
    return `${parts.join(' x ')}${row.dimensionUnit ? ` ${row.dimensionUnit}` : ''}`;
  }

  private toStringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) return [];
    // Chỉ giữ phần tử chuỗi — cột Json không bảo đảm kiểu, không ép kiểu bừa.
    return value.filter((item): item is string => typeof item === 'string' && item !== '');
  }
}
