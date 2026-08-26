import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PodOrderItemDto,
  PodOrderListItemDto,
  PodOrderResponseDto,
  PodSyncLogDto,
} from '../dto/pod-order-response.dto';
import { StorageMapper } from '../../storage/storage.mapper';
import type { ResolvedItemDesigns } from '../services/pod-order-design-resolver.service';
import { PodOrderWithRelations } from '../types/pod-order-with-relations.type';

/** Dòng nhật ký kèm quan hệ shop/account (khớp include của repository). */
type SyncLogRow = Prisma.PodSyncLogGetPayload<{
  include: {
    shop: { select: { id: true; name: true } };
    account: { select: { id: true; accountName: true } };
  };
}>;

/**
 * PodOrderResponseMapper — Entity → Response DTO.
 *
 * Nguyên tắc bảo mật: KHÔNG trả `recipientEnc` (PII đã mã hoá) hay `rawPayload`
 * ra API danh sách/chi tiết thông thường; chỉ trả cờ `recipientMasked` + vùng/mã bưu chính.
 */
@Injectable()
export class PodOrderResponseMapper {
  constructor(private readonly storage: StorageMapper) {}

  toResponse(
    order: PodOrderWithRelations,
    designs: Map<string, ResolvedItemDesigns>,
  ): PodOrderResponseDto {
    return {
      id: order.id,
      tiktokOrderId: order.tiktokOrderId,
      status: order.status,

      shop: {
        id: order.shop.id,
        name: order.shop.name,
        tiktokShopId: order.shop.tiktokShopId,
        region: order.shop.region,
      },
      accountName: order.account.accountName,
      fulfillmentAccountId: order.account.fulfillmentAccountId,
      // Seller lấy từ account tại thời điểm ĐỌC — luôn phản ánh người phụ trách hiện tại.
      sellerId: order.account.sellerId,
      sellerFullName: order.account.seller?.user.fullName ?? null,
      sellerEmail: order.account.seller?.user.email ?? null,

      buyerEmail: order.buyerEmail,
      buyerNickname: order.buyerNickname,
      buyerMessage: order.buyerMessage,
      sellerNote: order.sellerNote,

      currency: order.currency,
      totalAmount: this.toNumber(order.totalAmount),
      subTotal: this.toNumber(order.subTotal),
      shippingFee: this.toNumber(order.shippingFee),
      tax: this.toNumber(order.tax),
      sellerDiscount: this.toNumber(order.sellerDiscount),
      platformDiscount: this.toNumber(order.platformDiscount),

      fulfillmentType: order.fulfillmentType,
      shippingType: order.shippingType,
      trackingNumber: order.trackingNumber,
      shippingProvider: order.shippingProvider,
      cancelReason: order.cancelReason,
      cancellationInitiator: order.cancellationInitiator,
      isBuyerRequestCancel: order.isBuyerRequestCancel,

      orderType: order.orderType,
      isOnHoldOrder: order.isOnHoldOrder,
      hasPodItem: order.hasPodItem,

      recipientMasked: order.recipientMasked,
      recipientRegionCode: order.recipientRegionCode,
      recipientPostalCode: order.recipientPostalCode,

      orderedAt: order.orderedAt.toISOString(),
      tiktokUpdatedAt: order.tiktokUpdatedAt.toISOString(),
      paidTime: this.unixToIso(order.paidTime),
      rtsSlaTime: this.unixToIso(order.rtsSlaTime),
      lastSyncedAt: order.lastSyncedAt.toISOString(),
      syncVersion: order.syncVersion,

      items: order.items.map((item) => this.toItemDto(item, designs)),
      packages: order.packages.map((pkg) => ({
        id: pkg.id,
        tiktokPackageId: pkg.tiktokPackageId,
      })),

      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  toListItem(
    order: PodOrderWithRelations,
    designs: Map<string, ResolvedItemDesigns>,
  ): PodOrderListItemDto {
    return {
      id: order.id,
      tiktokOrderId: order.tiktokOrderId,
      shopName: order.shop.name,
      // Nhà cung cấp của kết nối TikTok — giao diện cần để mở dialog "Map Product" với nhà
      // cung cấp điền sẵn. Đã nằm sẵn trong include, không phát sinh truy vấn.
      fulfillmentAccountId: order.account.fulfillmentAccountId,
      // Seller lấy từ account tại thời điểm ĐỌC — đổi người phụ trách là danh sách đổi theo ngay.
      sellerId: order.account.sellerId,
      sellerFullName: order.account.seller?.user.fullName ?? null,
      sellerEmail: order.account.seller?.user.email ?? null,
      // Ưu tiên nickname; email của TikTok là địa chỉ ẩn danh nên chỉ dùng khi thiếu nickname.
      buyer: order.buyerNickname ?? order.buyerEmail,
      status: order.status,
      totalAmount: this.toNumber(order.totalAmount),
      currency: order.currency,
      orderType: order.orderType,
      hasPodItem: order.hasPodItem,
      itemCount: order.items.length,
      trackingNumber: order.trackingNumber,
      createdTime: order.orderedAt.toISOString(),
      updatedTime: order.tiktokUpdatedAt.toISOString(),
      lastSync: order.lastSyncedAt.toISOString(),
      // Sản phẩm đi kèm ngay ở danh sách (đã nạp sẵn qua include — không phát sinh N+1).
      items: order.items.map((item) => this.toItemDto(item, designs)),
    };
  }

  toSyncLogDto(log: SyncLogRow): PodSyncLogDto {
    return {
      id: log.id,
      shopId: log.shopId,
      shopName: log.shop?.name ?? null,
      accountName: log.account?.accountName ?? null,
      trigger: log.trigger,
      status: log.status,
      phase: log.phase,
      startTime: log.startedAt.toISOString(),
      endTime: log.finishedAt?.toISOString() ?? null,
      durationMs: log.durationMs,
      totalOrders: log.totalOrders,
      tiktokTotalCount: log.tiktokTotalCount,
      created: log.createdCount,
      updated: log.updatedCount,
      skipped: log.skippedCount,
      failed: log.failedCount,
      pagesFetched: log.pagesFetched,
      apiCalls: log.apiCalls,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      tiktokRequestId: log.tiktokRequestId,
    };
  }

  /**
   * 🔴 `designs` được TRUYỀN VÀO, không đọc từ `item.designs`.
   *
   * Design nay thuộc **Product Mapping** (một file dùng cho mọi đơn cùng SKU), nên chỉ
   * `PodOrderDesignResolver` mới biết ghép. Bắt buộc truyền tham số để không ai vô tình
   * quay lại đọc quan hệ cũ trên line item.
   */
  private toItemDto(
    item: PodOrderWithRelations['items'][number],
    designs: Map<string, ResolvedItemDesigns>,
  ): PodOrderItemDto {
    const resolved = designs.get(item.id);
    return {
      id: item.id,
      tiktokLineItemId: item.tiktokLineItemId,
      productId: item.productId,
      productName: item.productName,
      skuId: item.skuId,
      skuName: item.skuName,
      sellerSku: item.sellerSku,
      skuImage: item.skuImage,
      // TikTok trả 1 line item = 1 đơn vị sản phẩm (xem Order API overview).
      quantity: 1,
      productCategory: item.productCategory,
      designs: resolved?.designs ?? [],
      mappingId: resolved?.mappingId ?? null,
      // Không có kết quả rà nào cho line item (vd sản phẩm thiếu khoá) ⇒ MISSING: với người
      // dùng vẫn là "phải khai tay", đúng việc cần làm.
      mappingStatus: resolved?.mappingStatus ?? 'MISSING',
      mappingCandidates: resolved?.candidates ?? [],
      salePrice: this.toNumber(item.salePrice),
      originalPrice: this.toNumber(item.originalPrice),
      currency: item.currency,
      displayStatus: item.displayStatus,
      packageStatus: item.packageStatus,
      packageId: item.packageId,
      trackingNumber: item.trackingNumber,
      shippingProviderName: item.shippingProviderName,
      cancelReason: item.cancelReason,
      isPodCustomized: item.isPodCustomized,
      podInfoId: item.podInfoId,
      isGift: item.isGift,
    };
  }

  /** Decimal (Prisma) → number cho JSON. Giữ null để phân biệt "không có" với 0. */
  private toNumber(value: Prisma.Decimal | null): number | null {
    return value === null ? null : Number(value);
  }

  /** Unix seconds (bigint) → ISO string. */
  private unixToIso(value: bigint | null): string | null {
    return value === null ? null : new Date(Number(value) * 1000).toISOString();
  }
}
