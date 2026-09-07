import { Injectable, Logger } from '@nestjs/common';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  PodTiktokShopContextException,
  PodTiktokShopContextService,
} from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokPromotionApiService } from '../../tiktok-sdk/tiktok-promotion-api.service';
import {
  TIKTOK_ACTIVITY_COMMAND_IMMUTABLE,
  TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL,
  TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
  TIKTOK_ACTIVITY_PRODUCT_LEVEL,
  TIKTOK_ACTIVITY_TYPE,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type {
  TiktokActivityDetail,
  TiktokActivityProductInput,
} from '../../tiktok-sdk/types/tiktok-promotion.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  FLASH_SALE_CANCELLABLE_STATUSES,
  FLASH_SALE_PUBLISHABLE_STATUSES,
  FLASH_SALE_UNLIMITED,
  TIKTOK_TO_FLASH_SALE_STATUS,
} from '../constants/pod-flash-sale.constants';
import type { PodFlashSalePublishResultDto } from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleInvalidStateException,
  PodFlashSaleNotPublishableException,
  PodFlashSaleProviderException,
  PodFlashSaleShopContextException,
} from '../exceptions/pod-flash-sale.exceptions';
import type { FlashSaleDetailRow, FlashSaleItemRow } from '../mappers/pod-flash-sale.mapper';
import { formatPriceForProvider } from './pod-flash-sale-pricing';
import { PodFlashSaleService } from './pod-flash-sale.service';

/** Lỗi đã bóc tách thành ba mảnh mà mọi nơi trong module đều cần. */
interface ProviderFailure {
  code: string | null;
  message: string;
  requestId: string | null;
}

/**
 * PodFlashSalePublisherService — **cửa duy nhất** giữa module Flash Sale và TikTok.
 *
 * ```
 *   Publish ──▶ Create Activity ──▶ Update Activity Products ──▶ RUNNING
 *      │              (hoặc Update Activity nếu đã có activity_id)
 *      └──▶ lỗi ──▶ FAILED (giữ nguyên dữ liệu) ──▶ Retry đi lại đúng đường trên
 *
 *   Cancel  ──▶ Deactivate Activity ──▶ CANCELLED
 *   Sync    ──▶ Get Activity ──▶ ánh xạ trạng thái sàn về trạng thái hệ thống
 * ```
 *
 * Ba nguyên tắc:
 *
 * 🔴 **Không có nghiệp vụ nào khác gọi TikTok.** Màn hình danh sách, chi tiết, thêm sản
 * phẩm, đổi giá đều chỉ đọc/ghi database. Nhờ vậy quota TikTok chỉ bị tiêu khi thực sự có
 * hàng cần đẩy.
 *
 * 🔴 **Mọi lượt gọi để lại vết.** Request đã gửi, response nhận về, mã lỗi và `request_id`
 * đều ghi vào `pod_flash_sale_logs` — đó là dữ liệu của tab History và là thứ duy nhất mở
 * ticket với TikTok dùng được.
 *
 * 🔴 **Thất bại KHÔNG xoá gì.** Đợt sale chuyển sang `FAILED` với toàn bộ sản phẩm, giá và
 * giới hạn còn nguyên; Retry chạy lại đúng đường cũ. `activity_id` đã cấp cũng được giữ để
 * lần thử sau đi nhánh Update thay vì tạo thêm một hoạt động mồ côi trên shop.
 */
@Injectable()
export class PodFlashSalePublisherService {
  private readonly logger = new Logger(PodFlashSalePublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSales: PodFlashSaleService,
    private readonly promotionApi: TiktokPromotionApiService,
    private readonly shopContext: PodTiktokShopContextService,
  ) {}

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Đẩy một đợt sale lên TikTok.
   *
   * `skipInvalidItems = false` (mặc định): còn một dòng sai là dừng cả lượt. Cố ý — publish
   * "một phần" mà không nói gì là cách để một nửa danh mục im lặng không lên sale.
   */
  async publish(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    options: { skipInvalidItems?: boolean },
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);

    if (!FLASH_SALE_PUBLISHABLE_STATUSES.includes(flashSale.status)) {
      throw new PodFlashSaleInvalidStateException('publish Flash Sale', flashSale.status);
    }

    const validation = this.flashSales.validateRow(flashSale);
    const skipInvalid = options.skipInvalidItems === true;
    if (!validation.ok && !skipInvalid) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId,
        action: PodFlashSaleLogAction.VALIDATE,
        level: PodFlashSaleLogLevel.ERROR,
        message: `Publish bị chặn: ${validation.issues.length} vấn đề cần xử lý.`,
        response: validation.issues as unknown as Prisma.InputJsonValue,
        userId,
      });
      throw new PodFlashSaleNotPublishableException(validation.issues);
    }

    // Lỗi ở PHẦN ĐẦU (tên, khung giờ) không phải lỗi của một dòng nào — `skipInvalidItems`
    // không cứu được, vì hoạt động sẽ bị TikTok từ chối ngay ở bước Create.
    const headerIssues = validation.issues.filter(
      (issue) => issue.level === 'ERROR' && !issue.itemId,
    );
    if (headerIssues.length > 0) throw new PodFlashSaleNotPublishableException(headerIssues);

    const publishable = this.selectPublishableItems(flashSale, validation);
    const skippedItems = flashSale.items.filter(
      (item) => item.status !== PodFlashSaleItemStatus.REMOVED && !publishable.includes(item),
    ).length;

    // Mốc bắt đầu lượt: `PUBLISHING` là tín hiệu cho giao diện tự làm mới 30 giây/lần và
    // cho scheduler biết đợt này đang có việc dở dang nếu tiến trình chết giữa chừng.
    const attempt = flashSale.retryCount;
    await this.prisma.podFlashSale.update({
      where: { id: flashSaleId },
      data: { status: PodFlashSaleStatus.PUBLISHING, updatedBy: userId },
    });

    try {
      const context = await this.resolveContext(organizationId, flashSale.shopId);
      const activityId = await this.ensureActivity(context, flashSale, userId, attempt);
      const acceptedSkuIds = await this.pushProducts(
        context,
        flashSale,
        activityId,
        publishable,
        userId,
        attempt,
      );

      await this.markPublished(flashSale, activityId, publishable, acceptedSkuIds, userId);

      this.logger.log({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish',
        organizationId,
        flashSaleId,
        activityId,
        items: publishable.length,
        skipped: skippedItems,
        msg: 'Đã đẩy Flash Sale lên TikTok',
      });

      return {
        flashSaleId,
        status: PodFlashSaleStatus.RUNNING,
        providerFlashSaleId: activityId,
        publishedItems: publishable.length,
        skippedItems,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      const failure = this.describeFailure(error);
      await this.markFailed(flashSale, failure, userId);

      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish',
        organizationId,
        flashSaleId,
        errorCode: failure.code,
        requestId: failure.requestId,
        msg: `Publish Flash Sale thất bại: ${failure.message}`,
      });

      // Ném tiếp để người bấm nút thấy lỗi ngay. Trạng thái FAILED đã lưu, nên kể cả khi
      // response không tới được trình duyệt thì màn hình vẫn hiển thị đúng ở lần tải sau.
      throw new PodFlashSaleProviderException(failure.code, failure.message, failure.requestId ?? undefined);
    }
  }

  /**
   * Retry Publish — đi lại đúng đường của `publish`, chỉ khác ở chỗ đếm số lần thử.
   *
   * 🔴 Không viết một đường publish thứ hai cho retry: hai đường sẽ trôi dạt và "chạy lại"
   * sẽ không còn giống "chạy lần đầu".
   */
  async retry(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    options: { skipInvalidItems?: boolean },
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (flashSale.status !== PodFlashSaleStatus.FAILED) {
      throw new PodFlashSaleInvalidStateException('retry publish', flashSale.status);
    }

    await this.prisma.podFlashSale.update({
      where: { id: flashSaleId },
      data: { retryCount: { increment: 1 }, updatedBy: userId },
    });

    return this.publish(organizationId, userId, flashSaleId, options, scope);
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Huỷ một đợt sale.
   *
   * Đã lên sàn ⇒ gọi Deactivate trước rồi mới đổi trạng thái nội bộ. Đổi trạng thái trước
   * là cách tạo ra đúng thứ tệ nhất: hệ thống nói "đã huỷ" trong khi khuyến mãi vẫn chạy
   * trên shop thật.
   */
  async cancel(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (!FLASH_SALE_CANCELLABLE_STATUSES.includes(flashSale.status)) {
      throw new PodFlashSaleInvalidStateException('huỷ Flash Sale', flashSale.status);
    }

    if (flashSale.providerFlashSaleId) {
      try {
        const context = await this.resolveContext(organizationId, flashSale.shopId);
        const result = await this.promotionApi.deactivateActivity(
          context,
          flashSale.providerFlashSaleId,
        );
        await this.flashSales.writeLog({
          organizationId,
          flashSaleId,
          action: PodFlashSaleLogAction.DEACTIVATE,
          message: 'Đã gửi yêu cầu huỷ hoạt động khuyến mãi tới TikTok.',
          request: { activityId: flashSale.providerFlashSaleId },
          response: result.data,
          requestId: result.requestId ?? null,
          userId,
        });
      } catch (error) {
        const failure = this.describeFailure(error);
        await this.flashSales.writeLog({
          organizationId,
          flashSaleId,
          action: PodFlashSaleLogAction.DEACTIVATE,
          level: PodFlashSaleLogLevel.ERROR,
          message: 'Huỷ hoạt động khuyến mãi trên TikTok thất bại.',
          request: { activityId: flashSale.providerFlashSaleId },
          errorCode: failure.code,
          errorMessage: failure.message,
          requestId: failure.requestId,
          userId,
        });
        throw new PodFlashSaleProviderException(failure.code, failure.message, failure.requestId ?? undefined);
      }
    }

    await this.prisma.podFlashSale.update({
      where: { id: flashSaleId },
      data: { status: PodFlashSaleStatus.CANCELLED, updatedBy: userId },
    });

    return {
      flashSaleId,
      status: PodFlashSaleStatus.CANCELLED,
      providerFlashSaleId: flashSale.providerFlashSaleId,
      publishedItems: 0,
      skippedItems: 0,
      errorCode: null,
      errorMessage: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Sync trạng thái
  // ---------------------------------------------------------------------------

  /**
   * Đọc lại trạng thái một đợt sale từ TikTok và ghi về database.
   *
   * Dùng bởi scheduler và bởi nút "Refresh" ở màn hình chi tiết. Đợt chưa từng lên sàn thì
   * không có gì để hỏi — trả về nguyên trạng.
   */
  async syncStatus(flashSale: {
    id: string;
    organizationId: string;
    shopId: string;
    providerFlashSaleId: string | null;
    status: PodFlashSaleStatus;
    endAt: Date;
  }): Promise<PodFlashSaleStatus> {
    if (!flashSale.providerFlashSaleId) return flashSale.status;

    try {
      const context = await this.resolveContext(flashSale.organizationId, flashSale.shopId);
      const result = await this.promotionApi.getActivity(context, flashSale.providerFlashSaleId);
      const next = this.mapProviderStatus(result.data, flashSale.endAt);

      await this.prisma.podFlashSale.update({
        where: { id: flashSale.id },
        data: {
          status: next,
          providerStatus: result.data.status ?? null,
          lastSyncedAt: new Date(),
          // Đồng bộ thành công ⇒ lỗi cũ không còn mô tả hiện trạng nữa.
          ...(next === PodFlashSaleStatus.FAILED
            ? {}
            : { lastErrorCode: null, lastErrorMessage: null, lastErrorRequestId: null }),
        },
      });

      await this.syncItemConfirmations(flashSale.id, result.data);

      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.SYNC_STATUS,
        message: `Trạng thái TikTok: ${result.data.status ?? 'không rõ'} ⇒ ${next}.`,
        response: result.data as unknown as Prisma.InputJsonValue,
        requestId: result.requestId ?? null,
      });

      return next;
    } catch (error) {
      const failure = this.describeFailure(error);
      // 🔴 KHÔNG đổi trạng thái đợt sale khi chỉ mỗi lượt ĐỌC thất bại. Mạng chập một nhịp
      // không có nghĩa là khuyến mãi trên sàn đã hỏng; đánh dấu FAILED ở đây sẽ khiến người
      // vận hành đi huỷ một đợt đang chạy bình thường.
      await this.prisma.podFlashSale.update({
        where: { id: flashSale.id },
        data: { lastSyncedAt: new Date() },
      });
      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.SYNC_STATUS,
        level: PodFlashSaleLogLevel.WARN,
        message: 'Không đọc được trạng thái hoạt động khuyến mãi từ TikTok.',
        errorCode: failure.code,
        errorMessage: failure.message,
        requestId: failure.requestId,
      });
      return flashSale.status;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — các bước của một lượt publish
  // ---------------------------------------------------------------------------

  private async resolveContext(organizationId: string, shopId: string): Promise<TiktokShopContext> {
    try {
      return await this.shopContext.resolve(organizationId, shopId);
    } catch (error) {
      if (error instanceof PodTiktokShopContextException) {
        throw new PodFlashSaleShopContextException(error.message);
      }
      throw error;
    }
  }

  /**
   * Bảo đảm có `activity_id`: tạo mới, hoặc cập nhật tên/giờ của hoạt động đã có.
   *
   * 🔴 Đợt sale đã từng lên sàn thì KHÔNG tạo hoạt động thứ hai — nếu không, mỗi lần Retry
   * lại đẻ thêm một khuyến mãi mồ côi trên shop thật mà không ai gỡ.
   */
  private async ensureActivity(
    context: TiktokShopContext,
    flashSale: FlashSaleDetailRow,
    userId: string,
    attempt: number,
  ): Promise<string> {
    const beginTime = Math.floor(flashSale.startAt.getTime() / 1_000);
    const endTime = Math.floor(flashSale.endAt.getTime() / 1_000);
    const productLevel =
      flashSale.productLevel === PodFlashSaleProductLevel.PRODUCT
        ? TIKTOK_ACTIVITY_PRODUCT_LEVEL.PRODUCT
        : TIKTOK_ACTIVITY_PRODUCT_LEVEL.VARIATION;

    if (flashSale.providerFlashSaleId) {
      const request = { title: flashSale.name, productLevel, beginTime, endTime };
      const result = await this.promotionApi.updateActivity(
        context,
        flashSale.providerFlashSaleId,
        request,
      );
      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.UPDATE_ACTIVITY,
        message: 'Đã cập nhật tên và khung giờ của hoạt động khuyến mãi.',
        request: { activityId: flashSale.providerFlashSaleId, ...request },
        response: result.data as unknown as Prisma.InputJsonValue,
        requestId: result.requestId ?? null,
        attempt,
        userId,
      });
      return flashSale.providerFlashSaleId;
    }

    const request = {
      title: flashSale.name,
      activityType: TIKTOK_ACTIVITY_TYPE.FLASHSALE,
      productLevel,
      beginTime,
      endTime,
    };
    const result = await this.promotionApi.createActivity(context, request);

    // Ghi `activity_id` NGAY, trước khi gắn sản phẩm. Tiến trình chết ở bước sau thì lần
    // Retry vẫn tìm lại được hoạt động đã tạo thay vì tạo một cái mới.
    await this.prisma.podFlashSale.update({
      where: { id: flashSale.id },
      data: { providerFlashSaleId: result.data.activityId, providerStatus: result.data.status ?? null },
    });

    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.CREATE_ACTIVITY,
      message: `Đã tạo hoạt động khuyến mãi ${result.data.activityId} trên TikTok.`,
      request,
      response: result.data as unknown as Prisma.InputJsonValue,
      requestId: result.requestId ?? null,
      attempt,
      userId,
    });

    return result.data.activityId;
  }

  /** Gắn sản phẩm + giá deal + giới hạn mua, chia lô theo trần của TikTok. */
  private async pushProducts(
    context: TiktokShopContext,
    flashSale: FlashSaleDetailRow,
    activityId: string,
    items: FlashSaleItemRow[],
    userId: string,
    attempt: number,
  ): Promise<Map<string, string>> {
    const payload = this.buildProductPayload(flashSale.productLevel, items);
    const acceptedSkuIds = new Map<string, string>();

    for (const batch of this.chunkProducts(payload)) {
      const result = await this.promotionApi.updateActivityProducts(context, activityId, batch);

      for (const product of result.data.products ?? []) {
        for (const sku of product.skus ?? []) {
          if (sku.id) acceptedSkuIds.set(sku.id, sku.id);
        }
      }

      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
        message: `Đã gửi ${batch.length} sản phẩm vào hoạt động khuyến mãi.`,
        request: { activityId, products: batch } as unknown as Prisma.InputJsonValue,
        response: result.data as unknown as Prisma.InputJsonValue,
        requestId: result.requestId ?? null,
        attempt,
        userId,
      });
    }

    return acceptedSkuIds;
  }

  /**
   * Dòng trong database ⇒ payload của TikTok.
   *
   * Hai mức hai hình dạng khác hẳn nhau:
   *  - `PRODUCT`: giá + giới hạn đặt ở SPU, `skus` bắt buộc là `[]`.
   *  - `VARIATION`: giá + giới hạn đặt ở từng SKU, còn ở mức SPU **bắt buộc** là `-1` —
   *    TikTok từ chối cả request nếu gửi số khác.
   */
  private buildProductPayload(
    productLevel: PodFlashSaleProductLevel,
    items: FlashSaleItemRow[],
  ): TiktokActivityProductInput[] {
    if (productLevel === PodFlashSaleProductLevel.PRODUCT) {
      return items
        .filter((item) => item.providerProductId)
        .map((item) => ({
          id: item.providerProductId as string,
          activityPriceAmount: formatPriceForProvider(item.flashSalePrice),
          quantityLimit: item.totalPurchaseLimit,
          quantityPerUser: item.customerPurchaseLimit,
          skus: [],
        }));
    }

    // Gộp các dòng SKU về đúng sản phẩm cha — TikTok nhận một mục cho mỗi `product_id`.
    const byProduct = new Map<string, TiktokActivityProductInput>();
    for (const item of items) {
      if (!item.providerProductId || !item.providerVariantId) continue;

      const product = byProduct.get(item.providerProductId) ?? {
        id: item.providerProductId,
        quantityLimit: FLASH_SALE_UNLIMITED,
        quantityPerUser: FLASH_SALE_UNLIMITED,
        skus: [],
      };
      product.skus.push({
        id: item.providerVariantId,
        activityPriceAmount: formatPriceForProvider(item.flashSalePrice),
        quantityLimit: item.totalPurchaseLimit,
        quantityPerUser: item.customerPurchaseLimit,
      });
      byProduct.set(item.providerProductId, product);
    }
    return [...byProduct.values()];
  }

  /**
   * Chia lô theo HAI trần cùng lúc: ≤ 300 sản phẩm **và** ≤ 300 SKU cho mỗi lần gọi.
   *
   * 🔴 Chỉ đếm sản phẩm là chưa đủ: 50 sản phẩm × 10 SKU đã là 500 SKU và bị TikTok từ chối
   * dù mới có 50 mục. Một sản phẩm có nhiều hơn 300 SKU thì không lô nào chứa nổi — trường
   * hợp đó vượt giới hạn của chính TikTok, để nguyên cho sàn trả lỗi có mã rõ ràng.
   */
  private chunkProducts(products: TiktokActivityProductInput[]): TiktokActivityProductInput[][] {
    const batches: TiktokActivityProductInput[][] = [];
    let current: TiktokActivityProductInput[] = [];
    let skuCount = 0;

    for (const product of products) {
      const productSkus = Math.max(product.skus.length, 1);
      const wouldExceed =
        current.length + 1 > TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL ||
        skuCount + productSkus > TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL;

      if (wouldExceed && current.length > 0) {
        batches.push(current);
        current = [];
        skuCount = 0;
      }

      current.push(product);
      skuCount += productSkus;
    }

    if (current.length > 0) batches.push(current);
    return batches;
  }

  /** Dòng nào được phép gửi: tất cả, hoặc chỉ những dòng không có lỗi khi bỏ qua dòng sai. */
  private selectPublishableItems(
    flashSale: FlashSaleDetailRow,
    validation: { issues: Array<{ level: string; itemId?: string | null }> },
  ): FlashSaleItemRow[] {
    const brokenIds = new Set(
      validation.issues
        .filter((issue) => issue.level === 'ERROR' && issue.itemId)
        .map((issue) => issue.itemId as string),
    );
    return flashSale.items.filter(
      (item) => item.status !== PodFlashSaleItemStatus.REMOVED && !brokenIds.has(item.id),
    );
  }

  private async markPublished(
    flashSale: FlashSaleDetailRow,
    activityId: string,
    published: FlashSaleItemRow[],
    acceptedSkuIds: Map<string, string>,
    userId: string,
  ): Promise<void> {
    const publishedIds = published.map((item) => item.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.podFlashSale.update({
        where: { id: flashSale.id },
        data: {
          status: PodFlashSaleStatus.RUNNING,
          providerFlashSaleId: activityId,
          publishedAt: new Date(),
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorRequestId: null,
          updatedBy: userId,
        },
      });

      if (publishedIds.length > 0) {
        await tx.podFlashSaleItem.updateMany({
          where: { id: { in: publishedIds } },
          data: { status: PodFlashSaleItemStatus.PUBLISHED, errorCode: null, error: null },
        });
      }

      // Ghi lại SKU mà TikTok XÁC NHẬN đã vào hoạt động. Không có xác nhận thì để trống —
      // một cột trống nói "chưa biết", còn một cột tự điền nói sai sự thật.
      for (const item of published) {
        const confirmed = item.providerVariantId ? acceptedSkuIds.get(item.providerVariantId) : undefined;
        if (!confirmed) continue;
        await tx.podFlashSaleItem.update({
          where: { id: item.id },
          data: { providerSkuId: confirmed },
        });
      }
    });
  }

  private async markFailed(
    flashSale: FlashSaleDetailRow,
    failure: ProviderFailure,
    userId: string,
  ): Promise<void> {
    await this.prisma.podFlashSale.update({
      where: { id: flashSale.id },
      data: {
        status: PodFlashSaleStatus.FAILED,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message.slice(0, 2000),
        lastErrorRequestId: failure.requestId,
        updatedBy: userId,
      },
    });

    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
      level: PodFlashSaleLogLevel.ERROR,
      message: 'Publish Flash Sale thất bại.',
      errorCode: failure.code,
      errorMessage: failure.message,
      requestId: failure.requestId,
      attempt: flashSale.retryCount,
      userId,
    });
  }

  /**
   * Ghi ngược `sku_id` mà TikTok xác nhận trong hoạt động (dùng ở lượt sync).
   *
   * Dòng nào có trong database mà KHÔNG có trong danh sách TikTok trả về nghĩa là sàn đã gỡ
   * nó ra (hết hàng, sản phẩm bị khoá) — đánh dấu `REMOVED` để người vận hành thấy đúng thứ
   * đang thực sự chạy, thay vì một danh sách đẹp không phản ánh hiện trạng.
   */
  private async syncItemConfirmations(
    flashSaleId: string,
    activity: TiktokActivityDetail,
  ): Promise<void> {
    const confirmedSkuIds = new Set<string>();
    const confirmedProductIds = new Set<string>();
    for (const product of activity.products ?? []) {
      if (product.id) confirmedProductIds.add(product.id);
      for (const sku of product.skus ?? []) if (sku.id) confirmedSkuIds.add(sku.id);
    }

    // TikTok trả `products` rỗng cho hoạt động đã kết thúc quá 180 ngày (theo tài liệu) —
    // trong trường hợp đó danh sách rỗng KHÔNG có nghĩa là mọi dòng đã bị gỡ.
    if (confirmedProductIds.size === 0) return;

    const items = await this.prisma.podFlashSaleItem.findMany({
      where: { flashSaleId, status: { not: PodFlashSaleItemStatus.REMOVED } },
      select: { id: true, providerProductId: true, providerVariantId: true },
    });

    const removedIds: string[] = [];
    for (const item of items) {
      const stillThere = item.providerVariantId
        ? confirmedSkuIds.has(item.providerVariantId)
        : Boolean(item.providerProductId && confirmedProductIds.has(item.providerProductId));
      if (!stillThere) removedIds.push(item.id);
    }

    if (removedIds.length > 0) {
      await this.prisma.podFlashSaleItem.updateMany({
        where: { id: { in: removedIds } },
        data: { status: PodFlashSaleItemStatus.REMOVED },
      });
      await this.flashSales.refreshItemCount(flashSaleId);
    }
  }

  /**
   * Trạng thái TikTok ⇒ trạng thái hệ thống.
   *
   * Hết giờ mà TikTok vẫn báo `ONGOING` (sàn cập nhật trễ) thì tin ĐỒNG HỒ: `endAt` là con
   * số hệ thống đã gửi đi và người vận hành đang nhìn vào nó.
   */
  private mapProviderStatus(activity: TiktokActivityDetail, endAt: Date): PodFlashSaleStatus {
    const mapped = activity.status
      ? TIKTOK_TO_FLASH_SALE_STATUS[activity.status as keyof typeof TIKTOK_TO_FLASH_SALE_STATUS]
      : undefined;

    if (mapped === PodFlashSaleStatus.RUNNING && endAt.getTime() <= Date.now()) {
      return PodFlashSaleStatus.ENDED;
    }
    // Hoạt động bị TikTok khoá cứng (`IMMUTABLE`) mà không rõ trạng thái ⇒ coi như đã kết
    // thúc: không còn thao tác nào thực hiện được trên nó nữa.
    if (!mapped) {
      return activity.activityCommands?.includes(TIKTOK_ACTIVITY_COMMAND_IMMUTABLE)
        ? PodFlashSaleStatus.ENDED
        : PodFlashSaleStatus.RUNNING;
    }
    return mapped;
  }

  /** Bóc lỗi TikTok thành `{code, message, requestId}` — dùng chung cho mọi đường. */
  private describeFailure(error: unknown): ProviderFailure {
    if (error instanceof TiktokClientError) {
      return {
        code: String(error.tiktokCode),
        message: error.tiktokMessage,
        requestId: error.requestId ?? null,
      };
    }
    if (error instanceof PodFlashSaleShopContextException) {
      return { code: 'SHOP_CONTEXT', message: error.message, requestId: null };
    }
    return {
      code: null,
      message: error instanceof Error ? error.message : 'Lỗi không xác định khi gọi TikTok',
      requestId: null,
    };
  }
}
