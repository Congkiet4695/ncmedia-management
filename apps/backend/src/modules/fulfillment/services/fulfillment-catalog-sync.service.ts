import { Injectable, Logger } from '@nestjs/common';
import {
  FulfillmentCatalogItemStatus,
  FulfillmentProvider,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { FulfillmentAccountNotFoundException } from '../exceptions/fulfillment.exceptions';
import { MangoCatalogService } from '../mango/services/mango-catalog.service';
import type { MangoAccountCredentialRef } from '../mango/services/mango-credential.service';
import { MANGO_CATALOG_SYNC } from '../mango/constants/mango.constants';
import type { MangoProduct, MangoVariation } from '../mango/types/mango-api.types';
import {
  FulfillmentCatalogRepository,
  type CatalogScope,
  type CatalogueUpsertInput,
  type ProductUpsertInput,
  type VariantUpsertInput,
} from '../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';

/** Kết quả một lượt đồng bộ danh mục — trả ra API và ghi vào nhật ký. */
export interface CatalogSyncResult {
  accountId: string;
  provider: FulfillmentProvider;
  catalogues: number;
  products: number;
  variants: number;
  archivedCatalogues: number;
  archivedProducts: number;
  archivedVariants: number;
  apiCalls: number;
  durationMs: number;
  /** `false` khi có ít nhất một lượt đọc bị cụt — xem `warnings`. */
  complete: boolean;
  /** Mô tả chính xác chỗ nào thiếu, để không phải mò trong log. */
  warnings: string[];
}

/**
 * FulfillmentCatalogSyncService — kéo danh mục nhà cung cấp về Database.
 *
 * ```
 *   Mango API ──▶ Sync Job ──▶ Database ──▶ UI
 * ```
 *
 * 🔴 Giao diện KHÔNG còn gọi Mango. Trước đây mỗi lần mở màn hình Product Mapping là một
 * loạt lời gọi thẳng sang nhà cung cấp; giờ đó là việc của service này, chạy theo lịch hoặc
 * do người dùng bấm.
 *
 * **Thứ tự bắt buộc: Catalogue → Product → Variant.** Sản phẩm mang khoá ngoại tới danh mục
 * và biến thể mang khoá ngoại tới sản phẩm, nên phải có id của bước trước mới ghi được bước
 * sau. Hai `Map<externalId, id>` truyền xuôi giữa các bước chính là để tránh phải truy vấn
 * lại từng dòng.
 *
 * 🔴 **Không duplicate.** Mọi lần ghi đều là `INSERT ... ON CONFLICT DO UPDATE` trên đúng
 * ràng buộc UNIQUE của bảng. Đã có thì UPDATE, chưa có thì INSERT — do DATABASE quyết định,
 * không phải do code đọc trước rồi đoán.
 *
 * 🔴 **Chỉ archive khi đọc ĐỦ.** Nếu bất kỳ lượt đọc nào bị cụt (mất mạng giữa chừng, chạm
 * trần trang, nhà cung cấp trả thiếu), bước đánh dấu ARCHIVED bị BỎ QUA. Lý do: "không thấy
 * trong lượt này" khi đọc cụt chỉ có nghĩa "chưa đọc tới", và archive lúc đó sẽ xoá nhầm
 * nửa danh mục khỏi mọi ô chọn.
 *
 * **Đọc biến thể chạy song song có giới hạn.** Một danh mục N sản phẩm cần N lời gọi lấy
 * biến thể; chạy tuần tự thì một danh mục 2000 sản phẩm mất hàng chục phút. Chạy song song
 * có trần, còn việc giữ đúng 10 req/s là của `MangoApiClient`.
 */
@Injectable()
export class FulfillmentCatalogSyncService {
  private readonly logger = new Logger(FulfillmentCatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
    private readonly mangoCatalog: MangoCatalogService,
  ) {}

  /**
   * Đồng bộ danh mục của MỘT tài khoản nhà cung cấp.
   *
   * @param trigger Ai kích hoạt — `MANUAL` (người dùng bấm) hay `CRON` (theo lịch).
   */
  async syncAccount(
    organizationId: string,
    accountId: string,
    trigger: FulfillmentTrigger,
    actorUserId?: string,
  ): Promise<CatalogSyncResult> {
    const account = await this.repo.findAccountById(organizationId, accountId);
    if (!account) throw new FulfillmentAccountNotFoundException();

    const startedAt = new Date();
    const scope: CatalogScope = {
      organizationId,
      accountId: account.id,
      provider: account.provider,
    };

    try {
      const result = await this.runSync(scope, account, startedAt);
      await this.writeSyncLog(scope, trigger, startedAt, result, actorUserId, null);
      return result;
    } catch (error) {
      await this.writeSyncLog(scope, trigger, startedAt, null, actorUserId, error as Error);
      throw error;
    }
  }

  /**
   * Đồng bộ MỌI tài khoản đang bật của MỌI tổ chức — dùng cho scheduler.
   *
   * Lỗi của một tài khoản KHÔNG được làm hỏng lượt chạy của tài khoản khác: một API key hết
   * hạn ở tổ chức A không có lý do gì chặn tổ chức B cập nhật danh mục.
   */
  async syncAllAccounts(): Promise<{ accounts: number; succeeded: number; failed: number }> {
    const accounts = await this.prisma.fulfillmentAccount.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, organizationId: true, name: true },
    });

    let succeeded = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        await this.syncAccount(account.organizationId, account.id, FulfillmentTrigger.CRON);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        this.logger.error({
          module: 'fulfillment',
          operation: 'catalog.sync',
          accountId: account.id,
          organizationId: account.organizationId,
          msg: `Đồng bộ danh mục thất bại cho "${account.name}": ${(error as Error).message}`,
        });
      }
    }

    return { accounts: accounts.length, succeeded, failed };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runSync(
    scope: CatalogScope,
    account: MangoAccountCredentialRef,
    startedAt: Date,
  ): Promise<CatalogSyncResult> {
    // MỘT mốc thời gian cho cả lượt: `archiveStale` nhận diện bản ghi cũ bằng `synced_at <
    // syncedAt`, nên mỗi bước tự lấy `new Date()` sẽ khiến bản ghi ghi sớm bị archive nhầm.
    const syncedAt = new Date();
    const warnings: string[] = [];
    let apiCalls = 0;

    // --- 1. Sản phẩm (danh mục được suy ra từ đây) ---
    const productFetch = await this.mangoCatalog.fetchAllProducts(account);
    apiCalls += productFetch.apiCalls;
    if (!productFetch.complete) {
      warnings.push(
        `Danh sách sản phẩm đọc THIẾU: gom được ${productFetch.items.length}/` +
          `${productFetch.reportedTotal ?? '?'} sau ${productFetch.pagesFetched}/${productFetch.totalPages} trang.`,
      );
    }

    // --- 2. Danh mục ---
    //
    // 🔴 Mango KHÔNG có endpoint `/catalogs` (đã dò thực tế: HTTP 404). Danh mục được suy ra
    // từ cặp `catalog_id`/`catalog_name` gắn trên mỗi sản phẩm — đó là toàn bộ thông tin mà
    // nhà cung cấp cung cấp về danh mục, nên không mất gì.
    const catalogues = this.deriveCatalogues(productFetch.items);
    const catalogueIds = await this.catalogRepo.upsertCatalogues(scope, catalogues, syncedAt);

    // --- 3. Sản phẩm xuống DB ---
    const products = productFetch.items
      .filter((item) => Boolean(item.id))
      .map((item) => this.toProductInput(item));
    const productIds = await this.catalogRepo.upsertProducts(
      scope,
      products,
      catalogueIds,
      syncedAt,
    );

    // --- 4. Biến thể ---
    const {
      variants,
      apiCalls: variantCalls,
      incomplete,
    } = await this.fetchVariants(account, productFetch.items);
    apiCalls += variantCalls;
    warnings.push(...incomplete);

    const variantsWritten = await this.catalogRepo.upsertVariants(
      scope,
      variants,
      productIds,
      syncedAt,
    );

    // --- 5. Ghi nhận chênh lệch với `variations_count` (CHỈ để tham khảo) ---
    this.logVariationCountGap(scope, productFetch.items, variants);

    // --- 6. Archive bản ghi không còn tồn tại — CHỈ khi lượt đọc đầy đủ ---
    const complete = warnings.length === 0;
    const archived = complete
      ? await this.catalogRepo.archiveStale(scope, syncedAt)
      : { catalogues: 0, products: 0, variants: 0 };

    if (!complete) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.sync',
        accountId: scope.accountId,
        warnings: warnings.length,
        msg:
          'Lượt đồng bộ đọc THIẾU nên BỎ QUA bước đánh dấu ngừng bán. ' +
          'Bản ghi cũ được giữ nguyên để không xoá nhầm danh mục khỏi các ô chọn.',
      });
    }

    const result: CatalogSyncResult = {
      accountId: scope.accountId,
      provider: scope.provider,
      catalogues: catalogues.length,
      products: products.length,
      variants: variantsWritten,
      archivedCatalogues: archived.catalogues,
      archivedProducts: archived.products,
      archivedVariants: archived.variants,
      apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      complete,
      warnings,
    };

    this.logger.log({
      module: 'fulfillment',
      operation: 'catalog.sync',
      organizationId: scope.organizationId,
      ...result,
      msg:
        `Đồng bộ danh mục: ${result.catalogues} danh mục · ${result.products} sản phẩm · ` +
        `${result.variants} biến thể (${apiCalls} lời gọi API)`,
    });

    return result;
  }

  /**
   * Đọc biến thể của mọi sản phẩm, song song có giới hạn.
   *
   * Không dùng `Promise.all` trên toàn bộ danh sách: 2000 lời gọi cùng lúc sẽ dựng 2000 kết
   * nối và làm nghẽn cả tiến trình, trong khi trần tần suất phía nhà cung cấp vẫn là 10/s.
   * Trần song song ở đây chỉ để giữ bộ nhớ và số socket trong tầm kiểm soát.
   */
  private async fetchVariants(
    account: MangoAccountCredentialRef,
    products: MangoProduct[],
  ): Promise<{ variants: VariantUpsertInput[]; apiCalls: number; incomplete: string[] }> {
    const withId = products.filter((product): product is MangoProduct & { id: string } =>
      Boolean(product.id),
    );

    const variants: VariantUpsertInput[] = [];
    const incomplete: string[] = [];
    let apiCalls = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= withId.length) return;

        const product = withId[index];
        const fetched = await this.mangoCatalog.fetchAllVariations(account, product.id);
        apiCalls += fetched.apiCalls;

        if (!fetched.complete) {
          incomplete.push(
            `Biến thể của sản phẩm ${product.id} đọc THIẾU: ` +
              `${fetched.items.length}/${fetched.reportedTotal ?? '?'}.`,
          );
        }

        for (const variation of fetched.items) {
          if (!variation.id || !variation.sku) continue;
          variants.push(this.toVariantInput(product.id, variation));
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MANGO_CATALOG_SYNC.concurrency, withId.length) }, worker),
    );

    return { variants, apiCalls, incomplete };
  }

  /**
   * Danh mục duy nhất suy ra từ danh sách sản phẩm.
   *
   * Sản phẩm không khai `catalog_id` thì không thuộc danh mục nào — bỏ qua, KHÔNG bịa một
   * danh mục "Khác": bịa ra một nhóm không tồn tại phía nhà cung cấp sẽ khiến người dùng
   * tưởng đó là danh mục thật.
   */
  private deriveCatalogues(products: MangoProduct[]): CatalogueUpsertInput[] {
    const byId = new Map<string, CatalogueUpsertInput>();
    for (const product of products) {
      const id = product.catalog_id?.trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, { externalCatalogueId: id, name: product.catalog_name?.trim() || id });
    }
    return [...byId.values()];
  }

  /**
   * Ghi nhật ký chênh lệch giữa `products[].variations_count` và số biến thể thực nhận.
   *
   * 🔴 **KHÔNG phải thước đo đọc đủ hay thiếu, và cố ý KHÔNG ảnh hưởng tới `complete`.**
   *
   * Đo thực tế trên API thật cho thấy hai con số này đến từ hai nguồn khác nhau và không
   * bằng nhau: sản phẩm `Youth's T-shirt | Gildan 5000B` có `variations_count = 3440`, trong
   * khi `GET /products/{id}/variations` báo `pagination.total = 596` và trả về đúng 596 bản
   * ghi. `variations_count` nhiều khả năng đếm toàn bộ tổ hợp màu×size trên mọi production
   * line, còn endpoint variations chỉ trả những biến thể thực sự đặt được.
   *
   * Trước đây chênh lệch này bị tính là "đọc thiếu", kéo theo hai hậu quả nặng hơn hẳn bản
   * thân cảnh báo: mọi lượt đồng bộ đều `complete = false` (248/252 sản phẩm lệch), và vì
   * bước ARCHIVE chỉ chạy khi đọc đủ nên **sản phẩm nhà cung cấp đã ngừng bán sẽ không bao
   * giờ biến mất khỏi các ô chọn**.
   *
   * Thước đo đọc đủ/thiếu ĐÚNG là `pagination.total` của chính endpoint variations — việc đó
   * đã do `MangoCatalogService.fetchAllPages` đảm nhiệm và phản ánh qua `fetched.complete`.
   */
  private logVariationCountGap(
    scope: CatalogScope,
    products: MangoProduct[],
    variants: VariantUpsertInput[],
  ): void {
    const actual = new Map<string, number>();
    for (const variant of variants) {
      actual.set(variant.externalProductId, (actual.get(variant.externalProductId) ?? 0) + 1);
    }

    let gapProducts = 0;
    for (const product of products) {
      if (!product.id || typeof product.variations_count !== 'number') continue;
      if ((actual.get(product.id) ?? 0) < product.variations_count) gapProducts += 1;
    }
    if (gapProducts === 0) return;

    this.logger.log({
      module: 'fulfillment',
      operation: 'catalog.sync.variationCountGap',
      organizationId: scope.organizationId,
      accountId: scope.accountId,
      gapProducts,
      totalProducts: products.length,
      msg:
        `${gapProducts}/${products.length} sản phẩm có \`variations_count\` lớn hơn số biến thể ` +
        'endpoint variations trả về. Đây là chênh lệch định nghĩa giữa hai trường của nhà ' +
        'cung cấp, KHÔNG phải đọc thiếu — xem chú thích ở `logVariationCountGap`.',
    });
  }

  private toProductInput(item: MangoProduct): ProductUpsertInput {
    return {
      externalProductId: item.id as string,
      externalCatalogueId: item.catalog_id?.trim() || null,
      name: item.name?.trim() || item.sku?.trim() || (item.id as string),
      sku: item.sku?.trim() || null,
      image: item.images?.[0] ?? null,
      basePrice: item.base_price ?? null,
      currency: item.currency ?? null,
      variationsCount: typeof item.variations_count === 'number' ? item.variations_count : null,
      // Nhà cung cấp không trả cờ ⇒ coi như đang bán, để không ẩn nhầm sản phẩm hợp lệ.
      status:
        item.is_active === false
          ? FulfillmentCatalogItemStatus.INACTIVE
          : FulfillmentCatalogItemStatus.ACTIVE,
      rawData: item as unknown as Prisma.InputJsonValue,
    };
  }

  private toVariantInput(productId: string, item: MangoVariation): VariantUpsertInput {
    const parts = [item.color, item.size].filter(Boolean);
    return {
      externalProductId: productId,
      externalVariantId: item.id as string,
      sku: item.sku as string,
      name: item.name?.trim() || parts.join(' / ') || (item.sku as string),
      color: item.color ?? null,
      size: item.size ?? null,
      price: item.price ?? null,
      status:
        item.is_available === false
          ? FulfillmentCatalogItemStatus.INACTIVE
          : FulfillmentCatalogItemStatus.ACTIVE,
      rawData: item as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Ghi nhật ký đồng bộ vào `fulfillment_sync_logs` — dùng LẠI bảng đã có thay vì tạo bảng
   * nhật ký thứ hai cho cùng một khái niệm.
   *
   * Ba cột `orders*` mang ý nghĩa số bản ghi đã xử lý; ở đây là danh mục/sản phẩm/biến thể.
   * Ghi log KHÔNG được làm hỏng lượt đồng bộ: mọi lỗi ở đây đều nuốt và chỉ cảnh báo.
   */
  private async writeSyncLog(
    scope: CatalogScope,
    trigger: FulfillmentTrigger,
    startedAt: Date,
    result: CatalogSyncResult | null,
    actorUserId: string | undefined,
    error: Error | null,
  ): Promise<void> {
    try {
      await this.prisma.fulfillmentSyncLog.create({
        data: {
          organizationId: scope.organizationId,
          accountId: scope.accountId,
          provider: scope.provider,
          trigger,
          status: error ? 'FAILED' : result?.complete ? 'SUCCESS' : 'PARTIAL',
          ordersChecked: result?.products ?? 0,
          ordersUpdated: result?.variants ?? 0,
          ordersFailed: result?.warnings.length ?? 0,
          apiCalls: result?.apiCalls ?? 0,
          startedAt,
          finishedAt: new Date(),
          durationMs: result?.durationMs ?? Date.now() - startedAt.getTime(),
          errorCode: error ? 'CATALOG_SYNC_FAILED' : null,
          errorMessage: error
            ? error.message.slice(0, 2000)
            : (result?.warnings.join(' | ').slice(0, 2000) ?? null),
          triggeredBy: actorUserId ?? null,
        },
      });
    } catch (logError) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.sync.log',
        accountId: scope.accountId,
        msg: `Không ghi được nhật ký đồng bộ: ${(logError as Error).message}`,
      });
    }
  }
}
