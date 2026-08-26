import { Injectable, Logger } from '@nestjs/common';
import { PodListingPayloadStatus, PodListingReviewStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_REVIEW_MIN_RECHECK_MS,
  POD_REVIEW_PENDING_STATUSES,
  POD_REVIEW_SYNC_BATCH,
  POD_REVIEW_SYNC_CONCURRENCY,
} from '../constants/pod-listing.constants';
import { toReviewSnapshot } from '../mappers/pod-review-status.mapper';
import { PodListingPublisherService } from './pod-listing-publisher.service';
import { runWithConcurrency } from './pod-listing.queue';

/** Kết quả một lượt đọc lại trạng thái duyệt. */
export interface ReviewSyncResult {
  /** Số listing đã hỏi TikTok. */
  checked: number;
  /** Số listing có trạng thái duyệt ĐỔI so với lần trước. */
  changed: number;
  /** Số listing hỏi không được (token hỏng, sản phẩm biến mất, mạng đứt). */
  failed: number;
}

/**
 * PodListingReviewService — **theo dõi trạng thái duyệt** của listing đã publish.
 *
 * ```
 *   pod_listing_payloads (status = PUBLISHED)
 *        ↓ Get Product  (mỗi 5 phút, 5 luồng, ưu tiên cái lâu chưa hỏi nhất)
 *        ↓ status + audit.status → UNDER_REVIEW / APPROVED / REJECTED / ACTIVE / OFFLINE / DELETED
 *        ↓ review_status · review_status_raw · review_reason · review_checked_at
 * ```
 *
 * 🔴 Đây là API **chỉ đọc**. Không sửa gì trên shop — kể cả khi TikTok báo sản phẩm bị từ
 * chối. Sửa nội dung rồi publish lại là quyết định của người vận hành, không phải của một
 * tiến trình nền chạy lúc 3 giờ sáng.
 *
 * 🔴 Không dùng `pod_listing_logs`: bảng đó gắn cứng với một Listing Job, còn một lượt quét
 * trạng thái không thuộc job nào. Nhồi log vào đó là làm hỏng ý nghĩa của cả bảng, và mỗi 5
 * phút lại thêm hàng nghìn dòng cho một thông tin đã nằm sẵn ở `review_status`.
 */
@Injectable()
export class PodListingReviewService {
  private readonly logger = new Logger(PodListingReviewService.name);

  /** Chặn hai lượt quét chồng lên nhau trong cùng tiến trình. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: PodListingPublisherService,
    private readonly productApi: TiktokProductApiService,
  ) {}

  /**
   * Đọc lại trạng thái duyệt cho một lô listing.
   *
   * `organizationId` bỏ trống ⇒ quét TOÀN HỆ THỐNG (đường của scheduler): tenant được lấy từ
   * chính bản ghi listing. Truyền vào ⇒ chỉ tổ chức đó (đường của nút "Đồng bộ" trên màn hình).
   */
  async sync(
    options: {
      organizationId?: string;
      draftIds?: string[];
      limit?: number;
      scope?: PodAccessScope;
    } = {},
  ): Promise<ReviewSyncResult> {
    const now = Date.now();
    const explicit = options.draftIds?.length ? [...new Set(options.draftIds)] : null;

    const where: Prisma.PodListingPayloadWhereInput = {
      deletedAt: null,
      status: PodListingPayloadStatus.PUBLISHED,
      tiktokProductId: { not: null },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      // Scheduler chạy không có người dùng ⇒ không truyền `scope`, quét toàn bộ. Khi lời gọi
      // đến từ một request thì `scope` bắt buộc, và Seller chỉ làm mới được shop của mình.
      ...(!options.scope || options.scope.allShops
        ? {}
        : { shopId: { in: options.scope.shopIds } }),
      ...(explicit
        ? { id: { in: explicit } }
        : {
            // `null` = vừa publish xong, chưa hỏi lần nào ⇒ phải hỏi ngay.
            OR: [
              { reviewStatus: null },
              { reviewStatus: { in: [...POD_REVIEW_PENDING_STATUSES] } },
            ],
            AND: [
              {
                OR: [
                  { reviewCheckedAt: null },
                  { reviewCheckedAt: { lt: new Date(now - POD_REVIEW_MIN_RECHECK_MS) } },
                ],
              },
            ],
          }),
    };

    const drafts = await this.prisma.podListingPayload.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        shopId: true,
        tiktokProductId: true,
        reviewStatus: true,
      },
      // Cái lâu chưa hỏi nhất đi trước — không listing nào bị bỏ quên vĩnh viễn khi lô lớn
      // hơn sức của một tick.
      orderBy: [{ reviewCheckedAt: { sort: 'asc', nulls: 'first' } }],
      take: Math.min(options.limit ?? POD_REVIEW_SYNC_BATCH, POD_REVIEW_SYNC_BATCH),
    });

    if (drafts.length === 0) return { checked: 0, changed: 0, failed: 0 };

    // Token + shop_cipher lấy MỘT lần cho mỗi shop rồi dùng lại cho mọi listing của shop đó.
    const contexts = new Map<string, TiktokShopContext | null>();
    const result: ReviewSyncResult = { checked: 0, changed: 0, failed: 0 };

    await runWithConcurrency(
      drafts.map((draft) => async () => {
        const key = `${draft.organizationId}:${draft.shopId}`;
        if (!contexts.has(key)) {
          contexts.set(
            key,
            await this.publisher
              .shopContext(draft.organizationId, draft.shopId)
              .catch((error: unknown) => {
                this.logger.warn({
                  module: 'pod-listing',
                  operation: 'review.shopContext',
                  organizationId: draft.organizationId,
                  shopId: draft.shopId,
                  msg: error instanceof Error ? error.message : 'Không lấy được token của shop',
                });
                return null;
              }),
          );
        }

        const ctx = contexts.get(key);
        if (!ctx) {
          result.failed += 1;
          // Vẫn đóng dấu thời gian: shop hỏng token thì cả trăm listing của nó không được
          // phép chiếm hết mọi tick cho tới khi ai đó đi kết nối lại.
          await this.stampChecked(draft.id);
          return;
        }

        try {
          const { data } = await this.productApi.getProduct(ctx, draft.tiktokProductId as string);
          const snapshot = toReviewSnapshot(data);
          result.checked += 1;
          if (snapshot.status !== draft.reviewStatus) result.changed += 1;

          await this.prisma.podListingPayload.update({
            where: { id: draft.id },
            data: {
              reviewStatus: snapshot.status,
              reviewStatusRaw: snapshot.raw,
              reviewReason: snapshot.reason,
              reviewCheckedAt: new Date(),
            },
          });
        } catch (error) {
          result.failed += 1;
          await this.stampChecked(draft.id);
          this.logger.warn({
            module: 'pod-listing',
            operation: 'review.getProduct',
            organizationId: draft.organizationId,
            draftId: draft.id,
            tiktokProductId: draft.tiktokProductId,
            msg: error instanceof Error ? error.message : 'Không đọc được trạng thái sản phẩm',
          });
        }
      }),
      POD_REVIEW_SYNC_CONCURRENCY,
    );

    this.logger.log({
      module: 'pod-listing',
      operation: 'review.sync',
      organizationId: options.organizationId ?? '(toàn hệ thống)',
      ...result,
      msg: 'Đã đọc lại trạng thái duyệt của listing đã publish',
    });

    return result;
  }

  /**
   * Một lượt quét theo lịch — không bao giờ ném lỗi ra ngoài và không chạy chồng.
   *
   * Bọc riêng khỏi `sync()` để scheduler chỉ là một lớp mỏng gọi vào đây, đúng khuôn của
   * `PodProductSyncJob` / `PodOrderSyncJob`.
   */
  async tick(): Promise<ReviewSyncResult | null> {
    if (this.running) {
      this.logger.warn({
        module: 'pod-listing',
        operation: 'review.tick',
        msg: 'Lượt đọc trạng thái duyệt trước chưa xong — bỏ qua tick này',
      });
      return null;
    }

    this.running = true;
    try {
      return await this.sync();
    } catch (error) {
      this.logger.error({
        module: 'pod-listing',
        operation: 'review.tick',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định ở tick đọc trạng thái',
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Thống kê trạng thái duyệt cho màn hình Draft Listing (một truy vấn, không tải hết dòng). */
  async summary(organizationId: string, scope: PodAccessScope): Promise<Record<string, number>> {
    const grouped = await this.prisma.podListingPayload.groupBy({
      by: ['reviewStatus'],
      where: {
        organizationId,
        deletedAt: null,
        status: PodListingPayloadStatus.PUBLISHED,
        // 🔴 Thẻ đếm phải đếm ĐÚNG những dòng người dùng thấy trong danh sách. Đếm toàn tổ
        // chức là để lộ quy mô shop của người khác qua một con số.
        ...(scope.allShops ? {} : { shopId: { in: scope.shopIds } }),
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const status of Object.values(PodListingReviewStatus)) counts[status] = 0;
    for (const row of grouped) {
      if (row.reviewStatus) counts[row.reviewStatus] = row._count._all;
    }
    return counts;
  }

  /** Đóng dấu "đã hỏi" mà không đổi trạng thái — dùng khi lời gọi thất bại. */
  private async stampChecked(id: string): Promise<void> {
    await this.prisma.podListingPayload.updateMany({
      where: { id },
      data: { reviewCheckedAt: new Date() },
    });
  }
}
