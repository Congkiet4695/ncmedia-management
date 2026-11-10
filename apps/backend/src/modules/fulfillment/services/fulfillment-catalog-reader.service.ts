import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentCatalogRepository,
  type VariantPriceKey,
} from '../repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../repositories/fulfillment-global-catalog.repository';

type LegacyRepo = FulfillmentCatalogRepository;
type CatalogueRows = Awaited<ReturnType<LegacyRepo['listCatalogues']>>;
type ProductPage = Awaited<ReturnType<LegacyRepo['listProductsPaged']>>;
type ProductRow = NonNullable<Awaited<ReturnType<LegacyRepo['findProductById']>>>;
type VariantRows = Awaited<ReturnType<LegacyRepo['listVariants']>>;
type PriceRows = Awaited<ReturnType<LegacyRepo['findVariantsForPrice']>>;
type MatchRows = Awaited<ReturnType<LegacyRepo['loadMatchIndexRows']>>;

type ReadKeys =
  | 'listCatalogues'
  | 'listProductsPaged'
  | 'findProductById'
  | 'listVariants'
  | 'findVariantsForPrice'
  | 'loadMatchIndexRows'
  | 'lastSyncedAt'
  | 'countActive'
  | 'latestCatalogSync'
  | 'upsertCandidates';
type Async<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never;

/**
 * Hợp đồng ĐỌC danh mục mà các service phụ thuộc vào. Cả `FulfillmentCatalogRepository` (bảng cũ) lẫn
 * `FulfillmentCatalogReader` đều thoả ⇒ nơi gọi không biết (và không cần biết) nguồn nào đang trả lời.
 * Tiêm bằng `@Inject(FulfillmentCatalogReader)`.
 */
export type CatalogReadPort = { [K in ReadKeys]: Async<FulfillmentCatalogRepository[K]> };

/** Cờ đọc Global Catalog (configuration.ts → `fulfillment.globalCatalog.readEnabled`). */
export const GLOBAL_CATALOG_READ_FLAG = 'fulfillment.globalCatalog.readEnabled';

/** Vì sao một lượt đọc (cờ bật) phải dùng bảng cũ. */
type FallbackReason = 'ACCOUNT_UNKNOWN' | 'NOT_PROJECTED' | 'NOT_FOUND_IN_GLOBAL';
/** Kết quả của một lượt đọc khi cờ bật (đếm trong `readStats`). */
type ReadOutcome = 'GLOBAL' | FallbackReason | 'ERROR' | 'DIVERGENCE' | 'NOT_FOUND_BOTH';

/**
 * Phân loại fallback (Phase 3 §17) — ghi kèm mỗi dòng log để biết vì sao còn đọc bảng cũ:
 *  - A (migration): chỉ tồn tại trong lúc chuyển đổi — tài khoản chưa backfill / chưa có lượt đồng bộ sau deploy.
 *  - B (resilience): giữ lâu dài — dual write lỗi sau một lượt đồng bộ, lớp mới lỗi DB, lớp mới thiếu dòng.
 * Không có fallback loại C (nghiệp vụ): bảng cũ và lớp mới mang CÙNG dữ liệu, chỉ khác cách lưu.
 */
const FALLBACK_CLASS: Record<FallbackReason | 'ERROR', string> = {
  NOT_PROJECTED: 'A+B: chưa chiếu (chưa backfill) hoặc lượt chiếu sau đồng bộ gần nhất lỗi',
  ACCOUNT_UNKNOWN: 'A+B: sản phẩm thuộc tài khoản chưa chiếu',
  NOT_FOUND_IN_GLOBAL: 'B: lớp mới thiếu dòng mà bảng cũ có — dấu hiệu lỗi chiếu',
  ERROR: 'B: lớp mới lỗi (vd migration chưa chạy / DB)',
};
/** Khoảng tối thiểu giữa hai WARN cùng (thao tác, tài khoản, lý do). */
const FALLBACK_LOG_INTERVAL_MS = 10 * 60_000;

/**
 * FulfillmentCatalogReader — điểm ĐỌC duy nhất của danh mục nhà cung cấp cho giao diện, tra giá khi lưu
 * ánh xạ và ánh xạ tự động.
 *
 * ```
 *   GLOBAL_FULFILLMENT_CATALOG_ENABLED = false  ──▶ bảng cũ (hành vi y như trước)
 *   GLOBAL_FULFILLMENT_CATALOG_ENABLED = true
 *        ├─ tài khoản đã được chiếu xong   ──▶ provider_catalog_* + fulfillment_account_*
 *        └─ chưa chiếu / chiếu lỗi / không có dòng / lỗi DB  ──▶ bảng cũ (CÙNG tài khoản)
 * ```
 *
 * 🔴 Mọi phương thức trả ĐÚNG hình dạng của `FulfillmentCatalogRepository` và CÙNG id (dòng theo tài
 * khoản mang id của dòng cũ) ⇒ nơi gọi, DTO, giao diện và các id đã lưu trong gợi ý ánh xạ không đổi.
 *
 * 🔴 Giá luôn là giá của `accountId` được truyền vào — ở lớp mới lấy từ `fulfillment_account_variants`,
 * KHÔNG BAO GIỜ từ lớp global và không bao giờ từ một tài khoản khác. Fallback cũng giữ nguyên `accountId`.
 *
 * KHÔNG nằm trên luồng gửi đơn: `findVariantsForAccount` / `findCostCurrency` (Mango/Sellerwix adapter)
 * vẫn đọc thẳng bảng cũ — Global Catalog không phải điều kiện để tạo đơn.
 *
 * `latestCatalogSync` (nhật ký đồng bộ) và `upsertCandidates` (kết quả ánh xạ tự động) chuyển thẳng sang
 * bảng của chúng: đó không phải dữ liệu danh mục.
 *
 * Fallback KHÔNG âm thầm (Phase 3): mỗi lượt cờ-bật-mà-đọc-bảng-cũ được đếm (`readStats`) và ghi WARN (gộp
 * theo thao tác + tài khoản + lý do, tối đa 10 phút một dòng), kèm phân loại `FALLBACK_CLASS`; lớp mới thiếu
 * dòng mà bảng cũ có ⇒ WARN `GLOBAL_LEGACY_DIVERGENCE` mỗi lần; lỗi ⇒ ERROR.
 */
@Injectable()
export class FulfillmentCatalogReader implements CatalogReadPort {
  private readonly logger = new Logger(FulfillmentCatalogReader.name);
  private readonly throttle = new Map<string, { at: number; suppressed: number }>();
  private readonly stats: Record<ReadOutcome, number> = {
    GLOBAL: 0,
    ACCOUNT_UNKNOWN: 0,
    NOT_PROJECTED: 0,
    NOT_FOUND_IN_GLOBAL: 0,
    ERROR: 0,
    DIVERGENCE: 0,
    NOT_FOUND_BOTH: 0,
  };

  constructor(
    private readonly legacy: FulfillmentCatalogRepository,
    private readonly global: FulfillmentGlobalCatalogRepository,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Cờ đọc lớp mới. Không có ConfigService (kiểm thử dựng tay) ⇒ tắt. */
  get globalReadEnabled(): boolean {
    return this.config?.get<boolean>(GLOBAL_CATALOG_READ_FLAG) === true;
  }

  // ---------------------------------------------------------------------------
  // Đọc có chuyển đổi nguồn
  // ---------------------------------------------------------------------------

  async listCatalogues(
    accountId: string,
    organizationId: string,
    includeArchived = false,
  ): Promise<CatalogueRows> {
    return this.read(
      'listCatalogues',
      accountId,
      async () => {
        const rows = await this.global.listCatalogues(accountId, includeArchived);
        return rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          accountId: row.accountId,
          provider: row.provider,
          externalCatalogueId: row.globalCatalogue.externalCatalogueId,
          name: row.globalCatalogue.name,
          status: row.status,
          rawData: row.globalCatalogue.rawData,
          syncedAt: row.syncedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        }));
      },
      () => this.legacy.listCatalogues(accountId, organizationId, includeArchived),
    );
  }

  async listProductsPaged(
    params: Parameters<LegacyRepo['listProductsPaged']>[0],
  ): Promise<ProductPage> {
    return this.read(
      'listProductsPaged',
      params.accountId,
      async () => {
        const { items, total } = await this.global.listProductsPaged(params);
        const names = await this.global.catalogueNames([
          ...new Set(
            items.map((item) => item.catalogueId).filter((id): id is string => Boolean(id)),
          ),
        ]);
        return {
          total,
          items: items.map((item) => ({
            ...this.toLegacyProduct(item),
            catalogue:
              item.catalogueId && names.has(item.catalogueId)
                ? { id: item.catalogueId, name: names.get(item.catalogueId) as string }
                : null,
            _count: { variants: item._count.variants },
          })),
        };
      },
      () => this.legacy.listProductsPaged(params),
    );
  }

  /** Sản phẩm theo id. Lớp mới chỉ dùng khi tài khoản của sản phẩm đã được chiếu xong. */
  async findProductById(organizationId: string, id: string): Promise<ProductRow | null> {
    const accountId = this.globalReadEnabled ? await this.safeAccountOfProduct(id) : null;
    return this.read(
      'findProductById',
      accountId,
      async () => {
        const row = await this.global.findProductById(organizationId, id);
        if (!row) return null;
        const names = await this.global.catalogueNames(row.catalogueId ? [row.catalogueId] : []);
        return {
          ...this.toLegacyProduct(row),
          catalogue:
            row.catalogueId && names.has(row.catalogueId)
              ? { id: row.catalogueId, name: names.get(row.catalogueId) as string }
              : null,
        };
      },
      () => this.legacy.findProductById(organizationId, id),
      (result) => result === null,
    );
  }

  /**
   * Biến thể của một sản phẩm. `rawData` lấy ở lớp GLOBAL: vùng in (Sellerwix `print_areas`) và xưởng
   * (Mango `production_line`) là metadata chuẩn — giống hệt nhau giữa mọi tài khoản trên dữ liệu thật.
   */
  async listVariants(organizationId: string, productId: string): Promise<VariantRows> {
    const accountId = this.globalReadEnabled ? await this.safeAccountOfProduct(productId) : null;
    return this.read(
      'listVariants',
      accountId,
      async () => {
        const rows = await this.global.listVariants(productId);
        return rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          accountId: row.accountId,
          provider: row.provider,
          productId: row.accountProductId,
          externalVariantId: row.globalVariant.externalVariantId,
          sku: row.globalVariant.sku,
          name: row.globalVariant.name,
          color: row.globalVariant.color,
          size: row.globalVariant.size,
          price: row.price,
          status: row.status,
          rawData: row.globalVariant.rawData,
          syncedAt: row.syncedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        }));
      },
      () => this.legacy.listVariants(organizationId, productId),
    );
  }

  /** 🔴 Giá của ĐÚNG `accountId` — xem chú thích lớp. */
  async findVariantsForPrice(
    organizationId: string,
    accountId: string,
    key: VariantPriceKey,
  ): Promise<PriceRows> {
    return this.read(
      'findVariantsForPrice',
      accountId,
      async () => {
        const rows = await this.global.findVariantsForPrice(organizationId, accountId, key);
        return rows.map((row) => ({
          id: row.id,
          externalVariantId: row.globalVariant.externalVariantId,
          sku: row.globalVariant.sku,
          price: row.price,
          status: row.status,
          syncedAt: row.syncedAt,
          product: { currency: row.currency },
        }));
      },
      () => this.legacy.findVariantsForPrice(organizationId, accountId, key),
      (rows) => rows.length === 0,
    );
  }

  async loadMatchIndexRows(organizationId: string, accountId: string): Promise<MatchRows> {
    return this.read(
      'loadMatchIndexRows',
      accountId,
      async () => {
        const rows = await this.global.loadMatchIndexRows(organizationId, accountId);
        const names = await this.global.catalogueNames([
          ...new Set(
            rows
              .map((row) => row.accountProduct.catalogueId)
              .filter((id): id is string => Boolean(id)),
          ),
        ]);
        return rows.map((row) => {
          const catalogueId = row.accountProduct.catalogueId;
          return {
            id: row.id,
            externalVariantId: row.globalVariant.externalVariantId,
            sku: row.globalVariant.sku,
            name: row.globalVariant.name,
            color: row.globalVariant.color,
            size: row.globalVariant.size,
            price: row.price,
            product: {
              id: row.accountProduct.id,
              externalProductId: row.accountProduct.globalProduct.externalProductId,
              name: row.accountProduct.globalProduct.name,
              sku: row.accountProduct.globalProduct.sku,
              catalogueId,
              catalogue:
                catalogueId && names.has(catalogueId)
                  ? { id: catalogueId, name: names.get(catalogueId) as string }
                  : null,
            },
          };
        });
      },
      () => this.legacy.loadMatchIndexRows(organizationId, accountId),
    );
  }

  /** Thời điểm đồng bộ gần nhất — màn hình nói "dữ liệu lúc nào". */
  async lastSyncedAt(accountId: string): Promise<Date | null> {
    return this.read(
      'lastSyncedAt',
      accountId,
      () => this.global.lastSyncedAt(accountId),
      () => this.legacy.lastSyncedAt(accountId),
    );
  }

  /** Số danh mục / sản phẩm / biến thể / màu / size đang hoạt động của tài khoản (màn hình cấu hình). */
  async countActive(accountId: string): Promise<Awaited<ReturnType<LegacyRepo['countActive']>>> {
    return this.read(
      'countActive',
      accountId,
      () => this.global.countActive(accountId),
      () => this.legacy.countActive(accountId),
    );
  }

  // ---------------------------------------------------------------------------
  // Chuyển thẳng sang bảng cũ (nhật ký đồng bộ / kết quả ánh xạ — không phải dữ liệu danh mục)
  // ---------------------------------------------------------------------------

  latestCatalogSync(accountId: string) {
    return this.legacy.latestCatalogSync(accountId);
  }

  upsertCandidates(...args: Parameters<LegacyRepo['upsertCandidates']>) {
    return this.legacy.upsertCandidates(...args);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Chọn nguồn cho MỘT lượt đọc.
   *
   * @param accountId tài khoản quyết định "đã chiếu xong chưa"; `null` ⇒ không xác định được ⇒ bảng cũ.
   * @param isMissing kết quả lớp mới coi như THIẾU (vd không có dòng) ⇒ đọc lại bảng cũ.
   */
  private async read<T>(
    operation: string,
    accountId: string | null,
    fromGlobal: () => Promise<T>,
    fromLegacy: () => Promise<T>,
    isMissing?: (result: T) => boolean,
  ): Promise<T> {
    if (!this.globalReadEnabled) return fromLegacy();
    if (!accountId)
      return this.fallback(operation, accountId, 'ACCOUNT_UNKNOWN', fromLegacy, isMissing);

    let result: T;
    try {
      if (!(await this.global.isAccountProjected(accountId))) {
        return this.fallback(operation, accountId, 'NOT_PROJECTED', fromLegacy, isMissing);
      }
      result = await fromGlobal();
    } catch (error) {
      // Lớp mới hỏng (vd migration chưa chạy) không được làm hỏng màn hình đang chạy bằng bảng cũ.
      this.count('ERROR');
      this.logger.error({
        module: 'fulfillment',
        operation: `catalog.read.${operation}`,
        accountId,
        source: 'LEGACY',
        fallbackUsed: true,
        fallbackReason: 'ERROR',
        fallbackClass: FALLBACK_CLASS.ERROR,
        msg: `Đọc Global Catalog lỗi — dùng bảng cũ: ${(error as Error).message}`,
      });
      return fromLegacy();
    }
    if (isMissing?.(result)) {
      return this.fallback(operation, accountId, 'NOT_FOUND_IN_GLOBAL', fromLegacy, isMissing);
    }
    this.count('GLOBAL');
    this.logger.debug({
      module: 'fulfillment',
      operation: `catalog.read.${operation}`,
      accountId,
      source: 'GLOBAL',
    });
    return result;
  }

  /**
   * Đọc bảng cũ thay cho lớp mới — và nói ra điều đó (không fallback âm thầm).
   *
   * `NOT_FOUND_IN_GLOBAL` mà bảng cũ LẠI có dữ liệu ⇒ hai lớp lệch nhau trên một tài khoản đã chiếu xong:
   * dấu hiệu lỗi chiếu, ghi WARN `GLOBAL_LEGACY_DIVERGENCE` mỗi lần (không gộp). Không thấy ở cả hai nơi
   * (vd tra giá một SKU không tồn tại) là kết quả bình thường — chỉ đếm.
   */
  private async fallback<T>(
    operation: string,
    accountId: string | null,
    reason: FallbackReason,
    fromLegacy: () => Promise<T>,
    isMissing?: (result: T) => boolean,
  ): Promise<T> {
    const result = await fromLegacy();
    const legacyFound = !isMissing?.(result);
    if (reason === 'NOT_FOUND_IN_GLOBAL') {
      if (legacyFound) {
        this.count('DIVERGENCE');
        this.logger.warn({
          module: 'fulfillment',
          operation: `catalog.read.${operation}`,
          accountId,
          source: 'LEGACY',
          fallbackUsed: true,
          fallbackReason: 'GLOBAL_LEGACY_DIVERGENCE',
          fallbackClass: FALLBACK_CLASS.NOT_FOUND_IN_GLOBAL,
          msg: 'Lớp mới KHÔNG có dữ liệu mà bảng cũ có (tài khoản đã chiếu xong) — kiểm tra lượt chiếu',
        });
      } else {
        this.count('NOT_FOUND_BOTH');
      }
      return result;
    }
    this.count(reason);
    this.warnThrottled(operation, accountId, reason);
    return result;
  }

  /** WARN tối đa một lần / `FALLBACK_LOG_INTERVAL_MS` cho mỗi (thao tác, tài khoản, lý do), kèm số lần đã gộp. */
  private warnThrottled(operation: string, accountId: string | null, reason: FallbackReason) {
    const key = `${operation}|${accountId ?? '-'}|${reason}`;
    const now = Date.now();
    const entry = this.throttle.get(key);
    if (entry && now - entry.at < FALLBACK_LOG_INTERVAL_MS) {
      entry.suppressed += 1;
      return;
    }
    this.throttle.set(key, { at: now, suppressed: 0 });
    this.logger.warn({
      module: 'fulfillment',
      operation: `catalog.read.${operation}`,
      accountId,
      source: 'LEGACY',
      fallbackUsed: true,
      fallbackReason: reason,
      fallbackClass: FALLBACK_CLASS[reason],
      suppressedSinceLastLog: entry?.suppressed ?? 0,
      msg: 'Cờ Global Catalog BẬT nhưng đọc bảng cũ',
    });
  }

  private count(key: ReadOutcome) {
    this.stats[key] += 1;
  }

  /** Số lượt đọc theo kết quả kể từ khi tiến trình chạy — cho kiểm thử / chẩn đoán. */
  readStats(): Readonly<Record<ReadOutcome, number>> {
    return { ...this.stats };
  }

  /** Tài khoản của sản phẩm ở lớp mới; lỗi (vd bảng chưa có) ⇒ null ⇒ bảng cũ. */
  private async safeAccountOfProduct(productId: string): Promise<string | null> {
    try {
      return await this.global.accountOfProduct(productId);
    } catch {
      return null;
    }
  }

  private toLegacyProduct(
    row:
      | Awaited<
          ReturnType<FulfillmentGlobalCatalogRepository['listProductsPaged']>
        >['items'][number]
      | NonNullable<Awaited<ReturnType<FulfillmentGlobalCatalogRepository['findProductById']>>>,
  ) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      provider: row.provider,
      catalogueId: row.catalogueId,
      externalProductId: row.globalProduct.externalProductId,
      name: row.globalProduct.name,
      sku: row.globalProduct.sku,
      image: row.globalProduct.image,
      basePrice: row.basePrice,
      currency: row.currency,
      variationsCount: row.variationsCount,
      status: row.status,
      rawData: row.rawData,
      syncedAt: row.syncedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
