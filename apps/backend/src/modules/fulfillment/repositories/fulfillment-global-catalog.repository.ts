import { Injectable } from '@nestjs/common';
import { FulfillmentCatalogItemStatus, FulfillmentProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { FulfillmentRepository } from './fulfillment.repository';
import type { VariantPriceKey } from './fulfillment-catalog.repository';
import { rawScopeOf, VARIANT_TIER_PATH, type CatalogLevel } from '../shared/global-catalog-scope';

/** Kết quả chiếu MỘT cấp global (danh mục / sản phẩm / biến thể) của một tài khoản. */
export interface GlobalLevelReport {
  /** Số bản ghi khác nhau của tài khoản này ở cấp đó (đầu vào). */
  processed: number;
  /** Bản ghi global mới tạo. */
  inserted: number;
  /** Bản ghi global đã có từ trước (tài khoản khác / lượt trước) — dùng lại, không tạo thêm. */
  reused: number;
  /** Đã có, nhưng metadata chuẩn KHÁC dữ liệu của tài khoản này. */
  conflicts: number;
  /** Trong số xung đột: KHÔNG ghi đè vì bản global đến từ nguồn đồng bộ MỚI hơn. */
  conflictsSkipped: number;
  /** Vài id phía nhà cung cấp bị xung đột — để đối soát, không phải danh sách đầy đủ. */
  conflictSample: string[];
}

/** Kết quả chiếu MỘT cấp theo tài khoản. */
export interface AccountLevelReport {
  inserted: number;
  updated: number;
}

export interface GlobalCatalogProjectionReport {
  accountId: string;
  provider: FulfillmentProvider;
  catalogues: GlobalLevelReport;
  products: GlobalLevelReport;
  variants: GlobalLevelReport;
  accountCatalogues: AccountLevelReport;
  accountProducts: AccountLevelReport;
  accountVariants: AccountLevelReport;
  durationMs: number;
}

interface LevelRow {
  processed: bigint;
  reused: bigint;
  conflicts: bigint;
  conflicts_skipped: bigint;
  conflict_sample: string[] | null;
}

interface AccountRow {
  inserted: bigint;
  updated: bigint;
}

/** Ném ra để ROLLBACK lượt chạy thử — không phải lỗi. */
class DryRunRollback extends Error {
  constructor() {
    super('GLOBAL_CATALOG_DRY_RUN_ROLLBACK');
  }
}

/** Một lượt chiếu (6 câu lệnh tập hợp) cho tài khoản lớn nhất ~40 nghìn biến thể. */
const PROJECTION_TX_TIMEOUT_MS = 5 * 60_000;
/** Bảng của lớp mới được phép ANALYZE (danh sách đóng — xem `analyzeIfStale`). */
type GlobalCatalogTable =
  | 'provider_catalog_catalogues'
  | 'provider_catalog_products'
  | 'provider_catalog_variants'
  | 'fulfillment_account_products'
  | 'fulfillment_account_variants';
/** ANALYZE khi số dòng mới ≥ max(ngưỡng, tỉ lệ × số dòng planner đang biết). */
const ANALYZE_MIN_NEW_ROWS = 1_000;
const ANALYZE_GROWTH_RATIO = 0.2;
/** Số id xung đột giữ lại làm mẫu. */
const CONFLICT_SAMPLE = 5;

/**
 * FulfillmentGlobalCatalogRepository — GHI và ĐỌC lớp Global Catalog.
 *
 * ```
 *   fulfillment_catalogues / products / variants   (bản cũ, theo tài khoản — luồng đồng bộ vẫn ghi)
 *            │  projectAccount(accountId)  — INSERT … SELECT, theo tập hợp, trong MỘT transaction
 *            ▼
 *   provider_catalog_*      (GLOBAL: danh tính + metadata chuẩn, không giá)
 *   fulfillment_account_*   (THEO TÀI KHOẢN: giá, đơn vị tiền, trạng thái, tier, raw nguyên văn)
 * ```
 *
 * 🔴 Vì sao CHIẾU từ bảng cũ thay vì chuẩn hoá payload nhà cung cấp lần thứ hai: bảng cũ vừa được ghi
 * từ đúng payload đó trong cùng lượt đồng bộ, theo đúng luật chuẩn hoá đang chạy. Một nguồn chuẩn hoá
 * ⇒ lớp mới không thể lệch lớp cũ, và backfill dùng CHÍNH hàm này (không có code backfill riêng).
 * Không gọi API nhà cung cấp, không giữ dữ liệu trong bộ nhớ (mọi bước là một câu lệnh SQL tập hợp).
 *
 * Danh tính global: `(provider, external_*_id)` — KHÔNG BAO GIỜ SKU (Mango: nhiều variation chung SKU).
 * Xung đột metadata giữa các tài khoản: ghi đè chỉ khi nguồn có `synced_at` MỚI HƠN HOẶC BẰNG bản đang
 * giữ (tất định); mọi xung đột được đếm + lấy mẫu, payload nguyên văn của từng tài khoản vẫn ở lớp
 * theo tài khoản nên không mất gì.
 */
@Injectable()
export class FulfillmentGlobalCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Ghi — chiếu bảng cũ của MỘT tài khoản sang lớp mới
  // ---------------------------------------------------------------------------

  /** Chiếu MỘT tài khoản trong MỘT transaction (dual write sau đồng bộ, backfill `--apply`). */
  projectAccount(
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<GlobalCatalogProjectionReport> {
    return this.prisma.$transaction((tx) => this.projectInTx(tx, accountId, provider), {
      timeout: PROJECTION_TX_TIMEOUT_MS,
      maxWait: PROJECTION_TX_TIMEOUT_MS,
    });
  }

  /**
   * Chiếu NHIỀU tài khoản theo đúng thứ tự truyền vào, trong MỘT transaction rồi ROLLBACK — báo cáo chính
   * xác "nếu chạy thật thì sẽ ra sao" (tài khoản sau thấy bản ghi global do tài khoản trước tạo), không ghi gì.
   */
  async dryRunAccounts(
    accounts: Array<{ id: string; provider: FulfillmentProvider }>,
  ): Promise<GlobalCatalogProjectionReport[]> {
    const reports: GlobalCatalogProjectionReport[] = [];
    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const account of accounts)
            reports.push(await this.projectInTx(tx, account.id, account.provider));
          throw new DryRunRollback();
        },
        {
          timeout: PROJECTION_TX_TIMEOUT_MS * Math.max(1, accounts.length),
          maxWait: PROJECTION_TX_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }
    return reports;
  }

  private async projectInTx(
    tx: Prisma.TransactionClient,
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<GlobalCatalogProjectionReport> {
    const startedAt = Date.now();
    // Một lượt chiếu mỗi nhà cung cấp tại một thời điểm: các tài khoản cùng nhà cung cấp ghi chung bản ghi
    // global — tuần tự hoá thì không có deadlock và luật "nguồn mới hơn thắng" không chạy đua.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`global-catalog:${provider}`}))`;

    const catalogues = await this.projectGlobalCatalogues(tx, accountId, provider);
    await this.analyzeIfStale(tx, 'provider_catalog_catalogues', catalogues.inserted);
    const accountCatalogues = await this.projectAccountCatalogues(tx, accountId);
    const products = await this.projectGlobalProducts(tx, accountId, provider);
    await this.analyzeIfStale(tx, 'provider_catalog_products', products.inserted);
    const accountProducts = await this.projectAccountProducts(tx, accountId);
    await this.analyzeIfStale(tx, 'fulfillment_account_products', accountProducts.inserted);
    const variants = await this.projectGlobalVariants(tx, accountId, provider);
    await this.analyzeIfStale(tx, 'provider_catalog_variants', variants.inserted);
    const accountVariants = await this.projectAccountVariants(tx, accountId, provider);
    await this.analyzeIfStale(tx, 'fulfillment_account_variants', accountVariants.inserted);

    return {
      accountId,
      provider,
      catalogues,
      products,
      variants,
      accountCatalogues,
      accountProducts,
      accountVariants,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Cập nhật thống kê của bảng lớp mới khi nó vừa lớn lên đáng kể (lần backfill đầu / tài khoản mới).
   *
   * 🔴 Đo thực tế: bảng CHƯA từng ANALYZE ⇒ planner coi như rỗng ⇒ chọn nested loop + seq scan ⇒ câu
   * chiếu biến thể của một tài khoản 40 nghìn dòng mất 161 giây thay vì ~2 giây. ANALYZE chạy được trong
   * transaction (và thấy cả dòng transaction này vừa ghi), lấy mẫu nên chỉ tốn khoảng một giây. Lượt đồng
   * bộ bình thường (bảng đã có thống kê, ít dòng mới) không chạy ANALYZE.
   */
  private async analyzeIfStale(
    tx: Prisma.TransactionClient,
    table: GlobalCatalogTable,
    inserted: number,
  ) {
    if (inserted === 0) return;
    const [row] = await tx.$queryRaw<Array<{ reltuples: number }>>`
      SELECT reltuples::float8 AS reltuples FROM pg_class WHERE oid = ${table}::regclass`;
    const known = row?.reltuples ?? -1;
    if (known >= 0 && inserted < Math.max(ANALYZE_MIN_NEW_ROWS, known * ANALYZE_GROWTH_RATIO))
      return;
    // Tên bảng lấy từ danh sách hằng (`GlobalCatalogTable`) — không bao giờ từ đầu vào.
    await tx.$executeRawUnsafe(`ANALYZE "${table}"`);
  }

  /** `raw - keys #- path` theo đúng `GLOBAL_CATALOG_RAW_SCOPE`; nhà cung cấp chưa khai ⇒ NULL. */
  private canonicalRawSql(
    level: CatalogLevel,
    provider: FulfillmentProvider,
    column: Prisma.Sql,
  ): Prisma.Sql {
    const scope = rawScopeOf(level, provider);
    if (!scope) return Prisma.sql`NULL::jsonb`;
    const dropped =
      scope.dropKeys.length > 0 ? Prisma.sql`(${column} - ${scope.dropKeys}::text[])` : column;
    const stripped = scope.dropPath
      ? Prisma.sql`(${dropped} #- ${scope.dropPath}::text[])`
      : dropped;
    return Prisma.sql`CASE WHEN jsonb_typeof(${column}) = 'object' THEN ${stripped} ELSE ${column} END`;
  }

  private async projectGlobalCatalogues(
    tx: Prisma.TransactionClient,
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<GlobalLevelReport> {
    const raw = this.canonicalRawSql('catalogue', provider, Prisma.sql`c.raw_data`);
    const rows = await tx.$queryRaw<LevelRow[]>`
      WITH src AS (
        SELECT c.external_catalogue_id AS ext, c.name, ${raw} AS raw, c.synced_at
        FROM fulfillment_catalogues c
        WHERE c.account_id = ${accountId}::uuid AND c.deleted_at IS NULL
        ORDER BY c.external_catalogue_id
      ),
      prev AS (
        SELECT g.external_catalogue_id AS ext, g.name, g.raw_data AS raw, g.source_synced_at
        FROM provider_catalog_catalogues g
        JOIN src ON src.ext = g.external_catalogue_id
        WHERE g.provider = ${provider}::"fulfillment_provider"
      ),
      diff AS (
        SELECT prev.ext, prev.source_synced_at > src.synced_at AS older
        FROM prev JOIN src USING (ext)
        WHERE prev.name IS DISTINCT FROM src.name OR prev.raw IS DISTINCT FROM src.raw
      ),
      up AS (
        INSERT INTO provider_catalog_catalogues
          (id, provider, external_catalogue_id, name, raw_data, source_account_id, source_synced_at, created_at, updated_at)
        SELECT gen_random_uuid(), ${provider}::"fulfillment_provider", ext, name, raw, ${accountId}::uuid, synced_at,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM src
        ON CONFLICT (provider, external_catalogue_id) DO UPDATE SET
          name              = EXCLUDED.name,
          raw_data          = EXCLUDED.raw_data,
          source_account_id = EXCLUDED.source_account_id,
          source_synced_at  = EXCLUDED.source_synced_at,
          updated_at        = CURRENT_TIMESTAMP,
          deleted_at        = NULL
        WHERE provider_catalog_catalogues.source_synced_at <= EXCLUDED.source_synced_at
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM src)                       AS processed,
             (SELECT COUNT(*) FROM prev)                      AS reused,
             (SELECT COUNT(*) FROM diff)                      AS conflicts,
             (SELECT COUNT(*) FROM diff WHERE older)          AS conflicts_skipped,
             (SELECT array_agg(ext) FROM (SELECT ext FROM diff ORDER BY ext LIMIT ${CONFLICT_SAMPLE}) s) AS conflict_sample,
             (SELECT COUNT(*) FROM up)                        AS written`;
    return this.toLevelReport(rows[0]);
  }

  private async projectAccountCatalogues(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<AccountLevelReport> {
    const rows = await tx.$queryRaw<AccountRow[]>`
      WITH up AS (
        INSERT INTO fulfillment_account_catalogues
          (id, organization_id, account_id, provider, global_catalogue_id, status, synced_at,
           created_at, updated_at, deleted_at)
        SELECT c.id, c.organization_id, c.account_id, c.provider, g.id, c.status, c.synced_at,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c.deleted_at
        FROM fulfillment_catalogues c
        JOIN provider_catalog_catalogues g
          ON g.provider = c.provider AND g.external_catalogue_id = c.external_catalogue_id
        WHERE c.account_id = ${accountId}::uuid
        ORDER BY g.id
        ON CONFLICT (account_id, global_catalogue_id) DO UPDATE SET
          status     = EXCLUDED.status,
          synced_at  = EXCLUDED.synced_at,
          updated_at = CURRENT_TIMESTAMP,
          deleted_at = EXCLUDED.deleted_at
        RETURNING (xmax = 0) AS inserted
      )
      SELECT COUNT(*) FILTER (WHERE inserted) AS inserted, COUNT(*) FILTER (WHERE NOT inserted) AS updated FROM up`;
    return this.toAccountReport(rows[0]);
  }

  private async projectGlobalProducts(
    tx: Prisma.TransactionClient,
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<GlobalLevelReport> {
    const raw = this.canonicalRawSql('product', provider, Prisma.sql`p.raw_data`);
    const rows = await tx.$queryRaw<LevelRow[]>`
      WITH src AS (
        SELECT p.external_product_id AS ext, p.name, p.sku, p.image, gc.id AS catalogue_id, ${raw} AS raw, p.synced_at
        FROM fulfillment_products p
        LEFT JOIN fulfillment_catalogues c ON c.id = p.catalogue_id
        LEFT JOIN provider_catalog_catalogues gc
          ON gc.provider = p.provider AND gc.external_catalogue_id = c.external_catalogue_id
        WHERE p.account_id = ${accountId}::uuid AND p.deleted_at IS NULL
        ORDER BY p.external_product_id
      ),
      prev AS (
        SELECT g.external_product_id AS ext, g.name, g.sku, g.image, g.catalogue_id, g.raw_data AS raw, g.source_synced_at
        FROM provider_catalog_products g
        JOIN src ON src.ext = g.external_product_id
        WHERE g.provider = ${provider}::"fulfillment_provider"
      ),
      diff AS (
        SELECT prev.ext, prev.source_synced_at > src.synced_at AS older
        FROM prev JOIN src USING (ext)
        WHERE prev.name IS DISTINCT FROM src.name
           OR prev.sku IS DISTINCT FROM src.sku
           OR prev.image IS DISTINCT FROM src.image
           OR prev.catalogue_id IS DISTINCT FROM src.catalogue_id
           OR prev.raw IS DISTINCT FROM src.raw
      ),
      up AS (
        INSERT INTO provider_catalog_products
          (id, provider, catalogue_id, external_product_id, name, sku, image, raw_data,
           source_account_id, source_synced_at, created_at, updated_at)
        SELECT gen_random_uuid(), ${provider}::"fulfillment_provider", catalogue_id, ext, name, sku, image, raw,
               ${accountId}::uuid, synced_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM src
        ON CONFLICT (provider, external_product_id) DO UPDATE SET
          catalogue_id      = EXCLUDED.catalogue_id,
          name              = EXCLUDED.name,
          sku               = EXCLUDED.sku,
          image             = EXCLUDED.image,
          raw_data          = EXCLUDED.raw_data,
          source_account_id = EXCLUDED.source_account_id,
          source_synced_at  = EXCLUDED.source_synced_at,
          updated_at        = CURRENT_TIMESTAMP,
          deleted_at        = NULL
        WHERE provider_catalog_products.source_synced_at <= EXCLUDED.source_synced_at
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM src)                       AS processed,
             (SELECT COUNT(*) FROM prev)                      AS reused,
             (SELECT COUNT(*) FROM diff)                      AS conflicts,
             (SELECT COUNT(*) FROM diff WHERE older)          AS conflicts_skipped,
             (SELECT array_agg(ext) FROM (SELECT ext FROM diff ORDER BY ext LIMIT ${CONFLICT_SAMPLE}) s) AS conflict_sample,
             (SELECT COUNT(*) FROM up)                        AS written`;
    return this.toLevelReport(rows[0]);
  }

  private async projectAccountProducts(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<AccountLevelReport> {
    const rows = await tx.$queryRaw<AccountRow[]>`
      WITH up AS (
        INSERT INTO fulfillment_account_products
          (id, organization_id, account_id, provider, global_product_id, catalogue_id, base_price, currency,
           variations_count, status, raw_data, synced_at, created_at, updated_at, deleted_at)
        SELECT p.id, p.organization_id, p.account_id, p.provider, g.id, p.catalogue_id, p.base_price, p.currency,
               p.variations_count, p.status, p.raw_data, p.synced_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, p.deleted_at
        FROM fulfillment_products p
        JOIN provider_catalog_products g
          ON g.provider = p.provider AND g.external_product_id = p.external_product_id
        WHERE p.account_id = ${accountId}::uuid
        ORDER BY g.id
        ON CONFLICT (account_id, global_product_id) DO UPDATE SET
          catalogue_id     = EXCLUDED.catalogue_id,
          base_price       = EXCLUDED.base_price,
          currency         = EXCLUDED.currency,
          variations_count = EXCLUDED.variations_count,
          status           = EXCLUDED.status,
          raw_data         = EXCLUDED.raw_data,
          synced_at        = EXCLUDED.synced_at,
          updated_at       = CURRENT_TIMESTAMP,
          deleted_at       = EXCLUDED.deleted_at
        RETURNING (xmax = 0) AS inserted
      )
      SELECT COUNT(*) FILTER (WHERE inserted) AS inserted, COUNT(*) FILTER (WHERE NOT inserted) AS updated FROM up`;
    return this.toAccountReport(rows[0]);
  }

  private async projectGlobalVariants(
    tx: Prisma.TransactionClient,
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<GlobalLevelReport> {
    const raw = this.canonicalRawSql('variant', provider, Prisma.sql`v.raw_data`);
    const rows = await tx.$queryRaw<LevelRow[]>`
      WITH src AS (
        SELECT v.external_variant_id AS ext, gp.id AS product_id, v.sku, v.name, v.color, v.size,
               ${raw} AS raw, v.synced_at
        FROM fulfillment_variants v
        JOIN fulfillment_products p ON p.id = v.product_id
        JOIN provider_catalog_products gp
          ON gp.provider = p.provider AND gp.external_product_id = p.external_product_id
        WHERE v.account_id = ${accountId}::uuid AND v.deleted_at IS NULL
        ORDER BY v.external_variant_id
      ),
      prev AS (
        SELECT g.external_variant_id AS ext, g.product_id, g.sku, g.name, g.color, g.size, g.raw_data AS raw,
               g.source_synced_at
        FROM provider_catalog_variants g
        JOIN src ON src.ext = g.external_variant_id
        WHERE g.provider = ${provider}::"fulfillment_provider"
      ),
      diff AS (
        SELECT prev.ext, prev.source_synced_at > src.synced_at AS older
        FROM prev JOIN src USING (ext)
        WHERE prev.product_id IS DISTINCT FROM src.product_id
           OR prev.sku IS DISTINCT FROM src.sku
           OR prev.name IS DISTINCT FROM src.name
           OR prev.color IS DISTINCT FROM src.color
           OR prev.size IS DISTINCT FROM src.size
           OR prev.raw IS DISTINCT FROM src.raw
      ),
      up AS (
        INSERT INTO provider_catalog_variants
          (id, provider, product_id, external_variant_id, sku, name, color, size, raw_data,
           source_account_id, source_synced_at, created_at, updated_at)
        SELECT gen_random_uuid(), ${provider}::"fulfillment_provider", product_id, ext, sku, name, color, size, raw,
               ${accountId}::uuid, synced_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM src
        ON CONFLICT (provider, external_variant_id) DO UPDATE SET
          product_id        = EXCLUDED.product_id,
          sku               = EXCLUDED.sku,
          name              = EXCLUDED.name,
          color             = EXCLUDED.color,
          size              = EXCLUDED.size,
          raw_data          = EXCLUDED.raw_data,
          source_account_id = EXCLUDED.source_account_id,
          source_synced_at  = EXCLUDED.source_synced_at,
          updated_at        = CURRENT_TIMESTAMP,
          deleted_at        = NULL
        WHERE provider_catalog_variants.source_synced_at <= EXCLUDED.source_synced_at
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM src)                       AS processed,
             (SELECT COUNT(*) FROM prev)                      AS reused,
             (SELECT COUNT(*) FROM diff)                      AS conflicts,
             (SELECT COUNT(*) FROM diff WHERE older)          AS conflicts_skipped,
             (SELECT array_agg(ext) FROM (SELECT ext FROM diff ORDER BY ext LIMIT ${CONFLICT_SAMPLE}) s) AS conflict_sample,
             (SELECT COUNT(*) FROM up)                        AS written`;
    return this.toLevelReport(rows[0]);
  }

  private async projectAccountVariants(
    tx: Prisma.TransactionClient,
    accountId: string,
    provider: FulfillmentProvider,
  ): Promise<AccountLevelReport> {
    const tierPath = VARIANT_TIER_PATH[provider] ?? null;
    const tier = tierPath
      ? Prisma.sql`LEFT(v.raw_data #>> ${tierPath}::text[], 64)`
      : Prisma.sql`NULL::varchar`;
    const rows = await tx.$queryRaw<AccountRow[]>`
      WITH up AS (
        INSERT INTO fulfillment_account_variants
          (id, organization_id, account_id, provider, account_product_id, global_variant_id, price, currency, tier,
           status, raw_data, synced_at, created_at, updated_at, deleted_at)
        SELECT v.id, v.organization_id, v.account_id, v.provider, ap.id, g.id, v.price, ap.currency, ${tier},
               v.status, v.raw_data, v.synced_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v.deleted_at
        FROM fulfillment_variants v
        JOIN fulfillment_account_products ap ON ap.id = v.product_id
        JOIN provider_catalog_variants g
          ON g.provider = v.provider AND g.external_variant_id = v.external_variant_id
        WHERE v.account_id = ${accountId}::uuid
        ORDER BY g.id
        ON CONFLICT (account_id, global_variant_id) DO UPDATE SET
          account_product_id = EXCLUDED.account_product_id,
          price              = EXCLUDED.price,
          currency           = EXCLUDED.currency,
          tier               = EXCLUDED.tier,
          status             = EXCLUDED.status,
          raw_data           = EXCLUDED.raw_data,
          synced_at          = EXCLUDED.synced_at,
          updated_at         = CURRENT_TIMESTAMP,
          deleted_at         = EXCLUDED.deleted_at
        RETURNING (xmax = 0) AS inserted
      )
      SELECT COUNT(*) FILTER (WHERE inserted) AS inserted, COUNT(*) FILTER (WHERE NOT inserted) AS updated FROM up`;
    return this.toAccountReport(rows[0]);
  }

  private toLevelReport(row: LevelRow | undefined): GlobalLevelReport {
    const processed = Number(row?.processed ?? 0);
    const reused = Number(row?.reused ?? 0);
    return {
      processed,
      inserted: processed - reused,
      reused,
      conflicts: Number(row?.conflicts ?? 0),
      conflictsSkipped: Number(row?.conflicts_skipped ?? 0),
      conflictSample: row?.conflict_sample ?? [],
    };
  }

  private toAccountReport(row: AccountRow | undefined): AccountLevelReport {
    return { inserted: Number(row?.inserted ?? 0), updated: Number(row?.updated ?? 0) };
  }

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  /**
   * Lớp mới của tài khoản đã theo kịp bảng cũ chưa.
   *
   * Lượt chiếu là MỘT transaction ⇒ sản phẩm theo kịp thì biến thể cũng theo kịp. Chưa chiếu lần nào /
   * lượt chiếu sau đồng bộ gần nhất bị lỗi ⇒ `false` ⇒ bên đọc rơi về bảng cũ (không đọc dữ liệu cũ hơn).
   */
  async isAccountProjected(accountId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ legacy: Date | null; projected: Date | null }>
    >`
      SELECT (SELECT MAX(synced_at) FROM fulfillment_products
              WHERE account_id = ${accountId}::uuid AND deleted_at IS NULL)         AS legacy,
             (SELECT MAX(synced_at) FROM fulfillment_account_products
              WHERE account_id = ${accountId}::uuid AND deleted_at IS NULL)         AS projected`;
    if (!row?.projected) return false;
    return !row.legacy || row.projected.getTime() >= row.legacy.getTime();
  }

  /** Thời điểm đồng bộ gần nhất của tài khoản ở lớp mới (cùng ý nghĩa `FulfillmentCatalogRepository.lastSyncedAt`). */
  async lastSyncedAt(accountId: string): Promise<Date | null> {
    const row = await this.prisma.fulfillmentAccountProduct.findFirst({
      where: { accountId, deletedAt: null },
      select: { syncedAt: true },
      orderBy: { syncedAt: 'desc' },
    });
    return row?.syncedAt ?? null;
  }

  /** Số bản ghi đang hoạt động của tài khoản (cùng hình dạng `FulfillmentCatalogRepository.countActive`). */
  async countActive(accountId: string) {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        catalogues: bigint;
        products: bigint;
        variants: bigint;
        colors: bigint;
        sizes: bigint;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM fulfillment_account_catalogues
          WHERE account_id = ${accountId}::uuid AND deleted_at IS NULL AND status = 'ACTIVE') AS catalogues,
        (SELECT COUNT(*) FROM fulfillment_account_products
          WHERE account_id = ${accountId}::uuid AND deleted_at IS NULL AND status = 'ACTIVE') AS products,
        COUNT(*) AS variants,
        COUNT(DISTINCT g.color) AS colors,
        COUNT(DISTINCT g.size) AS sizes
      FROM fulfillment_account_variants av
      JOIN provider_catalog_variants g ON g.id = av.global_variant_id
      WHERE av.account_id = ${accountId}::uuid AND av.deleted_at IS NULL AND av.status = 'ACTIVE'`;
    return {
      catalogues: Number(row?.catalogues ?? 0),
      products: Number(row?.products ?? 0),
      variants: Number(row?.variants ?? 0),
      colors: Number(row?.colors ?? 0),
      sizes: Number(row?.sizes ?? 0),
    };
  }

  /** Tài khoản của một sản phẩm theo tài khoản (id = id sản phẩm cũ). */
  async accountOfProduct(productId: string): Promise<string | null> {
    const row = await this.prisma.fulfillmentAccountProduct.findUnique({
      where: { id: productId },
      select: { accountId: true },
    });
    return row?.accountId ?? null;
  }

  listCatalogues(accountId: string, includeArchived = false) {
    return this.prisma.fulfillmentAccountCatalogue.findMany({
      where: {
        accountId,
        deletedAt: null,
        ...(includeArchived ? {} : { status: FulfillmentCatalogItemStatus.ACTIVE }),
      },
      include: {
        globalCatalogue: { select: { externalCatalogueId: true, name: true, rawData: true } },
      },
      orderBy: [{ globalCatalogue: { name: 'asc' } }, { id: 'asc' }],
    });
  }

  /** Tên danh mục theo id (tay cầm) — MỘT truy vấn cho cả trang sản phẩm. */
  async catalogueNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.fulfillmentAccountCatalogue.findMany({
      where: { id: { in: ids } },
      select: { id: true, globalCatalogue: { select: { name: true } } },
    });
    return new Map(rows.map((row) => [row.id, row.globalCatalogue.name]));
  }

  async listProductsPaged(params: {
    accountId: string;
    catalogueId?: string;
    search?: string;
    externalProductId?: string;
    page: number;
    limit: number;
  }) {
    const keyword = params.search?.trim();
    const exactId = params.externalProductId?.trim();
    const where: Prisma.FulfillmentAccountProductWhereInput = {
      accountId: params.accountId,
      deletedAt: null,
      status: FulfillmentCatalogItemStatus.ACTIVE,
      ...(params.catalogueId ? { catalogueId: params.catalogueId } : {}),
      globalProduct: {
        ...(exactId ? { externalProductId: exactId } : {}),
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: 'insensitive' } },
                { sku: { contains: keyword, mode: 'insensitive' } },
                { externalProductId: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.fulfillmentAccountProduct.findMany({
        where,
        include: {
          globalProduct: true,
          _count: {
            select: {
              variants: { where: { deletedAt: null, status: FulfillmentCatalogItemStatus.ACTIVE } },
            },
          },
        },
        // Cùng thứ tự với bản cũ: tên rồi id (id = id sản phẩm cũ ⇒ phân trang trùng khớp từng dòng).
        orderBy: [{ globalProduct: { name: 'asc' } }, { id: 'asc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.fulfillmentAccountProduct.count({ where }),
    ]);
    return { items, total };
  }

  /** Sản phẩm theo id — CHỈ khi tài khoản của nó dùng được với tổ chức (giống bản cũ). */
  findProductById(organizationId: string, id: string) {
    return this.prisma.fulfillmentAccountProduct.findFirst({
      where: {
        id,
        deletedAt: null,
        account: FulfillmentRepository.usableAccountWhere(organizationId),
      },
      include: { globalProduct: true },
    });
  }

  listVariants(productId: string) {
    return this.prisma.fulfillmentAccountVariant.findMany({
      where: {
        accountProductId: productId,
        deletedAt: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
      },
      include: { globalVariant: true },
      // Cùng thứ tự với bản cũ (tên, SKU). `id` chỉ phá thế hoà: Mango có nhiều variation CHUNG tên + SKU (khác
      // production line) — bản cũ để thứ tự của nhóm hoà là không xác định, ở đây cố định cho tất định.
      orderBy: [
        { globalVariant: { name: 'asc' } },
        { globalVariant: { sku: 'asc' } },
        { id: 'asc' },
      ],
    });
  }

  /**
   * Biến thể để tra GIÁ — 🔴 của ĐÚNG `accountId`, giá lấy ở lớp THEO TÀI KHOẢN (lớp global không có giá).
   * Cùng thứ tự khoá với bản cũ: id nội bộ → id biến thể nhà cung cấp (+ SKU) → SKU. Không khoá ⇒ rỗng.
   */
  findVariantsForPrice(organizationId: string, accountId: string, key: VariantPriceKey) {
    const id = key.id?.trim();
    const externalVariantId = key.externalVariantId?.trim();
    const sku = key.sku?.trim();
    const match: Prisma.FulfillmentAccountVariantWhereInput | null = id
      ? { id }
      : externalVariantId
        ? { globalVariant: { externalVariantId, ...(sku ? { sku } : {}) } }
        : sku
          ? { globalVariant: { sku } }
          : null;
    if (!match) return Promise.resolve([]);
    return this.prisma.fulfillmentAccountVariant.findMany({
      where: {
        accountId,
        deletedAt: null,
        ...match,
        accountProduct: { deletedAt: null },
        account: FulfillmentRepository.usableAccountWhere(organizationId),
      },
      select: {
        id: true,
        price: true,
        currency: true,
        status: true,
        syncedAt: true,
        globalVariant: { select: { externalVariantId: true, sku: true } },
      },
      take: 5,
    });
  }

  /** Mọi biến thể ĐANG BÁN của một tài khoản — cho ánh xạ tự động (cùng phạm vi tổ chức với bản cũ). */
  loadMatchIndexRows(organizationId: string, accountId: string) {
    return this.prisma.fulfillmentAccountVariant.findMany({
      where: {
        organizationId,
        accountId,
        deletedAt: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
      },
      select: {
        id: true,
        price: true,
        globalVariant: {
          select: { externalVariantId: true, sku: true, name: true, color: true, size: true },
        },
        accountProduct: {
          select: {
            id: true,
            catalogueId: true,
            globalProduct: { select: { externalProductId: true, name: true, sku: true } },
          },
        },
      },
    });
  }
}
