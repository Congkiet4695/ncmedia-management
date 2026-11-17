/**
 * **Đồng bộ danh mục Sellerwix theo lịch — đọc MỘT lần, ghi cho TỪNG tài khoản** — Postgres THẬT, repository THẬT
 * (bảng cũ `fulfillment_*` + Global Catalog `provider_catalog_*` + lớp tài khoản `fulfillment_account_*`).
 *
 * Chỉ phần ĐỌC API được giả lập (không gọi Sellerwix thật): 2 nhóm thông tin xác thực (3 tài khoản dùng chung một
 * API key, 1 tài khoản key khác, giá khác) + 1 tài khoản API key hỏng.
 *
 * CHỈ chạy trên database thử dùng một lần:
 *   DATABASE_URL=postgresql://ncm_test@127.0.0.1:55432/ncm_shot node -r ts-node/register test/manual/e2e-sellerwix-shared-catalog.manual.ts
 */
import { FulfillmentCatalogItemStatus as S, PrismaClient } from '@prisma/client';
import { FulfillmentClientError, FulfillmentErrorClass } from '../../src/modules/fulfillment/exceptions/fulfillment.exceptions';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import type { SellerwixCatalogSnapshot } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-catalog.service';
import {
  FulfillmentCatalogSyncService,
  GLOBAL_CATALOG_DUAL_WRITE_FLAG,
} from '../../src/modules/fulfillment/services/fulfillment-catalog-sync.service';
import { MemoryLocks } from './support/fake-tiktok-promotion';

if (!/@127\.0\.0\.1:55432\//.test(process.env.DATABASE_URL ?? '')) throw new Error('Chỉ chạy trên database thử 127.0.0.1:55432');

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const RUN = `SWXSH${Date.now()}`;
const PRODUCTS = 5;
const VARIANTS_PER_PRODUCT = 4;

function snapshot(price: string): SellerwixCatalogSnapshot {
  const products = Array.from({ length: PRODUCTS }, (_, p) => `${RUN}-P${p}`);
  return {
    catalogues: [{ externalCatalogueId: `${RUN}-C1`, name: 'T-shirts', rawData: { id: 1 } }],
    products: products.map((sku) => ({
      externalProductId: sku,
      externalCatalogueId: `${RUN}-C1`,
      name: `Tee ${sku}`,
      sku,
      image: null,
      basePrice: null,
      currency: 'USD',
      variationsCount: null,
      status: S.ACTIVE,
      rawData: { sku },
    })),
    variants: products.flatMap((sku) =>
      Array.from({ length: VARIANTS_PER_PRODUCT }, (_, v) => ({
        externalProductId: sku,
        externalVariantId: `${sku}-V${v}`,
        sku: `${sku}-V${v}`,
        name: `Black / ${v}`,
        color: 'Black',
        size: String(v),
        price,
        status: S.ACTIVE,
        rawData: { sku: `${sku}-V${v}`, cost: price },
      })),
    ),
    apiCalls: 1 + 1 + PRODUCTS,
    warnings: [],
  };
}

async function main(): Promise<void> {
  // Tài khoản Sellerwix có sẵn trong database thử (lượt chạy cũ) cũng nằm trong lịch: không có trong bộ giả lập ⇒
  // đọc lỗi ⇒ tính là FAILED. Chỉ ĐẾM lời gọi / kết quả của tài khoản do lượt này tạo.
  const foreign = await prisma.fulfillmentAccount.count({ where: { provider: 'SELLERWIX', deletedAt: null, isActive: true } });
  const org = await prisma.organization.create({ data: { name: RUN, slug: RUN.toLowerCase() } as never });
  const mk = (name: string) =>
    prisma.fulfillmentAccount.create({
      data: { organizationId: org.id, provider: 'SELLERWIX', name: `${RUN} ${name}`, apiKeyEnc: 'not-a-real-key', apiKeyHint: 'none', isActive: true } as never,
    });
  const shared = [await mk('S1'), await mk('S2'), await mk('S3')];
  const other = await mk('OTHER');
  const broken = await mk('BROKEN');
  const keyOf = new Map<string, string>([
    ...shared.map((account) => [account.id, 'key-shared'] as [string, string]),
    [other.id, 'key-other'],
    [broken.id, 'key-revoked'],
  ]);
  const snapshots: Record<string, SellerwixCatalogSnapshot> = { 'key-shared': snapshot('8.22'), 'key-other': snapshot('9.99') };
  const fetched: string[] = [];
  const sellerwixCatalog = {
    credentialFingerprint: (account: { id: string }) => keyOf.get(account.id) ?? `foreign:${account.id}`,
    fetchCatalog: (account: { id: string }) => {
      const key = keyOf.get(account.id);
      if (!key) return Promise.reject(new Error('tài khoản ngoài lượt thử'));
      fetched.push(account.id);
      if (key === 'key-revoked') return Promise.reject(new FulfillmentClientError(FulfillmentErrorClass.AUTH, 'Invalid Token', 401));
      return Promise.resolve(snapshots[key]);
    },
  };
  const config = { get: (key: string, fallback?: unknown) => (key === GLOBAL_CATALOG_DUAL_WRITE_FLAG ? true : fallback) };
  const sync = new FulfillmentCatalogSyncService(
    prisma as never,
    new FulfillmentRepository(prisma as never),
    new FulfillmentCatalogRepository(prisma as never),
    {} as never,
    sellerwixCatalog as never,
    new MemoryLocks() as never,
    new FulfillmentGlobalCatalogRepository(prisma as never),
    config as never,
  );

  // Dữ liệu ngoài phạm vi phải đứng yên: ánh xạ / design / giá vốn của đơn.
  const untouched = async () => ({
    mappings: await prisma.fulfillmentProductMapping.count(),
    mappingBaseCost: String((await prisma.fulfillmentProductMapping.aggregate({ _sum: { baseCost: true } }))._sum.baseCost ?? 0),
    designs: await prisma.fulfillmentProductDesign.count(),
    orderBaseCost: String((await prisma.fulfillmentOrderItem.aggregate({ _sum: { baseCost: true } }))._sum.baseCost ?? 0),
  });
  const before = await untouched();

  // ---- Lượt 1 (00:00 UTC) ----
  const day1 = new Date();
  const r1 = await sync.syncSellerwixAccounts(day1);
  check(
    'S1 Đọc API MỘT lần cho 3 tài khoản cùng thông tin xác thực (+1 lần cho tài khoản key khác, +1 lần thử key hỏng)',
    r1.fetches === 2 && r1.sharedProjections === 2 && r1.succeeded === 4 && r1.failed === 1 + foreign && fetched.length === 3,
    `fetches=${r1.fetches} shared=${r1.sharedProjections} ok=${r1.succeeded} failed=${r1.failed} (gồm ${foreign} tài khoản có sẵn) · lời gọi đọc thật: ${fetched.length}`,
  );

  const N = PRODUCTS * VARIANTS_PER_PRODUCT;
  const legacy = await prisma.fulfillmentVariant.groupBy({
    by: ['accountId', 'price'],
    where: { accountId: { in: [...shared, other].map((account) => account.id) }, deletedAt: null },
    _count: { _all: true },
  });
  const legacyOk =
    shared.every((account) => legacy.some((row) => row.accountId === account.id && row.price === '8.22' && row._count._all === N)) &&
    legacy.some((row) => row.accountId === other.id && row.price === '9.99' && row._count._all === N) &&
    legacy.length === 4;
  check('S2 Bảng cũ: MỖI tài khoản có đủ biến thể của CHÍNH nó, đúng giá của nhóm mình (không trộn)', legacyOk, JSON.stringify(legacy.map((row) => [row.accountId.slice(0, 4), row.price, row._count._all])));

  const globalCount = await prisma.providerCatalogVariant.count({ where: { provider: 'SELLERWIX', externalVariantId: { startsWith: RUN } } });
  check('S3 Global Catalog: mỗi biến thể đúng MỘT bản ghi (không nhân bản theo tài khoản)', globalCount === N, `${globalCount}/${N}`);

  const accountRows = await prisma.fulfillmentAccountVariant.groupBy({
    by: ['accountId', 'price'],
    where: { accountId: { in: [...shared, other, broken].map((account) => account.id) }, deletedAt: null },
    _count: { _all: true },
  });
  const accountOk =
    shared.every((account) => accountRows.some((row) => row.accountId === account.id && row.price === '8.22' && row._count._all === N)) &&
    accountRows.some((row) => row.accountId === other.id && row.price === '9.99' && row._count._all === N) &&
    !accountRows.some((row) => row.accountId === broken.id);
  check('S4 Lớp tài khoản (fulfillment_account_variants): giá / trạng thái RIÊNG từng tài khoản; tài khoản key hỏng không có dữ liệu giả', accountOk, JSON.stringify(accountRows.map((row) => [row.accountId.slice(0, 4), row.price, row._count._all])));

  const logs = await prisma.fulfillmentSyncLog.findMany({
    where: { accountId: { in: [...shared, other, broken].map((account) => account.id) } },
    orderBy: { startedAt: 'asc' },
    select: { accountId: true, status: true, apiCalls: true, trigger: true, errorMessage: true },
  });
  const logOf = (id: string) => logs.find((log) => log.accountId === id);
  check(
    'S5 Nhật ký riêng từng tài khoản: tài khoản đọc ghi số lời gọi thật, tài khoản dùng chung ghi 0; key hỏng FAILED nêu lý do',
    logOf(shared[0].id)?.apiCalls === 7 && logOf(shared[1].id)?.apiCalls === 0 && logOf(shared[2].id)?.apiCalls === 0 &&
      logOf(other.id)?.apiCalls === 7 && logOf(broken.id)?.status === 'FAILED' && logOf(broken.id)?.errorMessage === 'Invalid Token' &&
      logs.every((log) => log.trigger === 'CRON'),
    JSON.stringify(logs.map((log) => [(log.accountId ?? '').slice(0, 4), log.status, log.apiCalls])),
  );

  // ---- Lịch bắn lại trong CÙNG ngày (restart / cron lặp) ----
  fetched.length = 0;
  const r2 = await sync.syncSellerwixAccounts(day1);
  check(
    'S6 Chạy lại trong cùng ngày UTC ⇒ 4 tài khoản đã xong bị bỏ qua, KHÔNG đọc lại API (chỉ thử lại tài khoản FAILED)',
    r2.skippedToday === 4 && fetched.length === 1 && fetched[0] === broken.id,
    `skipped=${r2.skippedToday} · đọc lại: ${fetched.length}`,
  );

  // ---- Ngày hôm sau: idempotent ----
  fetched.length = 0;
  const r3 = await sync.syncSellerwixAccounts(new Date(day1.getTime() + 24 * 60 * 60_000));
  const globalAfter = await prisma.providerCatalogVariant.count({ where: { provider: 'SELLERWIX', externalVariantId: { startsWith: RUN } } });
  const legacyAfter = await prisma.fulfillmentVariant.count({ where: { accountId: { in: [...shared, other].map((account) => account.id) }, deletedAt: null } });
  check(
    'S7 Ngày hôm sau chạy lại ⇒ idempotent: cùng số bản ghi global / bảng cũ, vẫn một lần đọc mỗi nhóm',
    r3.fetches === 2 && globalAfter === N && legacyAfter === 4 * N,
    `fetches=${r3.fetches} global=${globalAfter} legacy=${legacyAfter}`,
  );

  const after = await untouched();
  check(
    'S8 Ánh xạ sản phẩm / Design / Base Cost của ánh xạ / Base Cost của đơn KHÔNG đổi',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );

  // ---- Dọn dữ liệu của chính lượt này ----
  const ids = [...shared, other, broken].map((account) => account.id);
  await prisma.fulfillmentAccountVariant.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentAccountProduct.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentAccountCatalogue.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.providerCatalogVariant.deleteMany({ where: { provider: 'SELLERWIX', externalVariantId: { startsWith: RUN } } });
  await prisma.providerCatalogProduct.deleteMany({ where: { provider: 'SELLERWIX', externalProductId: { startsWith: RUN } } });
  await prisma.providerCatalogCatalogue.deleteMany({ where: { provider: 'SELLERWIX', externalCatalogueId: { startsWith: RUN } } });
  await prisma.fulfillmentVariant.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentProduct.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentCatalogue.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentSyncLog.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.fulfillmentAccount.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
