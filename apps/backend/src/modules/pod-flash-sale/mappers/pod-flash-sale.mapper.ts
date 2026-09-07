import { Prisma, PodFlashSaleItemStatus } from '@prisma/client';
import {
  FLASH_SALE_CANCELLABLE_STATUSES,
  FLASH_SALE_EDITABLE_STATUSES,
  FLASH_SALE_LIVE_STATUSES,
  FLASH_SALE_PUBLISHABLE_STATUSES,
} from '../constants/pod-flash-sale.constants';
import type {
  PodFlashSaleItemCountsDto,
  PodFlashSaleItemDto,
  PodFlashSaleListItemDto,
  PodFlashSaleLogDto,
  PodFlashSaleTemplateDto,
} from '../dto/pod-flash-sale-response.dto';
import { parseTemplateConfig } from '../types/pod-flash-sale-template-config.type';

/**
 * Ánh xạ bản ghi Prisma → hình dạng API.
 *
 * 🔴 Đây là ranh giới duy nhất giữa lược đồ database và hợp đồng API: đổi tên cột không
 * được làm gãy frontend, và ngược lại. Mọi `Decimal` ra khỏi đây đều là chuỗi (xem chú
 * thích ở `pod-flash-sale-response.dto.ts`), mọi `Date` đều là ISO-8601.
 */

/** `include` chuẩn cho màn hình danh sách — vừa đủ vẽ một dòng, không hơn. */
export const FLASH_SALE_LIST_INCLUDE = {
  shop: { select: { id: true, name: true, region: true } },
  account: { select: { id: true, accountName: true } },
  creator: { select: { id: true, fullName: true } },
} satisfies Prisma.PodFlashSaleInclude;

/** `include` cho màn hình chi tiết — thêm dòng sản phẩm kèm ảnh. */
export const FLASH_SALE_DETAIL_INCLUDE = {
  ...FLASH_SALE_LIST_INCLUDE,
  items: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      product: {
        select: {
          id: true,
          title: true,
          tiktokProductId: true,
          // Ảnh CHÍNH của sản phẩm (`variantId = null`), lấy đúng một tấm đầu tiên —
          // bảng chỉ hiển thị một thumbnail nên kéo cả bộ ảnh về là lãng phí thuần tuý.
          images: {
            where: { variantId: null },
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true, thumbUrl: true },
          },
        },
      },
      variant: {
        select: {
          id: true,
          variantName: true,
          sellerSku: true,
          tiktokSkuId: true,
          imageUrl: true,
        },
      },
    },
  },
} satisfies Prisma.PodFlashSaleInclude;

export type FlashSaleListRow = Prisma.PodFlashSaleGetPayload<{
  include: typeof FLASH_SALE_LIST_INCLUDE;
}>;
export type FlashSaleDetailRow = Prisma.PodFlashSaleGetPayload<{
  include: typeof FLASH_SALE_DETAIL_INCLUDE;
}>;
export type FlashSaleItemRow = FlashSaleDetailRow['items'][number];

export type FlashSaleTemplateRow = Prisma.PodFlashSaleTemplateGetPayload<{
  include: { shop: { select: { id: true; name: true; region: true } } };
}>;

export type FlashSaleLogRow = Prisma.PodFlashSaleLogGetPayload<Record<string, never>>;

/** `Date` → ISO-8601. `null` giữ nguyên `null` (cột thời gian của module này đều nullable). */
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toFlashSaleListItem(row: FlashSaleListRow): PodFlashSaleListItemDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    productLevel: row.productLevel,
    provider: row.provider,
    providerFlashSaleId: row.providerFlashSaleId,
    providerStatus: row.providerStatus,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    timezone: row.timezone,
    itemCount: row.itemCount,
    shop: { id: row.shop.id, name: row.shop.name, region: row.shop.region },
    accountId: row.accountId,
    accountName: row.account?.accountName ?? null,
    createdByUser: row.creator ? { id: row.creator.id, fullName: row.creator.fullName } : null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    retryCount: row.retryCount,
    publishedAt: iso(row.publishedAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    live: FLASH_SALE_LIVE_STATUSES.includes(row.status),
  };
}

export function toFlashSaleItem(row: FlashSaleItemRow): PodFlashSaleItemDto {
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    productTitle: row.product?.title ?? null,
    variantName: row.variant?.variantName ?? null,
    // Ảnh biến thể trước, ảnh sản phẩm sau: bảng Flash Sale hiển thị theo dòng, và một dòng
    // SKU "Black / L" mà hiện ảnh áo trắng thì người dùng không đối chiếu được.
    imageUrl: row.variant?.imageUrl ?? row.product?.images?.[0]?.thumbUrl ?? row.product?.images?.[0]?.url ?? null,
    skuId: row.skuId,
    providerProductId: row.providerProductId,
    providerVariantId: row.providerVariantId,
    providerSkuId: row.providerSkuId,
    originalPrice: row.originalPrice.toString(),
    flashSalePrice: row.flashSalePrice.toString(),
    discountPercent: row.discountPercent.toString(),
    currency: row.currency,
    totalPurchaseLimit: row.totalPurchaseLimit,
    customerPurchaseLimit: row.customerPurchaseLimit,
    status: row.status,
    errorCode: row.errorCode,
    error: row.error,
    sortOrder: row.sortOrder,
  };
}

/** Đếm dòng theo trạng thái — luôn trả đủ mọi khoá, kể cả khoá bằng 0. */
export function countItems(items: Array<{ status: PodFlashSaleItemStatus }>): PodFlashSaleItemCountsDto {
  const counts: PodFlashSaleItemCountsDto = {
    TOTAL: items.length,
    PENDING: 0,
    READY: 0,
    PUBLISHED: 0,
    FAILED: 0,
    REMOVED: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function isEditable(status: FlashSaleListRow['status']): boolean {
  return FLASH_SALE_EDITABLE_STATUSES.includes(status);
}

export function isPublishable(status: FlashSaleListRow['status']): boolean {
  return FLASH_SALE_PUBLISHABLE_STATUSES.includes(status);
}

export function isCancellable(status: FlashSaleListRow['status']): boolean {
  return FLASH_SALE_CANCELLABLE_STATUSES.includes(status);
}

export function toFlashSaleLog(row: FlashSaleLogRow): PodFlashSaleLogDto {
  return {
    id: row.id,
    action: row.action,
    level: row.level,
    message: row.message,
    request: row.request ?? null,
    response: row.response ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestId: row.requestId,
    attempt: row.attempt,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFlashSaleTemplate(row: FlashSaleTemplateRow): PodFlashSaleTemplateDto {
  const config = parseTemplateConfig(row.config);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    accountId: row.accountId,
    shop: { id: row.shop.id, name: row.shop.name, region: row.shop.region },
    productLevel: config.productLevel,
    itemCount: config.items.length,
    items: config.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      skuId: item.skuId,
      providerProductId: item.providerProductId,
      providerVariantId: item.providerVariantId,
      productTitle: item.productTitle,
      variantName: item.variantName,
      flashSalePrice: item.flashSalePrice,
      discountPercent: item.discountPercent,
      totalPurchaseLimit: item.totalPurchaseLimit,
      customerPurchaseLimit: item.customerPurchaseLimit,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
