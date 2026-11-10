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

  for (const account of accounts) {
    const org = account.organizationId;
    const acc = account.id;
    const res: Record<string, { compared: number; diff: number; sample: string[] }> = {};
    const note = (k: string, equal: boolean, id: string) => {
      res[k] ??= { compared: 0, diff: 0, sample: [] };
      res[k].compared += 1;
      if (!equal) {
        res[k].diff += 1;
        if (res[k].sample.length < 3) res[k].sample.push(id);
      }
    };

    const [cOff, cOn] = await both('listCatalogues', () => query.listCatalogues(org, acc));
    note('catalogues', strip(cOff) === strip(cOn), 'list');

    // Mọi trang sản phẩm.
    for (let page = 1; ; page += 1) {
      const [pOff, pOn] = await both('listProducts', () => query.listProducts(org, acc, { page, limit: PAGE }));
      note('productPages', strip(pOff) === strip(pOn), `page ${page}`);
      if (page >= pOff.meta.totalPages) break;
    }
    for (const search of ['shirt', 'hoodie', 'black', 'poster']) {
      const [sOff, sOn] = await both('searchProducts', () => query.listProducts(org, acc, { search, page: 1, limit: 50 }));
      note('searches', strip(sOff) === strip(sOn), search);
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
      const equal = strip(vOff) === strip(vOn);
      // Vùng in là metadata chuẩn: tài khoản có dữ liệu CŨ hơn nguồn global được phép khác ĐÚNG trường này.
      const equalButPrintAreas =
        strip(vOff.map((v) => ({ ...v, printAreas: null }))) === strip(vOn.map((v) => ({ ...v, printAreas: null })));
      note('variations', equal || equalButPrintAreas, product.id);
      if (!equal && equalButPrintAreas) note('variations.printAreasOnly', false, product.id);
    }

    // Giá của MỌI ánh xạ — đúng khoá luồng lưu ánh xạ dùng.
    for (const m of mappings) {
      const [off, on] = await both('price', () =>
        price.lookup(org, acc, { externalVariantId: m.providerVariantId, sku: m.providerSku }),
      );
      note('mappingPrice', strip(off) === strip(on), m.id);
    }

    const [aOff, aOn] = await both('autoMapIndex', () => reader.loadMatchIndexRows(org, acc));
    const norm = (rows: Array<{ id: string }>) => strip([...rows].sort((x, y) => x.id.localeCompare(y.id)));
    note('autoMapIndex', norm(aOff) === norm(aOn), `${aOff.length}/${aOn.length} rows`);

    const [sOff, sOn] = await both('status', async () => {
      const s = await query.status(org, acc);
      return { c: s.catalogues, p: s.products, v: s.variants, col: s.colors, siz: s.sizes, last: s.lastSyncedAt };
    });
    note('statusCounts', strip(sOff) === strip(sOn), strip({ off: sOff, on: sOn }));

    const hard = Object.entries(res).filter(([k, r]) => k !== 'variations.printAreasOnly' && r.diff > 0);
    failures += hard.length;
    lines.push(
      `${hard.length === 0 ? 'PASS' : 'FAIL'}  ${account.provider} ${acc} — ` +
        Object.entries(res).map(([k, r]) => `${k} ${r.compared - r.diff}/${r.compared}`).join(' · ') +
        (hard.length ? `\n      lệch: ${hard.map(([k, r]) => `${k}: ${r.sample.join(', ')}`).join(' | ')}` : '') +
        (res['variations.printAreasOnly']?.diff ? `\n      chỉ khác vùng in (tài khoản có dữ liệu cũ hơn nguồn global): ${res['variations.printAreasOnly'].diff} sản phẩm` : ''),
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
