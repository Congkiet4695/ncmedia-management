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
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokPromotionApiService } from '../../tiktok-sdk/tiktok-promotion-api.service';
import {
  TIKTOK_ACTIVITY_PRODUCT_LEVEL,
  TIKTOK_ACTIVITY_TYPE,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type {
  TiktokActivityDetail,
  TiktokActivitySummary,
} from '../../tiktok-sdk/types/tiktok-promotion.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  FLASH_SALE_IMPORT_LOCK_PREFIX,
  FLASH_SALE_IMPORT_LOCK_RENEW_MS,
  FLASH_SALE_IMPORT_LOCK_TTL_MS,
  FLASH_SALE_IMPORT_MAX_REPORTED_ISSUES,
  FLASH_SALE_SOURCE,
  FLASH_SALE_UNLIMITED,
} from '../constants/pod-flash-sale.constants';
import type { SyncFlashSalesFromTiktokDto } from '../dto/pod-flash-sale.dto';
import type {
  PodFlashSaleImportResultDto,
  PodFlashSaleImportShopResultDto,
} from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleImportBusyException,
  PodFlashSaleProductMismatchException,
} from '../exceptions/pod-flash-sale.exceptions';
import { computeFlashSalePricing, percentOf, toDecimal, validateQuantityLimit } from './pod-flash-sale-pricing';
import { PodFlashSalePublisherService } from './pod-flash-sale-publisher.service';
import { PodFlashSaleService } from './pod-flash-sale.service';

/** Trạng thái đã KẾT THÚC — cả hai phía: hoạt động không còn đổi sản phẩm được nữa. */
const TERMINAL_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.ENDED,
  PodFlashSaleStatus.CANCELLED,
  PodFlashSaleStatus.FAILED,
];

/** Kết quả xử lý MỘT hoạt động. */
type ActivityOutcome =
  | { kind: 'created' | 'updated'; itemsCreated: number; itemsUpdated: number; itemsRemoved: number; unmatched: number; invalid: number }
  | { kind: 'unchanged' | 'skipped' };

/** Một dòng Flash Sale dựng từ dữ liệu TikTok, đã khớp với sản phẩm/biến thể trong hệ thống. */
interface DesiredItem {
  /** Khoá đối soát: `tiktok_sku_id` (VARIATION) hoặc `tiktok_product_id` (PRODUCT). */
  key: string;
  productId: string;
  variantId: string | null;
  skuId: string | null;
  originalPrice: Prisma.Decimal;
  flashSalePrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  currency: string | null;
  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
  providerProductId: string;
  providerVariantId: string | null;
  providerSkuId: string | null;
}

interface LocalProduct {
  id: string;
  tiktokProductId: string;
  currency: string | null;
  minPrice: Prisma.Decimal | null;
  variants: Array<{
    id: string;
    tiktokSkuId: string | null;
    sellerSku: string | null;
    salePrice: Prisma.Decimal | null;
    listPrice: Prisma.Decimal | null;
    currency: string | null;
  }>;
}

/**
 * Đồng bộ Flash Sale TỪ TikTok VỀ hệ thống (hoạt động tạo ở Seller Center, hoặc đợt của hệ
 * thống bị sửa trên sàn).
 *
 * ```
 *   mỗi shop trong phạm vi ─▶ khoá Redis theo shop (hai lượt cùng shop ⇒ lượt sau BUSY)
 *        ▼
 *   Search Activities (FLASHSALE) — ĐỦ mọi trang theo `next_page_token`
 *        ▼  mỗi hoạt động
 *   khớp theo (shop, activity_id) — KHÔNG theo tên
 *        ├─ chưa có ⇒ tạo đợt `source = TIKTOK`
 *        ├─ có, đang PUBLISHING ⇒ bỏ qua (lượt gửi lô đang giữ đợt này)
 *        ├─ có, đã kết thúc cả hai phía ⇒ chỉ cập nhật trạng thái (không đọc chi tiết)
 *        └─ có ⇒ Get Activity, đối soát từng dòng theo `tiktok_product_id` / `tiktok_sku_id`
 * ```
 *
 * 🔴 **Idempotent.** Khoá của đợt là `(shop_id, provider_flash_sale_id)` (UNIQUE trong DB),
 * khoá của dòng là id TikTok của SKU/sản phẩm; một dòng chỉ được GHI khi giá trị thực sự đổi
 * ⇒ chạy lại lần hai không tạo bản ghi nào, không đổi dòng nào.
 *
 * 🔴 **Không đè lượt gửi lô.** Ghi cho một đợt đã có chạy trong transaction khoá hàng
 * `pod_flash_sales` (`FOR UPDATE`) và so lại `status`/`publish_run_id` đã đọc TRƯỚC khi gọi
 * TikTok: có lượt gửi (push/publish) chen vào giữa ⇒ ảnh chụp Get Activity đã cũ ⇒ bỏ qua đợt
 * đó, lần đồng bộ sau làm tiếp. Lượt push giành trạng thái bằng `updateMany` trên chính hàng đó
 * nên phải chờ transaction này xong.
 */
@Injectable()
export class PodFlashSaleImportService {
  private readonly logger = new Logger(PodFlashSaleImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSales: PodFlashSaleService,
    private readonly publisher: PodFlashSalePublisherService,
    private readonly promotionApi: TiktokPromotionApiService,
    private readonly accessScope: PodAccessScopeService,
    private readonly locks: DistributedLockService,
  ) {}

  async syncFromTiktok(
    organizationId: string,
    userId: string,
    dto: SyncFlashSalesFromTiktokDto,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleImportResultDto> {
    this.accessScope.assertShopAllowed(scope, dto.shopId);
    const shopFilter = this.accessScope.shopFilter(scope);
    const shops = await this.prisma.podTiktokShop.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(dto.shopId ? { id: dto.shopId } : shopFilter ? { id: shopFilter } : {}),
      },
      select: { id: true, name: true, accountId: true },
      orderBy: { name: 'asc' },
    });
    if (dto.shopId && shops.length === 0) throw new PodFlashSaleProductMismatchException();

    const results: PodFlashSaleImportShopResultDto[] = [];
    for (const shop of shops) {
      const result = await this.syncShop(organizationId, userId, shop);
      // Người dùng chọn ĐÚNG một shop mà shop đó đang bận ⇒ nói thẳng bằng 409, không trả về
      // một bản tổng kết toàn số 0 dễ bị hiểu là "TikTok không có gì".
      if (dto.shopId && result.result === 'BUSY') throw new PodFlashSaleImportBusyException();
      results.push(result);
    }

    const sum = (pick: (row: PodFlashSaleImportShopResultDto) => number) =>
      results.reduce((total, row) => total + pick(row), 0);
    return {
      shops: results,
      created: sum((row) => row.created),
      updated: sum((row) => row.updated),
      unchanged: sum((row) => row.unchanged),
      skipped: sum((row) => row.skipped),
      failed: sum((row) => row.failed + (row.result === 'FAILED' ? 1 : 0)),
      unmatchedItems: sum((row) => row.unmatchedItems),
    };
  }

  // ---------------------------------------------------------------------------
  // Một shop
  // ---------------------------------------------------------------------------

  private async syncShop(
    organizationId: string,
    userId: string,
    shop: { id: string; name: string; accountId: string },
  ): Promise<PodFlashSaleImportShopResultDto> {
    const result: PodFlashSaleImportShopResultDto = {
      shopId: shop.id,
      shopName: shop.name,
      result: 'SUCCESS',
      errorCode: null,
      errorMessage: null,
      scanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      unmatchedItems: 0,
      invalidItems: 0,
    };

    const lock = await this.locks.acquire(
      `${FLASH_SALE_IMPORT_LOCK_PREFIX}${shop.id}`,
      FLASH_SALE_IMPORT_LOCK_TTL_MS,
    );
    if (!lock) {
      result.result = 'BUSY';
      return result;
    }
    const watchdog = setInterval(() => {
      void this.locks.renew(lock, FLASH_SALE_IMPORT_LOCK_TTL_MS);
    }, FLASH_SALE_IMPORT_LOCK_RENEW_MS);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    const startedAt = Date.now();
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.sync.start',
      organizationId,
      shopId: shop.id,
      msg: 'FLASH_SALE_SYNC_STARTED: đồng bộ Flash Sale từ TikTok',
    });

    try {
      const context = await this.publisher.resolveContext(organizationId, shop.id);
      // Quét ĐỦ mọi trang (cursor `next_page_token`) — không dừng ở trang đầu.
      const activities = await this.promotionApi.searchAllActivities(context, {
        activityType: TIKTOK_ACTIVITY_TYPE.FLASHSALE,
      });
      result.scanned = activities.length;

      for (const summary of activities) {
        try {
          const outcome = await this.importActivity(organizationId, userId, shop, context, summary);
          result[outcome.kind] += 1;
          if (outcome.kind === 'created' || outcome.kind === 'updated') {
            result.itemsCreated += outcome.itemsCreated;
            result.itemsUpdated += outcome.itemsUpdated;
            result.itemsRemoved += outcome.itemsRemoved;
            result.unmatchedItems += outcome.unmatched;
            result.invalidItems += outcome.invalid;
          }
        } catch (error) {
          // Một hoạt động hỏng không được chặn các hoạt động còn lại của shop.
          result.failed += 1;
          const failure = this.publisher.describeFailure(error);
          this.logger.warn({
            module: 'pod-flash-sale',
            operation: 'flashSale.sync.activity',
            organizationId,
            shopId: shop.id,
            activityId: summary.id ?? null,
            errorCode: failure.code,
            requestId: failure.requestId,
            msg: `Không đồng bộ được hoạt động Flash Sale: ${failure.message}`,
          });
        }
      }

      this.logger.log({
        module: 'pod-flash-sale',
        operation: 'flashSale.sync.success',
        organizationId,
        shopId: shop.id,
        durationMs: Date.now() - startedAt,
        scanned: result.scanned,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        failed: result.failed,
        itemsCreated: result.itemsCreated,
        itemsUpdated: result.itemsUpdated,
        itemsRemoved: result.itemsRemoved,
        unmatchedItems: result.unmatchedItems,
        invalidItems: result.invalidItems,
        msg: 'FLASH_SALE_SYNC_SUCCESS: đồng bộ Flash Sale từ TikTok xong',
      });
    } catch (error) {
      const failure = this.publisher.describeFailure(error);
      result.result = 'FAILED';
      result.errorCode = failure.code;
      result.errorMessage = failure.message;
      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'flashSale.sync.failed',
        organizationId,
        shopId: shop.id,
        durationMs: Date.now() - startedAt,
        errorCode: failure.code,
        requestId: failure.requestId,
        msg: `FLASH_SALE_SYNC_FAILED: ${failure.message}`,
      });
    } finally {
      clearInterval(watchdog);
      await this.locks.release(lock);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Một hoạt động
  // ---------------------------------------------------------------------------

  private async importActivity(
    organizationId: string,
    userId: string,
    shop: { id: string; accountId: string },
    context: TiktokShopContext,
    summary: TiktokActivitySummary,
  ): Promise<ActivityOutcome> {
    const activityId = summary.id;
    if (!activityId) return { kind: 'skipped' };
    if (summary.activityType && summary.activityType !== TIKTOK_ACTIVITY_TYPE.FLASHSALE) {
      return { kind: 'skipped' };
    }

    // Khớp theo id TikTok — kể cả bản ghi đã xoá mềm (UNIQUE `(shop_id, provider_flash_sale_id)`
    // không phân biệt `deleted_at`, nên tạo lại sẽ vỡ ràng buộc; và người dùng đã xoá thì
    // đồng bộ không được hồi sinh nó).
    const existing = await this.prisma.podFlashSale.findFirst({
      where: { organizationId, shopId: shop.id, providerFlashSaleId: activityId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        publishRunId: true,
        publishedAt: true,
        source: true,
        name: true,
        endAt: true,
        productLevel: true,
      },
    });
    if (existing?.deletedAt) return { kind: 'skipped' };
    if (existing?.status === PodFlashSaleStatus.PUBLISHING) return { kind: 'skipped' };

    // Đã kết thúc ở CẢ HAI phía ⇒ sản phẩm không còn đổi được: không tốn một lượt Get Activity.
    if (existing && TERMINAL_STATUSES.includes(existing.status)) {
      const next = this.publisher.mapProviderStatus(summary, existing.endAt);
      if (TERMINAL_STATUSES.includes(next)) {
        await this.prisma.podFlashSale.updateMany({
          where: { id: existing.id, status: { not: PodFlashSaleStatus.PUBLISHING } },
          data: { status: next, providerStatus: summary.status ?? null, lastSyncedAt: new Date() },
        });
        return { kind: 'unchanged' };
      }
    }

    const { data: detail, requestId } = await this.promotionApi.getActivity(context, activityId);

    const level = this.toProductLevel(detail.productLevel ?? summary.productLevel);
    const beginTime = detail.beginTime ?? summary.beginTime;
    const endTime = detail.endTime ?? summary.endTime;
    // Mức SHOP (giảm cả shop) không có danh sách sản phẩm — ngoài phạm vi module này.
    if (!level || !beginTime || !endTime) return { kind: 'skipped' };
    if (existing && existing.productLevel !== level) return { kind: 'skipped' };

    const startAt = new Date(beginTime * 1_000);
    const endAt = new Date(endTime * 1_000);
    const status = this.publisher.mapProviderStatus(detail, endAt);
    const title = (detail.title ?? summary.title ?? activityId).trim();

    const { desired, unmatched, invalid, issues } = await this.buildDesiredItems(
      organizationId,
      shop.id,
      level,
      detail,
    );

    const outcome = await this.prisma.$transaction(async (tx) => {
      let flashSaleId: string;
      let kind: 'created' | 'updated';

      if (existing) {
        // Khoá hàng rồi so lại: có lượt gửi lô chen vào sau khi đọc ⇒ ảnh chụp đã cũ ⇒ bỏ qua.
        const [locked] = await tx.$queryRaw<Array<{ status: PodFlashSaleStatus; publish_run_id: string | null }>>`
          SELECT status, publish_run_id FROM pod_flash_sales WHERE id = ${existing.id}::uuid FOR UPDATE
        `;
        if (
          !locked ||
          locked.status === PodFlashSaleStatus.PUBLISHING ||
          locked.publish_run_id !== existing.publishRunId
        ) {
          return null;
        }

        const name =
          existing.source === FLASH_SALE_SOURCE.TIKTOK && title !== existing.name
            ? await this.freeName(tx, organizationId, shop.id, title, activityId, existing.id)
            : existing.name;
        await tx.podFlashSale.update({
          where: { id: existing.id },
          data: {
            name,
            status,
            providerStatus: detail.status ?? null,
            startAt,
            endAt,
            lastSyncedAt: new Date(),
            publishedAt: existing.publishedAt ?? this.publishedAtOf(detail, status),
            ...(status === PodFlashSaleStatus.FAILED
              ? {}
              : { lastErrorCode: null, lastErrorMessage: null, lastErrorRequestId: null }),
            updatedBy: userId,
          },
        });
        flashSaleId = existing.id;
        kind = 'updated';
      } else {
        const created = await tx.podFlashSale.create({
          data: {
            organizationId,
            accountId: shop.accountId,
            shopId: shop.id,
            providerFlashSaleId: activityId,
            name: await this.freeName(tx, organizationId, shop.id, title, activityId, null),
            status,
            productLevel: level,
            startAt,
            endAt,
            providerStatus: detail.status ?? null,
            publishedAt: this.publishedAtOf(detail, status),
            lastSyncedAt: new Date(),
            source: FLASH_SALE_SOURCE.TIKTOK,
            createdBy: userId,
            updatedBy: userId,
          },
          select: { id: true },
        });
        flashSaleId = created.id;
        kind = 'created';
      }

      const written = await this.upsertItems(tx, organizationId, flashSaleId, level, desired);
      const itemsRemoved = await this.publisher.reconcileItemsWithActivity(flashSaleId, detail, tx);
      await this.flashSales.refreshItemCount(flashSaleId, tx);
      return { flashSaleId, kind, ...written, itemsRemoved };
    });

    if (!outcome) return { kind: 'skipped' };
    // Đợt đã có mà không dòng nào đổi, trạng thái cũng như cũ ⇒ "không đổi" (lần đồng bộ thứ hai).
    const nothingChanged =
      outcome.kind === 'updated' &&
      existing?.status === status &&
      outcome.itemsCreated + outcome.itemsUpdated + outcome.itemsRemoved === 0;

    const changed =
      outcome.kind === 'created' ||
      outcome.itemsCreated + outcome.itemsUpdated + outcome.itemsRemoved > 0 ||
      unmatched + invalid > 0;
    if (changed) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId: outcome.flashSaleId,
        action: PodFlashSaleLogAction.SYNC_STATUS,
        level: unmatched + invalid > 0 ? PodFlashSaleLogLevel.WARN : PodFlashSaleLogLevel.INFO,
        message:
          `Đồng bộ từ TikTok (${outcome.kind === 'created' ? 'tạo mới' : 'cập nhật'}): ` +
          `+${outcome.itemsCreated} dòng mới, ${outcome.itemsUpdated} dòng cập nhật, ` +
          `${outcome.itemsRemoved} dòng bị gỡ, ${unmatched} SKU chưa có trong hệ thống, ` +
          `${invalid} SKU giá/giới hạn không hợp lệ.`,
        response: { activityStatus: detail.status ?? null, issues },
        requestId: requestId ?? null,
        userId,
      });
    }

    if (nothingChanged) return { kind: 'unchanged' };
    return {
      kind: outcome.kind,
      itemsCreated: outcome.itemsCreated,
      itemsUpdated: outcome.itemsUpdated,
      itemsRemoved: outcome.itemsRemoved,
      unmatched,
      invalid,
    };
  }

  /**
   * Dữ liệu TikTok ⇒ các dòng cần có, khớp với sản phẩm/biến thể TRONG HỆ THỐNG theo
   * `tiktok_product_id` / `tiktok_sku_id` (không bao giờ theo tên).
   *
   * 🔴 Không bịa dữ liệu: SKU chưa đồng bộ về hệ thống ⇒ `unmatched`; giá deal vượt giá gốc
   * đang lưu (giá gốc đã đổi) hoặc giới hạn ngoài dải ⇒ `invalid`. Cả hai được ĐẾM và ghi
   * log, không được ép thành một dòng sai.
   */
  private async buildDesiredItems(
    organizationId: string,
    shopId: string,
    level: PodFlashSaleProductLevel,
    detail: TiktokActivityDetail,
  ): Promise<{ desired: DesiredItem[]; unmatched: number; invalid: number; issues: string[] }> {
    const products = detail.products ?? [];
    const tiktokProductIds = [...new Set(products.map((p) => p.id).filter((id): id is string => Boolean(id)))];
    const localProducts: LocalProduct[] =
      tiktokProductIds.length === 0
        ? []
        : await this.prisma.podProduct.findMany({
            where: { organizationId, shopId, deletedAt: null, tiktokProductId: { in: tiktokProductIds } },
            select: {
              id: true,
              tiktokProductId: true,
              currency: true,
              minPrice: true,
              variants: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  tiktokSkuId: true,
                  sellerSku: true,
                  salePrice: true,
                  listPrice: true,
                  currency: true,
                },
              },
            },
          });
    const byTiktokId = new Map(localProducts.map((product) => [product.tiktokProductId, product]));

    const desired: DesiredItem[] = [];
    const issues: string[] = [];
    let unmatched = 0;
    let invalid = 0;
    const report = (message: string) => {
      if (issues.length < FLASH_SALE_IMPORT_MAX_REPORTED_ISSUES) issues.push(message);
    };

    for (const product of products) {
      if (!product.id) continue;
      const local = byTiktokId.get(product.id);

      if (level === PodFlashSaleProductLevel.PRODUCT) {
        if (!local) {
          unmatched += 1;
          report(`Sản phẩm ${product.id} chưa có trong hệ thống.`);
          continue;
        }
        const item = this.toDesiredItem({
          key: product.id,
          productId: local.id,
          variantId: null,
          skuId: null,
          originalPrice: local.minPrice,
          currency: product.activityPrice?.currency ?? local.currency,
          activityPrice: product.activityPrice?.amount,
          discount: product.discount,
          quantityLimit: product.quantityLimit,
          quantityPerUser: product.quantityPerUser,
          providerProductId: product.id,
          providerVariantId: null,
          providerSkuId: null,
        });
        if (typeof item === 'string') {
          invalid += 1;
          report(`Sản phẩm ${product.id}: ${item}`);
        } else desired.push(item);
        continue;
      }

      for (const sku of product.skus ?? []) {
        if (!sku.id) continue;
        const variant = local?.variants.find((v) => v.tiktokSkuId === sku.id);
        if (!local || !variant) {
          unmatched += 1;
          report(`SKU ${sku.id} (sản phẩm ${product.id}) chưa có trong hệ thống.`);
          continue;
        }
        const item = this.toDesiredItem({
          key: sku.id,
          productId: local.id,
          variantId: variant.id,
          skuId: variant.sellerSku,
          originalPrice: variant.salePrice ?? variant.listPrice,
          currency: sku.activityPrice?.currency ?? variant.currency ?? local.currency,
          activityPrice: sku.activityPrice?.amount,
          discount: product.discount,
          quantityLimit: sku.quantityLimit ?? product.quantityLimit,
          quantityPerUser: sku.quantityPerUser ?? product.quantityPerUser,
          providerProductId: product.id,
          providerVariantId: sku.id,
          providerSkuId: sku.id,
        });
        if (typeof item === 'string') {
          invalid += 1;
          report(`SKU ${sku.id}: ${item}`);
        } else desired.push(item);
      }
    }
    return { desired, unmatched, invalid, issues };
  }

  /** Một mục TikTok ⇒ dòng hợp lệ với các CHECK của bảng, hoặc lý do không ghi được. */
  private toDesiredItem(input: {
    key: string;
    productId: string;
    variantId: string | null;
    skuId: string | null;
    originalPrice: Prisma.Decimal | null;
    currency: string | null;
    activityPrice: string | undefined;
    discount: string | undefined;
    quantityLimit: number | undefined;
    quantityPerUser: number | undefined;
    providerProductId: string;
    providerVariantId: string | null;
    providerSkuId: string | null;
  }): DesiredItem | string {
    const originalPrice = toDecimal(input.originalPrice);
    if (!originalPrice || originalPrice.lessThanOrEqualTo(0)) {
      return 'chưa có giá bán trong hệ thống — đồng bộ lại sản phẩm.';
    }
    const pricing = computeFlashSalePricing({
      originalPrice,
      flashSalePrice: input.activityPrice ?? null,
      discountPercent: input.activityPrice ? null : (input.discount ?? null),
    });
    if (!pricing || pricing.flashSalePrice.lessThanOrEqualTo(0)) {
      return 'TikTok không trả về giá deal dùng được.';
    }
    if (pricing.flashSalePrice.greaterThan(originalPrice)) {
      return `giá deal ${pricing.flashSalePrice.toString()} lớn hơn giá gốc đang lưu ${originalPrice.toString()} — đồng bộ lại sản phẩm.`;
    }
    const totalPurchaseLimit = input.quantityLimit ?? FLASH_SALE_UNLIMITED;
    const customerPurchaseLimit = input.quantityPerUser ?? FLASH_SALE_UNLIMITED;
    if (
      validateQuantityLimit(totalPurchaseLimit, 'totalPurchaseLimit').length > 0 ||
      validateQuantityLimit(customerPurchaseLimit, 'customerPurchaseLimit').length > 0
    ) {
      return `giới hạn mua (${totalPurchaseLimit}/${customerPurchaseLimit}) ngoài dải cho phép.`;
    }
    return {
      key: input.key,
      productId: input.productId,
      variantId: input.variantId,
      skuId: input.skuId,
      originalPrice: pricing.originalPrice,
      flashSalePrice: pricing.flashSalePrice,
      discountPercent: pricing.discountPercent,
      currency: input.currency,
      totalPurchaseLimit,
      customerPurchaseLimit,
      providerProductId: input.providerProductId,
      providerVariantId: input.providerVariantId,
      providerSkuId: input.providerSkuId,
    };
  }

  /**
   * Ghi các dòng TikTok đang có: dòng đã có ⇒ cập nhật (CHỈ khi khác), dòng chưa có ⇒ tạo.
   * Dòng có trên TikTok là dòng đã lên sàn ⇒ `PUBLISHED` (sửa luôn dòng bị đánh dấu hỏng nhầm).
   */
  private async upsertItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    flashSaleId: string,
    level: PodFlashSaleProductLevel,
    desired: DesiredItem[],
  ): Promise<{ itemsCreated: number; itemsUpdated: number }> {
    const current = await tx.podFlashSaleItem.findMany({
      where: { flashSaleId },
      select: {
        id: true,
        status: true,
        productId: true,
        variantId: true,
        providerProductId: true,
        providerVariantId: true,
        providerSkuId: true,
        originalPrice: true,
        flashSalePrice: true,
        discountPercent: true,
        totalPurchaseLimit: true,
        customerPurchaseLimit: true,
        sortOrder: true,
      },
    });
    const keyOf = (row: { providerProductId: string | null; providerVariantId: string | null }) =>
      level === PodFlashSaleProductLevel.PRODUCT ? row.providerProductId : row.providerVariantId;
    const byKey = new Map(current.map((row) => [keyOf(row), row]));
    let sortOrder = current.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);

    const toCreate: Prisma.PodFlashSaleItemCreateManyInput[] = [];
    let itemsUpdated = 0;
    for (const item of desired) {
      const row = byKey.get(item.key);
      if (!row) {
        toCreate.push({
          organizationId,
          flashSaleId,
          productId: item.productId,
          variantId: item.variantId,
          skuId: item.skuId,
          originalPrice: item.originalPrice,
          flashSalePrice: item.flashSalePrice,
          discountPercent: item.discountPercent,
          currency: item.currency,
          totalPurchaseLimit: item.totalPurchaseLimit,
          customerPurchaseLimit: item.customerPurchaseLimit,
          providerProductId: item.providerProductId,
          providerVariantId: item.providerVariantId,
          providerSkuId: item.providerSkuId,
          status: PodFlashSaleItemStatus.PUBLISHED,
          sortOrder: sortOrder++,
        });
        continue;
      }
      const same =
        row.status === PodFlashSaleItemStatus.PUBLISHED &&
        row.providerSkuId === item.providerSkuId &&
        row.flashSalePrice.equals(item.flashSalePrice) &&
        row.totalPurchaseLimit === item.totalPurchaseLimit &&
        row.customerPurchaseLimit === item.customerPurchaseLimit &&
        // Dòng mất liên kết biến thể (SKU từng bị xoá rồi đồng bộ lại) ⇒ nối lại.
        (row.variantId !== null || item.variantId === null);
      if (same) continue;

      // Giữ giá gốc đã chụp nếu vẫn hợp lệ với giá deal mới — con số người vận hành đã thấy.
      const keepOriginal = row.originalPrice.greaterThanOrEqualTo(item.flashSalePrice);
      await tx.podFlashSaleItem.update({
        where: { id: row.id },
        data: {
          status: PodFlashSaleItemStatus.PUBLISHED,
          errorCode: null,
          error: null,
          providerSkuId: item.providerSkuId,
          flashSalePrice: item.flashSalePrice,
          originalPrice: keepOriginal ? row.originalPrice : item.originalPrice,
          discountPercent: keepOriginal
            ? percentOf(row.originalPrice, item.flashSalePrice)
            : item.discountPercent,
          totalPurchaseLimit: item.totalPurchaseLimit,
          customerPurchaseLimit: item.customerPurchaseLimit,
          ...(row.variantId === null && item.variantId !== null ? { variantId: item.variantId } : {}),
        },
      });
      itemsUpdated += 1;
    }

    if (toCreate.length > 0) await tx.podFlashSaleItem.createMany({ data: toCreate });
    return { itemsCreated: toCreate.length, itemsUpdated };
  }

  /**
   * Tên cho đợt đồng bộ về: tên TikTok, trùng tên đợt khác của shop (UNIQUE một phần
   * `(shop_id, name)`) ⇒ gắn id hoạt động vào sau để phân biệt — không bao giờ khớp theo tên.
   */
  private async freeName(
    tx: Prisma.TransactionClient,
    organizationId: string,
    shopId: string,
    title: string,
    activityId: string,
    excludeId: string | null,
  ): Promise<string> {
    const maxLength = 255;
    const base = title.slice(0, maxLength);
    const taken = await tx.podFlashSale.findFirst({
      where: {
        organizationId,
        shopId,
        name: base,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!taken) return base;
    const suffix = ` (TikTok ${activityId})`;
    return `${title.slice(0, maxLength - suffix.length)}${suffix}`;
  }

  private toProductLevel(value: string | undefined): PodFlashSaleProductLevel | null {
    if (value === TIKTOK_ACTIVITY_PRODUCT_LEVEL.PRODUCT) return PodFlashSaleProductLevel.PRODUCT;
    if (value === TIKTOK_ACTIVITY_PRODUCT_LEVEL.VARIATION) return PodFlashSaleProductLevel.VARIATION;
    return null;
  }

  /** Hoạt động đã lên sàn (không còn là bản nháp) ⇒ mốc "đã publish" là lúc TikTok tạo nó. */
  private publishedAtOf(detail: TiktokActivityDetail, status: PodFlashSaleStatus): Date | null {
    if (status === PodFlashSaleStatus.READY || !detail.createTime) return null;
    return new Date(detail.createTime * 1_000);
  }
}
