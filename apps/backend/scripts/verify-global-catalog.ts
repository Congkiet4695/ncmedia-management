/**
 * KIỂM TRA Global Catalog sau backfill / dual write — CHỈ ĐỌC (transaction READ ONLY, chỉ SELECT).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config scripts/verify-global-catalog.ts
 *
 * Mỗi dòng in ra PASS / FAIL / INFO. Thoát mã 1 khi có FAIL.
 *
 *   1. Số dòng: bảng cũ ↔ lớp theo tài khoản (1:1, cùng id) ↔ lớp global (đã khử trùng).
 *   2. Trùng khoá: (provider, external_*_id) và (account_id, global_*_id).
 *   3. Lớp global KHÔNG chứa giá (không cột giá; payload không còn khoá giá theo GLOBAL_CATALOG_RAW_SCOPE).
 *   4. Giá theo tài khoản = giá bảng cũ của CHÍNH tài khoản đó (từng dòng).
 *   5. Product Mapping: (account_id, provider_variant_id, provider_sku) tra được ở lớp mới, ra CÙNG dòng
 *      và CÙNG giá như bảng cũ.
 *   6. Vùng in (Sellerwix) / production line (Mango): lớp global ↔ payload bảng cũ của từng tài khoản.
 *   7. Dấu vân tay (đếm + md5) của Product Mapping / Design / đơn fulfillment / Base Cost — so trước/sau.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { GLOBAL_CATALOG_RAW_SCOPE } from '../src/modules/fulfillment/shared/global-catalog-scope';

let failed = false;
const line = (status: 'PASS' | 'FAIL' | 'INFO', label: string, detail = '') => {
  if (status === 'FAIL') failed = true;
  console.log(`${status}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const n = (value: bigint | number | null | undefined) => Number(value ?? 0);

async function one<T>(tx: Prisma.TransactionClient, sql: Prisma.Sql): Promise<T> {
  const rows = await tx.$queryRaw<T[]>(sql);
  return rows[0];
}

async function main() {
  const prisma = new PrismaClient();
  const { Prisma: P } = await import('@prisma/client');
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;

        // --- 1. Số dòng ---
        const counts = await one<Record<string, bigint>>(
          tx,
          P.sql`
          SELECT (SELECT COUNT(*) FROM fulfillment_catalogues)          AS legacy_catalogues,
                 (SELECT COUNT(*) FROM fulfillment_products)            AS legacy_products,
                 (SELECT COUNT(*) FROM fulfillment_variants)            AS legacy_variants,
                 (SELECT COUNT(*) FROM fulfillment_account_catalogues)  AS account_catalogues,
                 (SELECT COUNT(*) FROM fulfillment_account_products)    AS account_products,
                 (SELECT COUNT(*) FROM fulfillment_account_variants)    AS account_variants,
                 (SELECT COUNT(*) FROM provider_catalog_catalogues)     AS global_catalogues,
                 (SELECT COUNT(*) FROM provider_catalog_products)       AS global_products,
                 (SELECT COUNT(*) FROM provider_catalog_variants)       AS global_variants`,
        );
        line(
          'INFO',
          'Số dòng',
          Object.entries(counts)
            .map(([k, v]) => `${k}=${n(v)}`)
            .join(' · '),
        );

        // Dòng cũ (của tài khoản đã chiếu) thiếu ở lớp theo tài khoản / lệch tài khoản hoặc id nhà cung cấp.
        const missing = await one<{ products: bigint; variants: bigint; mismatched: bigint }>(
          tx,
          P.sql`
          SELECT
            (SELECT COUNT(*) FROM fulfillment_products p
              WHERE EXISTS (SELECT 1 FROM fulfillment_account_products x WHERE x.account_id = p.account_id)
                AND NOT EXISTS (SELECT 1 FROM fulfillment_account_products ap WHERE ap.id = p.id)) AS products,
            (SELECT COUNT(*) FROM fulfillment_variants v
              WHERE EXISTS (SELECT 1 FROM fulfillment_account_variants x WHERE x.account_id = v.account_id)
                AND NOT EXISTS (SELECT 1 FROM fulfillment_account_variants av WHERE av.id = v.id)) AS variants,
            (SELECT COUNT(*) FROM fulfillment_account_variants av
               JOIN fulfillment_variants v ON v.id = av.id
               JOIN provider_catalog_variants g ON g.id = av.global_variant_id
              WHERE v.account_id <> av.account_id OR v.external_variant_id <> g.external_variant_id
                 OR v.provider <> g.provider) AS mismatched`,
        );
        line(
          n(missing.products) === 0 ? 'PASS' : 'FAIL',
          'Sản phẩm cũ đều có dòng theo tài khoản (cùng id)',
          `thiếu ${n(missing.products)}`,
        );
        line(
          n(missing.variants) === 0 ? 'PASS' : 'FAIL',
          'Biến thể cũ đều có dòng theo tài khoản (cùng id)',
          `thiếu ${n(missing.variants)}`,
        );
        line(
          n(missing.mismatched) === 0 ? 'PASS' : 'FAIL',
          'Dòng theo tài khoản trỏ đúng tài khoản + đúng (provider, id biến thể)',
          `lệch ${n(missing.mismatched)}`,
        );

        // --- 2. Trùng khoá ---
        const dup = await one<Record<string, bigint>>(
          tx,
          P.sql`
          SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM provider_catalog_products GROUP BY provider, external_product_id HAVING COUNT(*) > 1) d) AS gp,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM provider_catalog_variants GROUP BY provider, external_variant_id HAVING COUNT(*) > 1) d) AS gv,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM fulfillment_account_variants GROUP BY account_id, global_variant_id HAVING COUNT(*) > 1) d) AS av,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM fulfillment_account_products GROUP BY account_id, global_product_id HAVING COUNT(*) > 1) d) AS ap`,
        );
        const dupTotal = Object.values(dup).reduce((s, v) => s + n(v), 0);
        line(
          dupTotal === 0 ? 'PASS' : 'FAIL',
          'Không trùng (provider, external_id) / (account_id, global_id)',
          Object.entries(dup)
            .map(([k, v]) => `${k}=${n(v)}`)
            .join(' · '),
        );

        // --- 3. Lớp global không chứa giá ---
        const priceCols = await one<{ c: bigint }>(
          tx,
          P.sql`
          SELECT COUNT(*) AS c FROM information_schema.columns
          WHERE table_name IN ('provider_catalog_catalogues', 'provider_catalog_products', 'provider_catalog_variants')
            AND (column_name ILIKE '%price%' OR column_name ILIKE '%cost%' OR column_name IN ('currency', 'tier'))`,
        );
        line(
          n(priceCols.c) === 0 ? 'PASS' : 'FAIL',
          'Bảng global không có cột giá / đơn vị tiền / tier',
          `${n(priceCols.c)} cột`,
        );
        const leaked: string[] = [];
        for (const [level, table] of [
          ['product', 'provider_catalog_products'],
          ['variant', 'provider_catalog_variants'],
        ] as const) {
          for (const [provider, scope] of Object.entries(GLOBAL_CATALOG_RAW_SCOPE[level])) {
            const row = await one<{ c: bigint }>(
              tx,
              P.sql`
              SELECT COUNT(*) AS c FROM ${P.raw(`"${table}"`)}
              WHERE provider::text = ${provider}
                AND (raw_data ?| ${scope.dropKeys}::text[]
                     OR (${scope.dropPath ?? null}::text[] IS NOT NULL AND raw_data #> ${scope.dropPath ?? null}::text[] IS NOT NULL))`,
            );
            if (n(row.c) > 0) leaked.push(`${table}/${provider}: ${n(row.c)}`);
          }
        }
        line(
          leaked.length === 0 ? 'PASS' : 'FAIL',
          'Payload global không còn khoá giá / tồn kho / tier',
          leaked.join(' · ') || '0 dòng',
        );

        // --- 4. Giá theo tài khoản = giá bảng cũ của chính tài khoản ---
        const price = await one<{
          compared: bigint;
          diff: bigint;
          status_diff: bigint;
          currency_diff: bigint;
        }>(
          tx,
          P.sql`
          SELECT COUNT(*) AS compared,
                 COUNT(*) FILTER (WHERE av.price IS DISTINCT FROM v.price)       AS diff,
                 COUNT(*) FILTER (WHERE av.status IS DISTINCT FROM v.status)     AS status_diff,
                 COUNT(*) FILTER (WHERE av.currency IS DISTINCT FROM p.currency) AS currency_diff
          FROM fulfillment_account_variants av
          JOIN fulfillment_variants v ON v.id = av.id
          JOIN fulfillment_products p ON p.id = v.product_id`,
        );
        line(
          n(price.diff) + n(price.status_diff) + n(price.currency_diff) === 0 ? 'PASS' : 'FAIL',
          'Giá / trạng thái / đơn vị tiền theo tài khoản khớp bảng cũ từng dòng',
          `so ${n(price.compared)} · lệch giá ${n(price.diff)} · lệch trạng thái ${n(price.status_diff)} · lệch tiền ${n(price.currency_diff)}`,
        );
        const spread = await one<{ variants: bigint; multi: bigint; diff: bigint }>(
          tx,
          P.sql`
          SELECT COUNT(*) AS variants, COUNT(*) FILTER (WHERE accts > 1) AS multi, COUNT(*) FILTER (WHERE prices > 1) AS diff
          FROM (SELECT global_variant_id, COUNT(*) AS accts, COUNT(DISTINCT price) AS prices
                FROM fulfillment_account_variants WHERE deleted_at IS NULL GROUP BY global_variant_id) g`,
        );
        line(
          'INFO',
          'Biến thể global dùng chung / có giá khác nhau giữa tài khoản',
          `${n(spread.variants)} biến thể · ${n(spread.multi)} ở ≥2 tài khoản · ${n(spread.diff)} có giá khác nhau (giữ riêng từng tài khoản)`,
        );

        // --- 5. Product Mapping tra được và ra cùng giá ---
        const mapping = await one<{
          total: bigint;
          legacy_ok: bigint;
          global_ok: bigint;
          same_row: bigint;
          same_price: bigint;
        }>(
          tx,
          P.sql`
          WITH m AS (
            SELECT m.id, m.account_id, m.provider_sku, m.provider_variant_id FROM fulfillment_product_mappings m
            WHERE m.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM fulfillment_account_variants x WHERE x.account_id = m.account_id)
          ),
          l AS (
            SELECT m.id, MIN(v.id::text) AS vid, MIN(v.price) AS price, COUNT(*) AS c FROM m
            JOIN fulfillment_variants v ON v.account_id = m.account_id AND v.deleted_at IS NULL
             AND v.sku = m.provider_sku AND (m.provider_variant_id IS NULL OR v.external_variant_id = m.provider_variant_id)
            GROUP BY m.id
          ),
          g AS (
            SELECT m.id, MIN(av.id::text) AS vid, MIN(av.price) AS price, COUNT(*) AS c FROM m
            JOIN fulfillment_account_variants av ON av.account_id = m.account_id AND av.deleted_at IS NULL
            JOIN provider_catalog_variants gv ON gv.id = av.global_variant_id
             AND gv.sku = m.provider_sku AND (m.provider_variant_id IS NULL OR gv.external_variant_id = m.provider_variant_id)
            GROUP BY m.id
          )
          SELECT (SELECT COUNT(*) FROM m) AS total, (SELECT COUNT(*) FROM l) AS legacy_ok, (SELECT COUNT(*) FROM g) AS global_ok,
                 (SELECT COUNT(*) FROM l JOIN g USING (id) WHERE l.vid = g.vid AND l.c = g.c) AS same_row,
                 (SELECT COUNT(*) FROM l JOIN g USING (id) WHERE l.price IS NOT DISTINCT FROM g.price) AS same_price`,
        );
        line(
          n(mapping.global_ok) === n(mapping.legacy_ok) &&
            n(mapping.same_row) === n(mapping.legacy_ok) &&
            n(mapping.same_price) === n(mapping.legacy_ok)
            ? 'PASS'
            : 'FAIL',
          'Product Mapping (account_id + provider_variant_id + provider_sku) tra được ở lớp mới, cùng dòng, cùng giá',
          `mapping ${n(mapping.total)} · tra được: cũ ${n(mapping.legacy_ok)} / mới ${n(mapping.global_ok)} · cùng dòng ${n(mapping.same_row)} · cùng giá ${n(mapping.same_price)}`,
        );

        // --- 6. Vùng in / production line ---
        const areas = await one<{ compared: bigint; diff: bigint; diff_fresh: bigint }>(
          tx,
          P.sql`
          SELECT COUNT(*) AS compared,
                 COUNT(*) FILTER (WHERE x.legacy IS DISTINCT FROM x.global) AS diff,
                 COUNT(*) FILTER (WHERE x.legacy IS DISTINCT FROM x.global AND x.fresh) AS diff_fresh
          FROM (
            SELECT CASE WHEN v.provider = 'SELLERWIX' THEN v.raw_data -> 'print_areas' ELSE v.raw_data -> 'production_line' END AS legacy,
                   CASE WHEN v.provider = 'SELLERWIX' THEN g.raw_data -> 'print_areas' ELSE g.raw_data -> 'production_line' END AS global,
                   v.synced_at >= g.source_synced_at AS fresh
            FROM fulfillment_account_variants av
            JOIN fulfillment_variants v ON v.id = av.id
            JOIN provider_catalog_variants g ON g.id = av.global_variant_id
          ) x`,
        );
        line(
          n(areas.diff_fresh) === 0 ? 'PASS' : 'FAIL',
          'Vùng in (Sellerwix) / production line (Mango): lớp global = payload bảng cũ',
          `so ${n(areas.compared)} · khác ${n(areas.diff)} (chỉ được khác ở tài khoản có dữ liệu CŨ hơn nguồn global: ${n(areas.diff) - n(areas.diff_fresh)})`,
        );

        // --- 7. Dấu vân tay dữ liệu thực thi (so trước/sau backfill) ---
        const fp = await one<Record<string, string>>(
          tx,
          P.sql`
          SELECT (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '' ORDER BY id)), '-') FROM fulfillment_product_mappings t) AS mappings,
                 (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '' ORDER BY id)), '-') FROM fulfillment_product_designs t) AS designs,
                 (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '' ORDER BY id)), '-') FROM fulfillment_orders t) AS orders,
                 (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '' ORDER BY id)), '-') FROM fulfillment_order_items t) AS order_items,
                 (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(id::text || COALESCE(base_cost::text, '∅'), '' ORDER BY id)), '-')
                    FROM pod_orders) AS pod_order_base_cost,
                 (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '' ORDER BY id)), '-') FROM fulfillment_variants t) AS legacy_variants`,
        );
        line(
          'INFO',
          'Dấu vân tay (so trước/sau)',
          Object.entries(fp)
            .map(([k, v]) => `${k}=${v}`)
            .join(' · '),
        );
      },
      { timeout: 10 * 60_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
