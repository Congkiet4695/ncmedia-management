/**
 * GLOBAL CATALOG — KIỂM TRA (production-safe): CHỈ ĐỌC. Mọi truy vấn chạy trong transaction `READ ONLY`,
 * chỉ SELECT; không gọi API nhà cung cấp; không in API key, payload thô hay thông tin khách hàng.
 *
 * Chạy:
 *   node -r ts-node/register -r dotenv/config scripts/verify-global-catalog.ts
 *   … --save-baseline <file.json>   # lưu dấu vân tay Mapping / Design / Order / Base Cost (vd TRƯỚC backfill)
 *   … --baseline <file.json>        # so với dấu vân tay đã lưu ⇒ PASS/FAIL "không đổi"
 *
 * Chạy được cả khi lớp mới CHƯA có dữ liệu (vừa migrate, chưa backfill): khi đó in trạng thái
 * NOT POPULATED + phần "SẴN SÀNG BACKFILL" tính THUẦN từ bảng cũ (số bản ghi global dự kiến, xung đột
 * metadata giữa các tài khoản, va chạm khác nhà cung cấp) — không ghi gì.
 *
 * Mã thoát 1 khi có FAIL. WARN (vd chưa backfill, tài khoản chưa chiếu) không làm thoát lỗi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { GLOBAL_CATALOG_RAW_SCOPE } from '../src/modules/fulfillment/shared/global-catalog-scope';

type Status = 'PASS' | 'FAIL' | 'WARN' | 'INFO';
let failed = false;
const out: string[] = [];
const say = (text = '') => out.push(text);
const row = (status: Status, label: string, detail = '') => {
  if (status === 'FAIL') failed = true;
  out.push(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
};
const n = (value: unknown) => Number(value ?? 0);
const PROVIDERS = ['SELLERWIX', 'MANGO'] as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function one<T>(tx: Prisma.TransactionClient, sql: Prisma.Sql): Promise<T> {
  const rows = await tx.$queryRaw<T[]>(sql);
  return rows[0];
}

async function main() {
  const prisma = new PrismaClient();
  const fingerprints: Record<string, string> = {};
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;

        say('========================================');
        say('GLOBAL CATALOG PRODUCTION VERIFICATION');
        say('========================================');

        // ------------------------------------------------------------------ TRẠNG THÁI
        const migration = await one<{ applied: boolean }>(
          tx,
          Prisma.sql`
          SELECT EXISTS (SELECT 1 FROM _prisma_migrations
                         WHERE migration_name = '20261110090000_global_fulfillment_catalog'
                           AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied`,
        );
        const accounts = await tx.$queryRaw<
          Array<{
            id: string;
            provider: string;
            is_global: boolean;
            legacy: Date | null;
            projected: Date | null;
          }>
        >`
          SELECT a.id, a.provider::text AS provider, a.is_global,
                 (SELECT MAX(synced_at) FROM fulfillment_products p WHERE p.account_id = a.id AND p.deleted_at IS NULL) AS legacy,
                 (SELECT MAX(synced_at) FROM fulfillment_account_products x WHERE x.account_id = a.id AND x.deleted_at IS NULL) AS projected
          FROM fulfillment_accounts a WHERE a.deleted_at IS NULL ORDER BY a.provider, a.id`;
        const withCatalog = accounts.filter((a) => a.legacy);
        const projectedOk = withCatalog.filter(
          (a) => a.projected && a.projected.getTime() >= (a.legacy as Date).getTime(),
        );
        const populated = projectedOk.length > 0;

        say('\nSTATE');
        row(
          migration.applied ? 'PASS' : 'FAIL',
          'Migration 20261110090000_global_fulfillment_catalog đã áp',
        );
        row(
          projectedOk.length === withCatalog.length && populated ? 'PASS' : 'WARN',
          'Tài khoản đã chiếu sang lớp mới (theo kịp synced_at của bảng cũ)',
          `${projectedOk.length}/${withCatalog.length}` +
            (populated
              ? ''
              : ' — NOT POPULATED: chưa backfill / chưa có lượt đồng bộ nào sau deploy ⇒ mọi lượt đọc đang rơi về bảng cũ'),
        );
        for (const a of withCatalog.filter((x) => !projectedOk.includes(x))) {
          row(
            'INFO',
            `  ${a.provider} ${a.id}`,
            a.projected
              ? `STALE (lớp mới ${a.projected.toISOString()} < bảng cũ ${(a.legacy as Date).toISOString()})`
              : 'NOT PROJECTED',
          );
        }
        const stale = await tx.$queryRaw<Array<{ id: string; provider: string; last: Date }>>`
          SELECT a.id, a.provider::text AS provider, MAX(p.synced_at) AS last FROM fulfillment_accounts a
          JOIN fulfillment_products p ON p.account_id = a.id AND p.deleted_at IS NULL
          WHERE a.deleted_at IS NULL GROUP BY a.id, a.provider HAVING MAX(p.synced_at) < now() - interval '2 days'`;
        for (const s of stale)
          row(
            'WARN',
            `Danh mục bảng cũ cũ hơn 2 ngày: ${s.provider} ${s.id}`,
            `đồng bộ lần cuối ${s.last.toISOString()}`,
          );

        // ------------------------------------------------------------------ THEO NHÀ CUNG CẤP
        for (const provider of PROVIDERS) {
          const projectedIds = projectedOk.filter((a) => a.provider === provider).map((a) => a.id);
          const c = await one<Record<string, bigint>>(
            tx,
            Prisma.sql`
            SELECT (SELECT COUNT(*) FROM fulfillment_accounts WHERE deleted_at IS NULL AND provider::text = ${provider}) AS accounts,
                   (SELECT COUNT(*) FROM fulfillment_products WHERE provider::text = ${provider} AND deleted_at IS NULL) AS legacy_products,
                   (SELECT COUNT(*) FROM fulfillment_variants WHERE provider::text = ${provider} AND deleted_at IS NULL) AS legacy_variants,
                   (SELECT COUNT(DISTINCT external_product_id) FROM fulfillment_products WHERE provider::text = ${provider} AND deleted_at IS NULL) AS expected_global_products,
                   (SELECT COUNT(DISTINCT external_variant_id) FROM fulfillment_variants WHERE provider::text = ${provider} AND deleted_at IS NULL) AS expected_global_variants,
                   (SELECT COUNT(*) FROM provider_catalog_products WHERE provider::text = ${provider}) AS global_products,
                   (SELECT COUNT(*) FROM provider_catalog_variants WHERE provider::text = ${provider}) AS global_variants,
                   (SELECT COUNT(*) FROM fulfillment_account_products WHERE provider::text = ${provider} AND deleted_at IS NULL) AS account_products,
                   (SELECT COUNT(*) FROM fulfillment_account_variants WHERE provider::text = ${provider} AND deleted_at IS NULL) AS account_variants`,
          );
          say(`\n${provider}`);
          row('INFO', 'Accounts', `${n(c.accounts)} (đã chiếu ${projectedIds.length})`);
          row(
            'INFO',
            'Products',
            `bảng cũ ${n(c.legacy_products)} · global ${n(c.global_products)}/${n(c.expected_global_products)} dự kiến · theo tài khoản ${n(c.account_products)}`,
          );
          row(
            'INFO',
            'Variants',
            `bảng cũ ${n(c.legacy_variants)} · global ${n(c.global_variants)}/${n(c.expected_global_variants)} dự kiến · theo tài khoản ${n(c.account_variants)}`,
          );

          // Thiếu / lệch — chỉ trên tài khoản đã chiếu (chưa chiếu thì "thiếu" là đương nhiên, đã báo ở STATE).
          const m = await one<Record<string, bigint>>(
            tx,
            Prisma.sql`
            SELECT
              (SELECT COUNT(*) FROM fulfillment_variants v
                WHERE v.account_id = ANY(${projectedIds}::uuid[]) AND v.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM fulfillment_account_variants av WHERE av.id = v.id)) AS missing_variants,
              (SELECT COUNT(*) FROM fulfillment_products p
                WHERE p.account_id = ANY(${projectedIds}::uuid[]) AND p.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM fulfillment_account_products ap WHERE ap.id = p.id)) AS missing_products,
              (SELECT COUNT(*) FROM fulfillment_account_variants av
                 JOIN fulfillment_variants v ON v.id = av.id
                 JOIN fulfillment_products p ON p.id = v.product_id
                 JOIN provider_catalog_variants g ON g.id = av.global_variant_id
                WHERE av.provider::text = ${provider}
                  AND (v.account_id <> av.account_id OR v.external_variant_id <> g.external_variant_id
                       OR v.price IS DISTINCT FROM av.price OR v.status <> av.status
                       OR p.currency IS DISTINCT FROM av.currency)) AS mismatched,
              (SELECT COUNT(*) FROM fulfillment_account_variants av
                 JOIN fulfillment_variants v ON v.id = av.id
                WHERE av.provider::text = ${provider} AND v.sku IS DISTINCT FROM
                      (SELECT g.sku FROM provider_catalog_variants g WHERE g.id = av.global_variant_id)) AS sku_differs`,
          );
          row(
            n(m.missing_products) + n(m.missing_variants) === 0 ? 'PASS' : 'FAIL',
            'Missing (đã chiếu mà thiếu dòng theo tài khoản)',
            `products ${n(m.missing_products)} · variants ${n(m.missing_variants)}`,
          );
          row(
            n(m.mismatched) === 0 ? 'PASS' : 'FAIL',
            'Mismatched (tài khoản / id nhà cung cấp / giá / trạng thái / tiền lệch bảng cũ)',
            String(n(m.mismatched)),
          );
          row(
            n(m.sku_differs) === 0 ? 'PASS' : 'WARN',
            'SKU tài khoản ≠ SKU global (tài khoản có dữ liệu cũ hơn nguồn global)',
            String(n(m.sku_differs)),
          );

          const area = await one<{ compared: bigint; differs: bigint; differs_fresh: bigint }>(
            tx,
            Prisma.sql`
            SELECT COUNT(*) AS compared,
                   COUNT(*) FILTER (WHERE x.legacy IS DISTINCT FROM x.global) AS differs,
                   COUNT(*) FILTER (WHERE x.legacy IS DISTINCT FROM x.global AND x.fresh) AS differs_fresh
            FROM (SELECT CASE WHEN v.provider = 'SELLERWIX' THEN v.raw_data -> 'print_areas' ELSE v.raw_data -> 'production_line' END AS legacy,
                         CASE WHEN v.provider = 'SELLERWIX' THEN g.raw_data -> 'print_areas' ELSE g.raw_data -> 'production_line' END AS global,
                         v.synced_at >= g.source_synced_at AS fresh
                  FROM fulfillment_account_variants av
                  JOIN fulfillment_variants v ON v.id = av.id
                  JOIN provider_catalog_variants g ON g.id = av.global_variant_id
                  WHERE av.provider::text = ${provider}) x`,
          );
          row(
            n(area.differs_fresh) === 0 ? 'PASS' : 'FAIL',
            provider === 'SELLERWIX'
              ? 'Print areas: global = payload tài khoản'
              : 'Production line: global = payload tài khoản',
            `so ${n(area.compared)} · khác ${n(area.differs)} (đều ở tài khoản có dữ liệu cũ hơn nguồn global: ${n(area.differs) - n(area.differs_fresh)})`,
          );

          // SẴN SÀNG BACKFILL — thuần từ bảng cũ, đúng luật chiếu: bản đồng bộ MỚI NHẤT thắng.
          const pre = await one<{ conflicting: bigint; conflicting_fresh: bigint }>(
            tx,
            Prisma.sql`
            WITH v AS (
              SELECT v.external_variant_id AS ext, v.synced_at,
                     md5(concat_ws('|', p.external_product_id, v.sku, v.name, v.color, v.size,
                       CASE WHEN v.provider = 'SELLERWIX' THEN (v.raw_data -> 'print_areas')::text ELSE v.raw_data ->> 'production_line' END)) AS h
              FROM fulfillment_variants v JOIN fulfillment_products p ON p.id = v.product_id
              WHERE v.provider::text = ${provider} AND v.deleted_at IS NULL
            ), latest AS (SELECT ext, MAX(synced_at)::date AS d FROM v GROUP BY ext)
            SELECT (SELECT COUNT(*) FROM (SELECT ext FROM v GROUP BY ext HAVING COUNT(DISTINCT h) > 1) a) AS conflicting,
                   (SELECT COUNT(*) FROM (SELECT v.ext FROM v JOIN latest l ON l.ext = v.ext AND v.synced_at::date = l.d
                                          GROUP BY v.ext HAVING COUNT(DISTINCT h) > 1) b) AS conflicting_fresh`,
          );
          row(
            n(pre.conflicting_fresh) === 0 ? 'PASS' : 'WARN',
            'Sẵn sàng backfill: metadata chuẩn khác nhau giữa các tài khoản',
            `${n(pre.conflicting)} biến thể khác nhau; trong số tài khoản đồng bộ CÙNG NGÀY mới nhất: ${n(pre.conflicting_fresh)} (phần còn lại do tài khoản có dữ liệu cũ — bản mới thắng)`,
          );
        }

        // ------------------------------------------------------------------ MAPPING
        const map = await one<Record<string, bigint>>(
          tx,
          Prisma.sql`
          WITH m AS (
            SELECT m.id, m.account_id, m.provider_sku, m.provider_variant_id FROM fulfillment_product_mappings m
            WHERE m.deleted_at IS NULL
          ),
          l AS (
            SELECT m.id, MIN(v.id::text) AS vid, MIN(v.price) AS price FROM m
            JOIN fulfillment_variants v ON v.account_id = m.account_id AND v.deleted_at IS NULL AND v.sku = m.provider_sku
             AND (m.provider_variant_id IS NULL OR v.external_variant_id = m.provider_variant_id)
            GROUP BY m.id
          ),
          g AS (
            SELECT m.id, MIN(av.id::text) AS vid, MIN(av.price) AS price FROM m
            JOIN fulfillment_account_variants av ON av.account_id = m.account_id AND av.deleted_at IS NULL
            JOIN provider_catalog_variants gv ON gv.id = av.global_variant_id AND gv.sku = m.provider_sku
             AND (m.provider_variant_id IS NULL OR gv.external_variant_id = m.provider_variant_id)
            GROUP BY m.id
          )
          SELECT (SELECT COUNT(*) FROM m) AS total,
                 (SELECT COUNT(*) FROM l) AS legacy_ok,
                 (SELECT COUNT(*) FROM m WHERE m.account_id = ANY(${projectedOk.map((a) => a.id)}::uuid[])) AS on_projected,
                 (SELECT COUNT(*) FROM g) AS global_ok,
                 (SELECT COUNT(*) FROM l JOIN g USING (id) WHERE l.vid <> g.vid OR l.price IS DISTINCT FROM g.price) AS differ,
                 (SELECT COUNT(*) FROM fulfillment_product_mappings x JOIN fulfillment_accounts a ON a.id = x.account_id
                   WHERE x.deleted_at IS NULL AND a.provider <> x.provider) AS provider_mismatch`,
        );
        const onProjectedLegacyOk = populated
          ? await one<{ c: bigint }>(
              tx,
              Prisma.sql`
              SELECT COUNT(*) AS c FROM fulfillment_product_mappings m
              WHERE m.deleted_at IS NULL AND m.account_id = ANY(${projectedOk.map((a) => a.id)}::uuid[])
                AND EXISTS (SELECT 1 FROM fulfillment_variants v WHERE v.account_id = m.account_id AND v.deleted_at IS NULL
                            AND v.sku = m.provider_sku AND (m.provider_variant_id IS NULL OR v.external_variant_id = m.provider_variant_id))`,
            )
          : { c: 0n };
        say('\nPRODUCT MAPPINGS');
        row('INFO', 'Total', String(n(map.total)));
        row(
          'INFO',
          'Resolvable (bảng cũ)',
          `${n(map.legacy_ok)} · không tra được: ${n(map.total) - n(map.legacy_ok)} (khai cho biến thể đã không còn trong danh mục — có từ trước, không do Global Catalog)`,
        );
        row(
          n(map.global_ok) === n(onProjectedLegacyOk.c) && n(map.differ) === 0
            ? populated
              ? 'PASS'
              : 'WARN'
            : 'FAIL',
          'Resolvable (lớp mới) — cùng dòng, cùng giá như bảng cũ',
          populated
            ? `${n(map.global_ok)}/${n(onProjectedLegacyOk.c)} mapping của tài khoản đã chiếu · khác ${n(map.differ)}`
            : 'NOT POPULATED',
        );
        row(
          n(map.provider_mismatch) === 0 ? 'PASS' : 'FAIL',
          'Mapping.provider = provider của tài khoản',
          String(n(map.provider_mismatch)),
        );

        // ------------------------------------------------------------------ DESIGN
        const design = await one<Record<string, bigint>>(
          tx,
          Prisma.sql`
          SELECT (SELECT COUNT(*) FROM fulfillment_product_designs WHERE deleted_at IS NULL) AS total,
                 (SELECT COUNT(*) FROM fulfillment_product_designs d JOIN storage_files f ON f.id = d.storage_file_id
                   WHERE f.organization_id <> d.organization_id) AS cross_org_files`,
        );
        say('\nPRODUCT DESIGNS');
        row(
          n(design.cross_org_files) === 0 ? 'PASS' : 'FAIL',
          'Integrity (design không trỏ file của tổ chức khác)',
          `${n(design.total)} design · chéo tổ chức ${n(design.cross_org_files)}`,
        );

        // ------------------------------------------------------------------ ORDER
        const order = await one<Record<string, bigint>>(
          tx,
          Prisma.sql`
          SELECT (SELECT COUNT(*) FROM fulfillment_order_items WHERE deleted_at IS NULL) AS items,
                 (SELECT COUNT(*) FROM fulfillment_order_items WHERE deleted_at IS NULL AND base_cost_confirmed_at IS NOT NULL) AS confirmed,
                 (SELECT COUNT(*) FROM pod_orders WHERE base_cost IS NOT NULL) AS order_level`,
        );
        say('\nORDERS');
        row(
          'INFO',
          'Base Cost',
          `${n(order.items)} dòng hàng (${n(order.confirmed)} đã xác nhận) · ${n(order.order_level)} đơn có Base Cost tổng`,
        );

        // Dấu vân tay để so trước/sau (chỉ md5 — không in dữ liệu).
        // 🔴 Dòng hàng: lấy GIÁ TRỊ base_cost + "đã xác nhận hay chưa", KHÔNG lấy mốc `base_cost_confirmed_at`: đồng
        // bộ trạng thái đơn (5 phút/lượt) ghi lại mốc này cho mọi dòng đã xác nhận mỗi lượt (`applyProviderItemCosts`)
        // dù giá không đổi — đưa mốc vào thì dấu vân tay đổi liên tục, không còn đo được Base Cost (2026-11-10).
        const fp = await one<Record<string, string>>(
          tx,
          Prisma.sql`
          SELECT
            (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(concat_ws('|', id, account_id, provider_sku, provider_variant_id, base_cost, placement_map::text, production_config, production_line, is_active, deleted_at), ',' ORDER BY id)), '-')
               FROM fulfillment_product_mappings) AS mappings,
            (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(concat_ws('|', id, organization_id, tiktok_product_id, tiktok_sku_id, placement, storage_file_id, source_url, version, deleted_at), ',' ORDER BY id)), '-')
               FROM fulfillment_product_designs) AS designs,
            (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(concat_ws('|', id, fulfillment_order_id, provider_sku, quantity, base_cost, base_cost_confirmed_at IS NOT NULL), ',' ORDER BY id)), '-')
               FROM fulfillment_order_items) AS order_item_base_cost,
            (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(concat_ws('|', id, base_cost, base_cost_currency), ',' ORDER BY id)), '-')
               FROM pod_orders WHERE base_cost IS NOT NULL) AS pod_order_base_cost`,
        );
        Object.assign(fingerprints, fp);
        const baselinePath = argValue('--baseline');
        if (baselinePath) {
          const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string>;
          // Bảng nghiệp vụ đang sống ⇒ có thể đổi vì người dùng thao tác. FAIL ở đây nghĩa là "phải giải thích", không
          // tự động là lỗi Global Catalog — so thêm theo thời điểm chạy.
          for (const key of Object.keys(fp)) {
            row(
              baseline[key] === fp[key] ? 'PASS' : 'FAIL',
              `Không đổi so với baseline: ${key}`,
              baseline[key] === fp[key] ? '' : `${baseline[key]} → ${fp[key]}`,
            );
          }
        } else {
          row(
            'INFO',
            'Base Cost Integrity',
            'chưa có baseline — chạy với --save-baseline trước backfill, --baseline sau backfill',
          );
        }

        // ------------------------------------------------------------------ TRÙNG / KHÁC NHÀ CUNG CẤP / GIÁ
        const dup = await one<Record<string, bigint>>(
          tx,
          Prisma.sql`
          SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM provider_catalog_products GROUP BY provider, external_product_id HAVING COUNT(*) > 1) d) AS gp,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM provider_catalog_variants GROUP BY provider, external_variant_id HAVING COUNT(*) > 1) d) AS gv,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM fulfillment_account_products GROUP BY account_id, global_product_id HAVING COUNT(*) > 1) d) AS ap,
                 (SELECT COUNT(*) FROM (SELECT 1 FROM fulfillment_account_variants GROUP BY account_id, global_variant_id HAVING COUNT(*) > 1) d) AS av`,
        );
        say('\nDUPLICATES');
        row(n(dup.gp) === 0 ? 'PASS' : 'FAIL', 'Global Products', String(n(dup.gp)));
        row(n(dup.gv) === 0 ? 'PASS' : 'FAIL', 'Global Variants', String(n(dup.gv)));
        row(
          n(dup.ap) + n(dup.av) === 0 ? 'PASS' : 'FAIL',
          'Account Products / Variants',
          `${n(dup.ap)} / ${n(dup.av)}`,
        );

        const cross = await one<Record<string, bigint>>(
          tx,
          Prisma.sql`
          SELECT
            (SELECT COUNT(*) FROM fulfillment_account_variants av JOIN provider_catalog_variants g ON g.id = av.global_variant_id
               JOIN fulfillment_accounts a ON a.id = av.account_id
              WHERE av.provider <> g.provider OR av.provider <> a.provider) AS variant_rows,
            (SELECT COUNT(*) FROM fulfillment_account_products ap JOIN provider_catalog_products g ON g.id = ap.global_product_id
              WHERE ap.provider <> g.provider) AS product_rows,
            (SELECT COUNT(*) FROM provider_catalog_variants v JOIN provider_catalog_products p ON p.id = v.product_id
              WHERE v.provider <> p.provider) AS global_tree,
            (SELECT COUNT(*) FROM fulfillment_account_variants av JOIN fulfillment_account_products ap ON ap.id = av.account_product_id
              WHERE av.account_id <> ap.account_id) AS account_tree,
            (SELECT COUNT(*) FROM (SELECT external_variant_id FROM fulfillment_variants WHERE deleted_at IS NULL
                                   GROUP BY external_variant_id HAVING COUNT(DISTINCT provider) > 1) s) AS shared_ext_ids`,
        );
        say('\nPROVIDER CROSS-CONTAMINATION');
        row(
          n(cross.variant_rows) +
            n(cross.product_rows) +
            n(cross.global_tree) +
            n(cross.account_tree) ===
            0
            ? 'PASS'
            : 'FAIL',
          'Không dòng nào nối khác nhà cung cấp / khác tài khoản',
          `variant ${n(cross.variant_rows)} · product ${n(cross.product_rows)} · cây global ${n(cross.global_tree)} · cây tài khoản ${n(cross.account_tree)}`,
        );
        row(
          'INFO',
          'Id nhà cung cấp trùng chuỗi giữa hai nhà cung cấp (được giữ thành hai bản ghi)',
          String(n(cross.shared_ext_ids)),
        );

        const priceCols = await one<{ c: bigint }>(
          tx,
          Prisma.sql`
          SELECT COUNT(*) AS c FROM information_schema.columns
          WHERE table_name IN ('provider_catalog_catalogues', 'provider_catalog_products', 'provider_catalog_variants')
            AND (column_name ILIKE '%price%' OR column_name ILIKE '%cost%' OR column_name IN ('currency', 'tier'))`,
        );
        let leaked = 0;
        for (const [level, table] of [
          ['product', 'provider_catalog_products'],
          ['variant', 'provider_catalog_variants'],
        ] as const) {
          for (const [provider, scope] of Object.entries(GLOBAL_CATALOG_RAW_SCOPE[level])) {
            const r = await one<{ c: bigint }>(
              tx,
              Prisma.sql`
              SELECT COUNT(*) AS c FROM ${Prisma.raw(`"${table}"`)}
              WHERE provider::text = ${provider}
                AND (raw_data ?| ${scope.dropKeys}::text[]
                     OR (${scope.dropPath ?? null}::text[] IS NOT NULL AND raw_data #> ${scope.dropPath ?? null}::text[] IS NOT NULL))`,
            );
            leaked += n(r.c);
          }
        }
        say('\nPRICE LEAKAGE');
        row(
          n(priceCols.c) + leaked === 0 ? 'PASS' : 'FAIL',
          'Lớp global không có cột / khoá giá, tiền, tier, tồn kho',
          `cột ${n(priceCols.c)} · dòng có khoá giá ${leaked}`,
        );
      },
      { timeout: 10 * 60_000, maxWait: 60_000 },
    );
  } finally {
    await prisma.$disconnect();
  }

  const savePath = argValue('--save-baseline');
  if (savePath) {
    writeFileSync(savePath, JSON.stringify(fingerprints, null, 2));
    say(`\nĐã lưu baseline: ${savePath}`);
  }
  say(`\nRESULT: ${failed ? 'FAIL' : 'PASS'}`);
  console.log(out.join('\n'));
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
