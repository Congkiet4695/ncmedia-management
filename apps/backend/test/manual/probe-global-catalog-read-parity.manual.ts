/* eslint-disable */
/**
 * PROBE — Global Catalog có đọc RA ĐÚNG như bảng cũ không, trên DỮ LIỆU THẬT. CHỈ ĐỌC.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/probe-global-catalog-read-parity.manual.ts
 *
 * 🔴 Kết nối mở với `default_transaction_read_only=on` (kiểm `SHOW` trước khi chạy — không phải `on` thì DỪNG):
 * mọi lệnh ghi bị PostgreSQL từ chối. Cờ GLOBAL_FULFILLMENT_CATALOG_ENABLED chỉ được "bật" TRONG TIẾN TRÌNH NÀY
 * (ConfigService giả) để so hai đường đọc — không đụng cấu hình của server.
 *
 * Với MỖI tài khoản: so kết quả cờ TẮT (bảng cũ) và cờ BẬT (lớp mới) cho danh mục, mọi trang sản phẩm, tìm
 * kiếm, biến thể (mọi sản phẩm có ánh xạ + mẫu), giá của MỌI ánh xạ, chỉ mục ánh xạ tự động, số liệu màn
 * hình — kèm thời gian từng đường. Không in giá, SKU hay dữ liệu khách hàng — chỉ số lượng và id lệch.
 */
import { PrismaClient } from '@prisma/client';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import { FulfillmentCatalogQueryService } from '../../src/modules/fulfillment/services/fulfillment-catalog-query.service';
import { FulfillmentCatalogReader, GLOBAL_CATALOG_READ_FLAG } from '../../src/modules/fulfillment/services/fulfillment-catalog-reader.service';
import { FulfillmentVariantPriceService } from '../../src/modules/fulfillment/services/fulfillment-variant-price.service';

const base = process.env.DATABASE_URL as string;
const prisma = new PrismaClient({
  datasources: { db: { url: base + (base.includes('?') ? '&' : '?') + 'options=-c%20default_transaction_read_only%3Don' } },
});
const SAMPLE_PRODUCTS = Number(process.env.PARITY_SAMPLE_PRODUCTS ?? 40);
const PAGE = 100;
const strip = (v: unknown) => JSON.stringify(v);

type Timing = Record<string, { legacy: number[]; global: number[] }>;
const timing: Timing = {};
const lines: string[] = [];
let failures = 0;

async function main() {
  const [ro] = await prisma.$queryRawUnsafe<Array<{ default_transaction_read_only: string }>>('SHOW default_transaction_read_only');
  if (ro?.default_transaction_read_only !== 'on') throw new Error('Kết nối KHÔNG ở chế độ chỉ đọc — dừng.');

  let readOn = false;
  const config = { get: (k: string) => (k === GLOBAL_CATALOG_READ_FLAG ? readOn : undefined) } as never;
  const legacy = new FulfillmentCatalogRepository(prisma as never);
  const global = new FulfillmentGlobalCatalogRepository(prisma as never);
  const reader = new FulfillmentCatalogReader(legacy, global, config);
  const query = new FulfillmentCatalogQueryService(new FulfillmentRepository(prisma as never), reader);
  const price = new FulfillmentVariantPriceService(reader);

  /** Chạy cùng một thao tác hai lần (cờ TẮT rồi BẬT), đo thời gian, trả hai kết quả. */
  const both = async <T>(op: string, fn: () => Promise<T>): Promise<[T, T]> => {
    timing[op] ??= { legacy: [], global: [] };
    readOn = false;
    let t = Date.now();
    const off = await fn();
    timing[op].legacy.push(Date.now() - t);
    readOn = true;
    t = Date.now();
    const on = await fn();
    timing[op].global.push(Date.now() - t);
    readOn = false;
    return [off, on];
  };

  const accounts = await prisma.fulfillmentAccount.findMany({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, provider: true },
    orderBy: [{ provider: 'asc' }, { id: 'asc' }],
  });

  // Tài khoản có danh mục bảng cũ CŨ (đồng bộ lần cuối > 2 ngày): lớp global mang metadata MỚI hơn của tài khoản khác
  // ⇒ được phép khác ở các trường metadata chuẩn (đúng thiết kế "bản mới thắng"), KHÔNG ở giá / trạng thái / id.
  const staleAccounts = new Set(
    (
      await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT account_id AS id FROM fulfillment_products WHERE deleted_at IS NULL
        GROUP BY account_id HAVING MAX(synced_at) < now() - interval '2 days'`
    ).map((r) => r.id),
  );
  const CANONICAL_FIELDS = new Set(['name', 'imageUrl', 'color', 'size', 'printAreas', 'productionLine', 'sku', 'catalogName']);

  /**
   * EQUAL — giống hệt · TIE_ORDER — cùng dòng + cùng giá trị + cùng thứ tự TÊN hiển thị, chỉ khác thứ tự trong nhóm TRÙNG
   * tên (bảng cũ sắp theo tên ⇒ thứ tự nhóm hoà không xác định) · STALE_CANONICAL — tài khoản dữ liệu cũ, chỉ khác metadata
   * chuẩn · DIFF — khác thật (FAIL).
   */
  type Verdict = 'EQUAL' | 'TIE_ORDER' | 'STALE_CANONICAL' | 'DIFF';
  const classify = (a: any[], b: any[], stale: boolean): { verdict: Verdict; fields: string[] } => {
    if (strip(a) === strip(b)) return { verdict: 'EQUAL', fields: [] };
    const byIdA = [...a].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    const byIdB = [...b].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    const sameNames = strip(a.map((x) => x.name ?? null)) === strip(b.map((x) => x.name ?? null));
    if (strip(byIdA) === strip(byIdB) && sameNames) return { verdict: 'TIE_ORDER', fields: [] };
    if (byIdA.length !== byIdB.length || byIdA.some((x, i) => x.id !== byIdB[i].id)) return { verdict: 'DIFF', fields: ['<rows>'] };
    const fields = new Set<string>();
    byIdA.forEach((x, i) => {
      for (const k of Object.keys({ ...x, ...byIdB[i] })) if (strip(x[k]) !== strip(byIdB[i][k])) fields.add(k);
    });
    const onlyCanonical = [...fields].every((k) => CANONICAL_FIELDS.has(k));
    return { verdict: stale && onlyCanonical ? 'STALE_CANONICAL' : 'DIFF', fields: [...fields] };
  };

  for (const account of accounts) {
    const org = account.organizationId;
    const acc = account.id;
    const stale = staleAccounts.has(acc);
    const res: Record<string, Record<Verdict, number> & { sample: string[] }> = {};
    const note = (k: string, verdict: Verdict, id: string) => {
      res[k] ??= { EQUAL: 0, TIE_ORDER: 0, STALE_CANONICAL: 0, DIFF: 0, sample: [] };
      res[k][verdict] += 1;
      if (verdict !== 'EQUAL' && res[k].sample.length < 3) res[k].sample.push(`${id}${verdict === 'DIFF' ? '' : `(${verdict})`}`);
    };
    const noteList = (k: string, a: any[], b: any[], id: string) => {
      const c = classify(a, b, stale);
      note(k, c.verdict, c.verdict === 'DIFF' ? `${id} [${c.fields.join(',')}]` : id);
    };

    const [cOff, cOn] = await both('listCatalogues', () => query.listCatalogues(org, acc));
    noteList('catalogues', cOff, cOn, 'list');

    // Mọi trang sản phẩm (danh sách + meta phân trang phải trùng khớp).
    for (let page = 1; ; page += 1) {
      const [pOff, pOn] = await both('listProducts', () => query.listProducts(org, acc, { page, limit: PAGE }));
      if (strip(pOff.meta) !== strip(pOn.meta)) note('productPages', 'DIFF', `page ${page} [meta]`);
      else noteList('productPages', pOff.items, pOn.items, `page ${page}`);
      if (page >= pOff.meta.totalPages) break;
    }
    for (const search of ['shirt', 'hoodie', 'black', 'poster']) {
      const [sOff, sOn] = await both('searchProducts', () => query.listProducts(org, acc, { search, page: 1, limit: 50 }));
      if (strip(sOff.meta) !== strip(sOn.meta)) note('searches', 'DIFF', `${search} [meta]`);
      else noteList('searches', sOff.items, sOn.items, search);
    }

    // Biến thể: mọi sản phẩm có ánh xạ + mẫu tất định.
    const mappings = await prisma.fulfillmentProductMapping.findMany({
      where: { accountId: acc, deletedAt: null },
      select: { id: true, providerSku: true, providerVariantId: true, providerProductId: true },
    });
    const mappedExternal = new Set(mappings.map((m) => m.providerProductId).filter(Boolean) as string[]);
    const products = await prisma.fulfillmentProduct.findMany({
      where: { accountId: acc, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, externalProductId: true },
      orderBy: { id: 'asc' },
    });
    const step = Math.max(1, Math.floor(products.length / SAMPLE_PRODUCTS));
    const chosen = products.filter((p, i) => mappedExternal.has(p.externalProductId) || i % step === 0);
    for (const product of chosen) {
      const [vOff, vOn] = await both('listVariations', () => query.listVariations(org, product.id));
      noteList('variations', vOff, vOn, product.id);
    }

    // Giá của MỌI ánh xạ — đúng khoá luồng lưu ánh xạ dùng. Giá KHÔNG có ngoại lệ (không có STALE_CANONICAL).
    for (const m of mappings) {
      const [off, on] = await both('price', () =>
        price.lookup(org, acc, { externalVariantId: m.providerVariantId, sku: m.providerSku }),
      );
      note('mappingPrice', strip(off) === strip(on) ? 'EQUAL' : 'DIFF', m.id);
    }

    const [aOff, aOn] = await both('autoMapIndex', () => reader.loadMatchIndexRows(org, acc));
    // Không có thứ tự ở cả hai đường (luật ghép không phụ thuộc thứ tự) ⇒ so theo id.
    const byId = (rows: any[]) => [...rows].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    noteList('autoMapIndex', byId(aOff), byId(aOn), `${aOff.length}/${aOn.length} rows`);

    const [sOff, sOn] = await both('status', async () => {
      const s = await query.status(org, acc);
      return { c: s.catalogues, p: s.products, v: s.variants, col: s.colors, siz: s.sizes, last: s.lastSyncedAt };
    });
    const statusCore = (x: typeof sOff) => strip({ c: x.c, p: x.p, v: x.v, last: x.last });
    note(
      'statusCounts',
      strip(sOff) === strip(sOn) ? 'EQUAL' : stale && statusCore(sOff) === statusCore(sOn) ? 'STALE_CANONICAL' : 'DIFF',
      strip({ off: sOff, on: sOn }),
    );

    const hard = Object.entries(res).filter(([, r]) => r.DIFF > 0);
    failures += hard.length;
    const fmt = ([k, r]: [string, (typeof res)[string]]) => {
      const total = r.EQUAL + r.TIE_ORDER + r.STALE_CANONICAL + r.DIFF;
      const extra = [r.TIE_ORDER ? `tie-order ${r.TIE_ORDER}` : '', r.STALE_CANONICAL ? `stale-canonical ${r.STALE_CANONICAL}` : '']
        .filter(Boolean)
        .join(', ');
      return `${k} ${total - r.DIFF}/${total}${extra ? ` (${extra})` : ''}`;
    };
    lines.push(
      `${hard.length === 0 ? 'PASS' : 'FAIL'}  ${account.provider} ${acc}${stale ? ' [STALE]' : ''} — ` +
        Object.entries(res).map(fmt).join(' · ') +
        (hard.length ? `\n      DIFF: ${hard.map(([k, r]) => `${k}: ${r.sample.join(', ')}`).join(' | ')}` : ''),
    );
  }

  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : 0);
  console.log(lines.join('\n'));
  console.log('\nTHỜI GIAN (ms, gồm độ trễ mạng tới DB) — bảng cũ vs lớp mới: median / p95 (số lần)');
  for (const [op, t] of Object.entries(timing)) {
    console.log(`  ${op.padEnd(16)} legacy ${median(t.legacy)} / ${p95(t.legacy)}  ·  global ${median(t.global)} / ${p95(t.global)}  (${t.legacy.length})`);
  }
  console.log(`\nREADER STATS (cờ bật): ${strip(reader.readStats())}`);
  console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(`FAIL  ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
