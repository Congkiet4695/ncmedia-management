/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật) cho **master data Sellerwix** — đồng bộ danh mục dùng chung.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-sellerwix-catalog.manual.ts
 *
 * Đường đi THẬT: SellerwixApiClient (code thật, header X-Api-Key) → SellerwixCatalogService →
 * FulfillmentCatalogSyncService → FulfillmentCatalogRepository → PostgreSQL; đọc lại qua
 * FulfillmentCatalogQueryService như màn hình Cấu hình sản phẩm.
 *
 * Sellerwix được giả lập ở tầng HTTP (\`global.fetch\`) theo đúng hình dạng response trong collection
 * Postman (category = mảng, category/{id}/product = mảng, product/{sku} = { data, paging.next_page }).
 * KHÔNG gọi Sellerwix thật (không có API Key trong môi trường này).
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối.
 */
import { PrismaClient } from '@prisma/client';
import { MemoryLocks } from './support/fake-tiktok-promotion';
import { SellerwixApiClient } from '../../src/modules/fulfillment/sellerwix/clients/sellerwix-api.client';
import { SellerwixCatalogService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-catalog.service';
import { SellerwixCredentialService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-credential.service';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import { FulfillmentCatalogSyncService } from '../../src/modules/fulfillment/services/fulfillment-catalog-sync.service';
import { FulfillmentCatalogQueryService } from '../../src/modules/fulfillment/services/fulfillment-catalog-query.service';

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const RUN = `SWXE2E${Date.now()}`;

// ---------------------------------------------------------------------------
// Sellerwix giả lập
// ---------------------------------------------------------------------------
type FakeVariant = { sku: string; title: string; color: string; size: string; cost: number; active?: boolean };
const fake = {
  apiKeysSeen: new Set<string>(),
  categories: [] as Array<{ id: number; title: string }>,
  productsByCategory: new Map<number, Array<{ sku: string; title: string; active?: boolean }>>(),
  variantsByProduct: new Map<string, FakeVariant[]>(),
  failCategory: null as number | null,
  pageSize: 10,
  calls: 0,
};
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response;
}
(global as any).fetch = async (url: string, init: RequestInit) => {
  fake.calls += 1;
  fake.apiKeysSeen.add(String((init.headers as Record<string, string>)['X-Api-Key']));
  const u = new URL(url);
  const path = u.pathname.replace('/public-api', '');
  if (path === '/v1/category') return json(200, fake.categories);
  let m = path.match(/^\/v1\/category\/(\d+)\/product$/);
  if (m) {
    const id = Number(m[1]);
    if (fake.failCategory === id) return json(500, { code: 500, message: 'Internal Server Error' });
    return json(200, fake.productsByCategory.get(id) ?? []);
  }
  m = path.match(/^\/v1\/product\/(.+)$/);
  if (m) {
    const all = fake.variantsByProduct.get(decodeURIComponent(m[1])) ?? [];
    const start = Number(u.searchParams.get('next_page') ?? 0);
    const page = all.slice(start, start + fake.pageSize);
    const next = start + fake.pageSize < all.length ? String(start + fake.pageSize) : '';
    return json(200, {
      data: page.map((v) => ({
        sku: v.sku, title: v.title, color: { name: v.color }, size: { name: v.size }, cost: v.cost,
        active: v.active ?? true, print_areas: [{ key: 'CF', display_name: 'Front' }],
      })),
      paging: { next_page: next, total: all.length },
    });
  }
  return json(404, { code: 404, message: 'not found' });
};

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: 'asc' } });
  if (orgs.length < 2) throw new Error('Cần ít nhất 2 tổ chức trong database local');
  const [ownerOrg, otherOrg] = orgs;

  // Tài khoản Sellerwix DÙNG CHUNG (Super Admin) — CHỈ API Key.
  const account = await prisma.fulfillmentAccount.create({
    data: {
      organizationId: ownerOrg.id,
      provider: 'SELLERWIX',
      name: `${RUN} Sellerwix`,
      apiKeyEnc: 'plain-api-key-for-test',
      apiKeyHint: 'test',
      isGlobal: true,
      isActive: true,
      providerConfig: { storeId: 'store-1' },
      defaultShippingMethod: '',
    } as never,
  });

  const config = { get: (_k: string, fallback?: unknown) => fallback } as never;
  const client = new SellerwixApiClient(config);
  jest_spyNoSleep(client);
  const credentials = new SellerwixCredentialService({ decrypt: (v: string) => v, encrypt: (v: string) => v } as never);
  const repo = new FulfillmentRepository(prisma as never);
  const catalogRepo = new FulfillmentCatalogRepository(prisma as never);
  const locks = new MemoryLocks();
  const sync = new FulfillmentCatalogSyncService(
    prisma as never, repo, catalogRepo, {} as never, new SellerwixCatalogService(client, credentials), locks as never,
  );
  const query = new FulfillmentCatalogQueryService(repo, catalogRepo);
  const count = async () => ({
    catalogues: await prisma.fulfillmentCatalogue.count({ where: { accountId: account.id } }),
    products: await prisma.fulfillmentProduct.count({ where: { accountId: account.id } }),
    variants: await prisma.fulfillmentVariant.count({ where: { accountId: account.id } }),
  });

  try {
    // ------------------------------------------------ dữ liệu: > 20 biến thể, nhiều trang
    fake.categories = [{ id: 1, title: 'T-Shirts' }, { id: 2, title: 'Best sellers' }];
    fake.productsByCategory.set(1, [{ sku: `${RUN}-TEE`, title: 'Unisex T-Shirt | Gildan 5000' }, { sku: `${RUN}-HOODIE`, title: 'Hoodie' }]);
    fake.productsByCategory.set(2, [{ sku: `${RUN}-TEE`, title: 'Unisex T-Shirt | Gildan 5000' }]);
    const colors = ['Black', 'White', 'Navy', 'Red', 'Sand'];
    const sizes = ['S', 'M', 'L', 'XL', '2XL'];
    fake.variantsByProduct.set(`${RUN}-TEE`, colors.flatMap((c) => sizes.map((s) => ({ sku: `${RUN}-TEE-${c}-${s}`, title: `${c} / ${s}`, color: c, size: s, cost: 8.5 }))));
    fake.variantsByProduct.set(`${RUN}-HOODIE`, [{ sku: `${RUN}-HOODIE-BLK-M`, title: 'Black / M', color: 'Black', size: 'M', cost: 18 }]);

    // ------------------------------------------------ 1. Sync lần đầu
    const r1 = await sync.syncAccount(ownerOrg.id, account.id, 'MANUAL' as never);
    const c1 = await count();
    check('C1. sync lần đầu: 2 danh mục · 2 sản phẩm (TEE nằm ở 2 danh mục ⇒ 1 bản ghi) · 26 biến thể (25 qua 3 trang)',
      c1.catalogues === 2 && c1.products === 2 && c1.variants === 26 && r1.complete, JSON.stringify(c1));
    check('Sellerwix nhận CHỈ header X-Api-Key = API Key đã lưu', fake.apiKeysSeen.size === 1 && fake.apiKeysSeen.has('plain-api-key-for-test'));
    const status1 = await catalogRepo.countActive(account.id);
    check('sync status: đếm 5 màu, 5 size (Black/White/Navy/Red/Sand × S…2XL)', status1.colors === 5 && status1.sizes === 5, JSON.stringify(status1));
    const log1 = await prisma.fulfillmentSyncLog.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
    check('nhật ký đồng bộ: SUCCESS (RUNNING → SUCCESS, cùng MỘT dòng)', log1?.status === 'SUCCESS' && (await prisma.fulfillmentSyncLog.count({ where: { accountId: account.id } })) === 1);

    const teeBefore = await prisma.fulfillmentProduct.findFirstOrThrow({ where: { accountId: account.id, externalProductId: `${RUN}-TEE` } });

    // ------------------------------------------------ 2. Sync lần hai — idempotent
    await sync.syncAccount(ownerOrg.id, account.id, 'MANUAL' as never);
    const c2 = await count();
    const teeAfter = await prisma.fulfillmentProduct.findFirstOrThrow({ where: { accountId: account.id, externalProductId: `${RUN}-TEE` } });
    check('C2/C3. sync lần hai: KHÔNG trùng (số bản ghi y hệt, id nội bộ giữ nguyên)',
      JSON.stringify(c2) === JSON.stringify(c1) && teeAfter.id === teeBefore.id, JSON.stringify(c2));

    // ------------------------------------------------ 3. Provider thêm/sửa/gỡ
    fake.productsByCategory.set(1, [
      { sku: `${RUN}-TEE`, title: 'Unisex T-Shirt | Gildan 5000 (new)' },
      { sku: `${RUN}-HOODIE`, title: 'Hoodie' },
      { sku: `${RUN}-MUG`, title: 'Mug 11oz' },
    ]);
    fake.variantsByProduct.set(`${RUN}-MUG`, [{ sku: `${RUN}-MUG-WHT`, title: 'White / 11oz', color: 'White', size: '11oz', cost: 4 }]);
    const teeVariants = fake.variantsByProduct.get(`${RUN}-TEE`)!.filter((v) => v.sku !== `${RUN}-TEE-Sand-2XL`);
    teeVariants[0] = { ...teeVariants[0], cost: 9.25 };
    fake.variantsByProduct.set(`${RUN}-TEE`, teeVariants);
    await sync.syncAccount(ownerOrg.id, account.id, 'MANUAL' as never);
    const tee3 = await prisma.fulfillmentProduct.findFirstOrThrow({ where: { accountId: account.id, externalProductId: `${RUN}-TEE` } });
    const removed = await prisma.fulfillmentVariant.findFirst({ where: { accountId: account.id, externalVariantId: `${RUN}-TEE-Sand-2XL` } });
    const repriced = await prisma.fulfillmentVariant.findFirst({ where: { accountId: account.id, externalVariantId: teeVariants[0].sku } });
    check('C4. sản phẩm MỚI (MUG) được thêm', (await prisma.fulfillmentProduct.count({ where: { accountId: account.id, externalProductId: `${RUN}-MUG` } })) === 1);
    check('C5. sản phẩm SỬA (tên) được cập nhật tại chỗ, id giữ nguyên', tee3.id === teeBefore.id && tee3.name.endsWith('(new)'));
    check('C5. giá vốn biến thể cập nhật', repriced?.price === '9.25', String(repriced?.price));
    check('C6. biến thể bị GỠ ⇒ ARCHIVED (không xoá — ánh xạ cũ không trỏ vào hư không)', removed?.status === 'ARCHIVED', String(removed?.status));

    // ------------------------------------------------ 4. Lỗi giữa chừng ⇒ PARTIAL, KHÔNG archive
    fake.failCategory = 1;
    const r4 = await sync.syncAccount(ownerOrg.id, account.id, 'MANUAL' as never);
    const activeAfterFail = await prisma.fulfillmentProduct.count({ where: { accountId: account.id, status: 'ACTIVE' } });
    const log4 = await prisma.fulfillmentSyncLog.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
    check('C7. danh mục đọc lỗi giữa chừng ⇒ complete=false, nhật ký PARTIAL kèm lý do, KHÔNG archive nửa danh mục',
      !r4.complete && log4?.status === 'PARTIAL' && activeAfterFail === 3 && Boolean(log4?.errorMessage), `active=${activeAfterFail} status=${log4?.status}`);

    // ------------------------------------------------ 5. Retry
    fake.failCategory = null;
    const r5 = await sync.syncAccount(ownerOrg.id, account.id, 'MANUAL' as never);
    check('C8. retry ⇒ SUCCESS, đủ 3 sản phẩm', r5.complete && (await prisma.fulfillmentProduct.count({ where: { accountId: account.id, status: 'ACTIVE' } })) === 3);

    // ------------------------------------------------ 6. Chạy nền + chống chạy song song
    const started = await sync.startSync(ownerOrg.id, account.id, 'MANUAL' as never);
    let busy = '';
    try { await sync.startSync(ownerOrg.id, account.id, 'MANUAL' as never); } catch (e: any) { busy = e?.response?.code; }
    check('đồng bộ NỀN trả về ngay (RUNNING); bấm lần hai khi đang chạy ⇒ 409 FULFILLMENT_CATALOG_SYNC_BUSY',
      started.status === 'RUNNING' && busy === 'FULFILLMENT_CATALOG_SYNC_BUSY', busy);
    const runningLog = await prisma.fulfillmentSyncLog.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
    check('ngay sau khi bắt đầu: nhật ký RUNNING (màn hình thấy "Đang đồng bộ" kể cả khi tải lại trang)', runningLog?.status === 'RUNNING');
    for (let i = 0; i < 50; i++) {
      const last = await prisma.fulfillmentSyncLog.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
      if (last?.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const doneLog = await prisma.fulfillmentSyncLog.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
    check('lượt nền chạy xong ⇒ SUCCESS', doneLog?.status === 'SUCCESS', String(doneLog?.status));

    // ------------------------------------------------ 7. Tổ chức KHÁC đọc CÙNG master data (tài khoản dùng chung)
    const page = await query.listProducts(otherOrg.id, account.id, { search: 'gildan', page: 1, limit: 20 });
    const tee = page.items.find((p) => p.externalProductId === `${RUN}-TEE`);
    check('C9. tổ chức khác tìm (phía server) "gildan" ⇒ thấy sản phẩm của danh mục dùng chung', Boolean(tee) && page.meta.total >= 1);
    let variations: Awaited<ReturnType<typeof query.listVariations>> = [];
    let variationError = '';
    try { variations = await query.listVariations(otherOrg.id, tee!.id); } catch (e: any) { variationError = e?.response?.code ?? e.message; }
    check('🔴 B4. tổ chức khác tải ĐƯỢC biến thể của sản phẩm dùng chung (trước đây 404 ⇒ không chọn được Provider Product/biến thể)',
      variations.length === 24 && !variationError, variationError || `${variations.length} biến thể`);
    check('biến thể mang màu/size/SKU nhà cung cấp + vùng in; KHÔNG có UUID trong SKU hiển thị',
      variations.every((v) => v.color && v.size && v.sku?.startsWith(`${RUN}-TEE-`) && (v.printAreas?.length ?? 0) > 0));
    const stranger = await prisma.organization.create({ data: { name: `${RUN} stranger`, slug: `swx-${Date.now()}` } as never }).catch(() => null);
    if (stranger) {
      await prisma.fulfillmentAccount.update({ where: { id: account.id }, data: { isGlobal: false } });
      let denied = '';
      try { await query.listVariations(stranger.id, tee!.id); } catch (e: any) { denied = e?.response?.code ?? 'ERR'; }
      check('tài khoản KHÔNG dùng chung ⇒ tổ chức lạ KHÔNG đọc được biến thể (hàng rào tenant giữ nguyên)', denied === 'FULFILLMENT_CATALOG_PRODUCT_NOT_FOUND', denied);
      await prisma.fulfillmentAccount.update({ where: { id: account.id }, data: { isGlobal: true } });
      await prisma.organization.delete({ where: { id: stranger.id } }).catch(() => undefined);
    }

    // ------------------------------------------------ 8. Lưu cấu hình ⇒ mở lại vẫn đúng (id canonical)
    const variant = variations.find((v) => v.color === 'Black' && v.size === 'XL')!;
    const mapping = await prisma.fulfillmentProductMapping.create({
      data: {
        organizationId: otherOrg.id,
        accountId: account.id,
        provider: 'SELLERWIX',
        tiktokProductId: `${RUN}-TT-1`,
        sellerSku: `${RUN}-SELLER-1`,
        providerSku: variant.sku,
        providerProductId: tee!.externalProductId,
        providerVariantId: variant.externalVariantId,
        providerProductName: tee!.name,
        providerVariantName: variant.name,
        providerColor: variant.color,
        providerSize: variant.size,
      } as never,
    });
    // Mở lại: ô sản phẩm dựng lại bằng tra CHÍNH XÁC theo id nhà cung cấp; biến thể theo externalVariantId.
    const hydrated = await query.listProducts(otherOrg.id, account.id, { externalProductId: mapping.providerProductId!, page: 1, limit: 1 });
    const hydratedVariants = await query.listVariations(otherOrg.id, hydrated.items[0].id);
    const hydratedVariant = hydratedVariants.find((v) => v.externalVariantId === mapping.providerVariantId);
    check('B7-B10. mở lại cấu hình: sản phẩm + biến thể + màu + size dựng lại ĐÚNG giá trị đã lưu',
      hydrated.items[0]?.id === tee!.id && hydratedVariant?.color === 'Black' && hydratedVariant?.size === 'XL');
    check('B12. giá trị gửi Sellerwix là ID/SKU NHÀ CUNG CẤP, không phải UUID nội bộ',
      mapping.providerSku === `${RUN}-TEE-Black-XL` && mapping.providerProductId === `${RUN}-TEE` && !/^[0-9a-f-]{36}$/.test(mapping.providerSku));
  } finally {
    await prisma.fulfillmentProductMapping.deleteMany({ where: { accountId: account.id } });
    await prisma.fulfillmentSyncLog.deleteMany({ where: { accountId: account.id } });
    await prisma.fulfillmentAccount.delete({ where: { id: account.id } });
    results.push('INFO  đã dọn dữ liệu test');
  }
}

/** Client có điều tiết 100 req/phút — test không chờ thật. */
function jest_spyNoSleep(client: SellerwixApiClient) {
  (client as any).sleep = () => Promise.resolve();
}

main()
  .catch((error) => results.push(`FAIL  lỗi không mong đợi — ${(error as Error).stack ?? (error as Error).message}`))
  .finally(async () => {
    console.log(results.join('\n'));
    await prisma.$disconnect();
    process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
  });
