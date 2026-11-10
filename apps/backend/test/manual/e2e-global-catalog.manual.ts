/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật) cho **Global Catalog** — Test 1–12 của đặc tả Phase 1 + 2.
 *
 * Chạy (CHỈ trên database thử nghiệm — script tạo và tự dọn dữ liệu):
 *   DATABASE_URL=postgresql://…/ncm_test node -r ts-node/register test/manual/e2e-global-catalog.manual.ts
 *
 * Đường đi THẬT: SellerwixApiClient → SellerwixCatalogService → FulfillmentCatalogSyncService (ghi bảng cũ
 * + DUAL WRITE) → FulfillmentGlobalCatalogRepository → PostgreSQL; đọc qua FulfillmentCatalogReader /
 * FulfillmentCatalogQueryService / FulfillmentVariantPriceService như màn hình và luồng lưu ánh xạ.
 * Sellerwix giả lập ở tầng HTTP (`global.fetch`), giá trả về THEO API KEY (tài khoản A ≠ tài khoản B).
 * Mango ghi thẳng bảng cũ bằng FulfillmentCatalogRepository (cùng hàm luồng đồng bộ Mango dùng).
 */
import { PrismaClient, FulfillmentCatalogItemStatus as S } from '@prisma/client';
import { MemoryLocks } from './support/fake-tiktok-promotion';
import { SellerwixApiClient } from '../../src/modules/fulfillment/sellerwix/clients/sellerwix-api.client';
import { SellerwixCatalogService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-catalog.service';
import { SellerwixCredentialService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-credential.service';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import {
  FulfillmentCatalogSyncService,
  GLOBAL_CATALOG_DUAL_WRITE_FLAG,
} from '../../src/modules/fulfillment/services/fulfillment-catalog-sync.service';
import { FulfillmentCatalogQueryService } from '../../src/modules/fulfillment/services/fulfillment-catalog-query.service';
import {
  FulfillmentCatalogReader,
  GLOBAL_CATALOG_READ_FLAG,
} from '../../src/modules/fulfillment/services/fulfillment-catalog-reader.service';
import { FulfillmentVariantPriceService } from '../../src/modules/fulfillment/services/fulfillment-variant-price.service';
import { findAutoMapCandidates } from '../../src/modules/fulfillment/shared/auto-map-match';

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const RUN = `GCE2E${Date.now()}`;
const CAT_ID = 900000000 + Math.floor(Math.random() * 99999999);
const strip = (value: unknown) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Sellerwix giả lập — giá THEO API KEY
// ---------------------------------------------------------------------------
const costByKey = new Map<string, number>();
const failVariantsForKey = new Set<string>();
const variants = ['Black', 'White'].flatMap((color) =>
  ['S', 'M'].map((size) => ({ sku: `${RUN}-TEE-${color}-${size}`, title: `${color} / ${size}`, color, size })),
);
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response;
}
(global as any).fetch = async (url: string, init: RequestInit) => {
  const key = String((init.headers as Record<string, string>)['X-Api-Key']);
  const path = new URL(url).pathname.replace('/public-api', '');
  if (path === '/v1/category') return json(200, [{ id: CAT_ID, title: `${RUN} T-Shirts` }]);
  if (path === `/v1/category/${CAT_ID}/product`) return json(200, [{ sku: `${RUN}-TEE`, title: `${RUN} Unisex Tee`, img_src: 'https://img/tee.png' }]);
  if (path === `/v1/product/${RUN}-TEE`) {
    // Lượt đọc biến thể hỏng ⇒ đồng bộ đọc THIẾU (partial) — bảng cũ không archive.
    if (failVariantsForKey.has(key)) return json(500, { code: 500, message: 'Internal Server Error' });
    return json(200, {
      data: variants.map((v) => ({
        sku: v.sku, title: v.title, color: { name: v.color }, size: { name: v.size }, cost: costByKey.get(key),
        active: true, print_areas: [{ key: 'CF', display_name: 'Front' }, { key: 'CB', display_name: 'Back' }],
      })),
      paging: { next_page: '', total: variants.length },
    });
  }
  return json(404, { code: 404, message: 'not found' });
};

async function main(): Promise<void> {
  const orgA = await prisma.organization.create({ data: { name: `${RUN} A`, slug: `${RUN.toLowerCase()}-a` } as never });
  const orgB = await prisma.organization.create({ data: { name: `${RUN} B`, slug: `${RUN.toLowerCase()}-b` } as never });
  const mkAccount = (organizationId: string, provider: 'SELLERWIX' | 'MANGO', name: string, apiKey: string) =>
    prisma.fulfillmentAccount.create({
      data: {
        organizationId, provider, name: `${RUN} ${name}`, apiKeyEnc: apiKey, apiKeyHint: apiKey.slice(-4),
        isActive: true, providerConfig: provider === 'SELLERWIX' ? { storeId: 'store-1' } : undefined,
      } as never,
    });
  const A = await mkAccount(orgA.id, 'SELLERWIX', 'Sellerwix A', `${RUN}-key-A`);
  const B = await mkAccount(orgB.id, 'SELLERWIX', 'Sellerwix B', `${RUN}-key-B`);
  const C = await mkAccount(orgA.id, 'SELLERWIX', 'Sellerwix C (chưa chiếu)', `${RUN}-key-C`);
  const M = await mkAccount(orgA.id, 'MANGO', 'Mango', `${RUN}-key-M`);
  // Tài khoản DÙNG CHUNG (is_global) của tổ chức A — tổ chức B được dùng (ý nghĩa is_global giữ nguyên).
  const SH = await mkAccount(orgA.id, 'SELLERWIX', 'Sellerwix Shared', `${RUN}-key-S`);
  costByKey.set(`${RUN}-key-A`, 5.0);
  costByKey.set(`${RUN}-key-B`, 5.8);
  costByKey.set(`${RUN}-key-S`, 7.0);

  let readOn = false;
  const config = {
    get: (k: string, fallback?: unknown) =>
      k === GLOBAL_CATALOG_READ_FLAG ? readOn : k === GLOBAL_CATALOG_DUAL_WRITE_FLAG ? true : fallback,
  } as never;
  const client = new SellerwixApiClient({ get: (_k: string, fallback?: unknown) => fallback } as never);
  (client as any).sleep = () => Promise.resolve();
  const credentials = new SellerwixCredentialService({ decrypt: (v: string) => v, encrypt: (v: string) => v } as never);
  const repo = new FulfillmentRepository(prisma as never);
  const catalogRepo = new FulfillmentCatalogRepository(prisma as never);
  const globalRepo = new FulfillmentGlobalCatalogRepository(prisma as never);
  const reader = new FulfillmentCatalogReader(catalogRepo, globalRepo, config);
  const sync = new FulfillmentCatalogSyncService(
    prisma as never, repo, catalogRepo, {} as never,
    new SellerwixCatalogService(client, credentials, { get: () => 'USD' } as never),
    new MemoryLocks() as never, globalRepo, config,
  );
  const query = new FulfillmentCatalogQueryService(repo, reader);
  const price = new FulfillmentVariantPriceService(reader);
  const accounts = [A.id, B.id, C.id, M.id];
  const counts = async () => ({
    globalProducts: await prisma.providerCatalogProduct.count({ where: { externalProductId: { startsWith: RUN } } }),
    globalVariants: await prisma.providerCatalogVariant.count({ where: { externalVariantId: { startsWith: RUN } } }),
    accountProducts: await prisma.fulfillmentAccountProduct.count({ where: { accountId: { in: accounts } } }),
    accountVariants: await prisma.fulfillmentAccountVariant.count({ where: { accountId: { in: accounts } } }),
  });

  try {
    // ------------------------------------------------ đồng bộ thật + dual write
    const rA = await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    const rB = await sync.syncAccount(orgB.id, B.id, 'MANUAL' as never);
    check('Dual write chạy sau đồng bộ (A, B)', rA.globalCatalog?.status === 'PROJECTED' && rB.globalCatalog?.status === 'PROJECTED',
      `${rA.globalCatalog?.status} / ${rB.globalCatalog?.status}`);

    // Mango: ghi bảng cũ bằng cùng repository luồng đồng bộ dùng — 2 variation CHUNG SKU, khác UUID, khác giá,
    // và một variation có id nhà cung cấp TRÙNG chuỗi với SKU biến thể Sellerwix (Test 3).
    const syncedAt = new Date();
    const mScope = { organizationId: orgA.id, accountId: M.id, provider: 'MANGO' as const };
    const mCat = await catalogRepo.upsertCatalogues(mScope, [{ externalCatalogueId: `${RUN}-cat`, name: `${RUN} Hoodies` }], syncedAt);
    const mProd = await catalogRepo.upsertProducts(mScope, [{
      externalProductId: `${RUN}-mango-product-uuid`, externalCatalogueId: `${RUN}-cat`, name: `${RUN} Embroidery Hoodie`, sku: 'EMB',
      image: null, basePrice: '20.00', currency: 'USD', variationsCount: 3, status: S.ACTIVE,
      rawData: { id: `${RUN}-mango-product-uuid`, base_price: '20.00', currency: 'USD', name: 'Hoodie' },
    }], mCat, syncedAt);
    const mangoVariant = (id: string, line: string, p: string) => ({
      externalProductId: `${RUN}-mango-product-uuid`, externalVariantId: id, sku: `${RUN}-EM-NY-S`, name: 'Navy / S',
      color: 'Navy', size: 'S', price: p, status: S.ACTIVE,
      rawData: { id, sku: `${RUN}-EM-NY-S`, price: p, production_line: line, attributes: { tier: 'GOLD', print_areas: ['back'] } },
    });
    await catalogRepo.upsertVariants(mScope, [
      mangoVariant(`${RUN}-variation-uuid-1`, 'VNEMB', '28.50'),
      mangoVariant(`${RUN}-variation-uuid-2`, 'USEMB', '39.00'),
      { ...mangoVariant(`${RUN}-TEE-Black-S`, 'VNEMB', '30.00'), sku: `${RUN}-EM-OTHER` },
    ], mProd, syncedAt);
    await globalRepo.projectAccount(M.id, 'MANGO' as never);

    // Tài khoản C: CHỈ bảng cũ (không chiếu) — dùng cho fallback.
    const cScope = { organizationId: orgA.id, accountId: C.id, provider: 'SELLERWIX' as const };
    const cCat = await catalogRepo.upsertCatalogues(cScope, [{ externalCatalogueId: `${RUN}-c`, name: `${RUN} C` }], syncedAt);
    const cProd = await catalogRepo.upsertProducts(cScope, [{
      externalProductId: `${RUN}-C-ONLY`, externalCatalogueId: `${RUN}-c`, name: `${RUN} C only`, sku: `${RUN}-C-ONLY`,
      image: null, basePrice: null, currency: 'USD', variationsCount: null, status: S.ACTIVE, rawData: {},
    }], cCat, syncedAt);
    await catalogRepo.upsertVariants(cScope, [{
      externalProductId: `${RUN}-C-ONLY`, externalVariantId: `${RUN}-C-ONLY-V`, sku: `${RUN}-C-ONLY-V`, name: 'One', color: null,
      size: null, price: '7.25', status: S.ACTIVE, rawData: { cost: 7.25 },
    }], cProd, syncedAt);

    // ------------------------------------------------ Test 1 — khử trùng sản phẩm
    const gTee = await prisma.providerCatalogProduct.findMany({ where: { provider: 'SELLERWIX', externalProductId: `${RUN}-TEE` } });
    const aTee = await prisma.fulfillmentAccountProduct.findMany({ where: { globalProductId: gTee[0]?.id } });
    check('T1. Hai tài khoản cùng sản phẩm ⇒ 1 sản phẩm global, 2 sản phẩm theo tài khoản',
      gTee.length === 1 && aTee.length === 2, `global ${gTee.length} · theo tài khoản ${aTee.length}`);

    // ------------------------------------------------ Test 2 — khử trùng biến thể
    const sku = `${RUN}-TEE-Black-S`;
    const gBS = await prisma.providerCatalogVariant.findMany({ where: { provider: 'SELLERWIX', externalVariantId: sku } });
    const aBS = await prisma.fulfillmentAccountVariant.findMany({ where: { globalVariantId: gBS[0]?.id }, orderBy: { price: 'asc' } });
    check('T2. Cùng biến thể ở 2 tài khoản ⇒ 1 biến thể global, 2 biến thể theo tài khoản',
      gBS.length === 1 && aBS.length === 2, `global ${gBS.length} · theo tài khoản ${aBS.length}`);
    const legacyA = await prisma.fulfillmentVariant.findFirst({ where: { accountId: A.id, sku } });
    const legacyB = await prisma.fulfillmentVariant.findFirst({ where: { accountId: B.id, sku } });
    check('T2b. id dòng theo tài khoản = id dòng cũ (tay cầm giao diện không đổi)',
      aBS.some((r) => r.id === legacyA?.id) && aBS.some((r) => r.id === legacyB?.id));

    // ------------------------------------------------ Test 3 — khác nhà cung cấp
    const sameId = await prisma.providerCatalogVariant.findMany({ where: { externalVariantId: sku } });
    check('T3. MANGO/X và SELLERWIX/X ⇒ 2 biến thể global (không gộp khác nhà cung cấp)',
      sameId.length === 2 && new Set(sameId.map((r) => r.provider)).size === 2, sameId.map((r) => r.provider).join(','));
    const mangoSameSku = await prisma.providerCatalogVariant.findMany({ where: { provider: 'MANGO', sku: `${RUN}-EM-NY-S` } });
    check('T3b. Mango: 2 variation CHUNG SKU, khác UUID ⇒ 2 biến thể global (danh tính = UUID, không phải SKU)',
      mangoSameSku.length === 2);

    // ------------------------------------------------ Test 4 — giá theo tài khoản
    readOn = true;
    const pA = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    const pB = await price.lookup(orgB.id, B.id, { externalVariantId: sku, sku });
    check('T4. getPrice(A, X) = 5.00 và getPrice(B, X) = 5.80 (cờ BẬT, đọc lớp theo tài khoản)',
      pA.ok && pA.price.price === 5 && pB.ok && pB.price.price === 5.8,
      `A=${pA.ok ? pA.price.price : pA.reason} · B=${pB.ok ? pB.price.price : pB.reason}`);
    const cross = await price.lookup(orgA.id, A.id, { id: legacyB!.id });
    check('T4b. Không bao giờ lấy giá của tài khoản khác (id biến thể của B tra trong A ⇒ không thấy)',
      !cross.ok && cross.reason === 'VARIANT_NOT_FOUND', cross.ok ? `trả ${cross.price.price}` : cross.reason);
    const crossOrg = await price.lookup(orgB.id, A.id, { externalVariantId: sku, sku });
    check('T4c. Tổ chức B không tra được giá trong tài khoản riêng của A', !crossOrg.ok);
    readOn = false;
    const pAlegacy = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    check('T4d. Cờ TẮT ⇒ bảng cũ, cùng kết quả (5.00, cùng id)', pAlegacy.ok && pAlegacy.price.price === 5 &&
      pA.ok && pAlegacy.price.variantId === pA.price.variantId);

    // ------------------------------------------------ Test 5 + 6 — Base Cost của ánh xạ & của đơn không đổi
    const mapping = await prisma.fulfillmentProductMapping.create({
      data: {
        organizationId: orgA.id, accountId: A.id, provider: 'SELLERWIX', tiktokProductId: `${RUN}-tt`, tiktokSkuId: `${RUN}-sku`,
        sellerSku: `${RUN}-seller`, providerSku: sku, providerVariantId: sku, providerProductId: `${RUN}-TEE`, baseCost: 5,
      } as never,
    });
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    // Fixture tối thiểu cho đơn đã gửi: tắt kiểm khoá ngoại TRONG transaction này (database thử nghiệm), để không
    // phải dựng cả chuỗi đơn TikTok. Thứ được kiểm là dòng hàng KHÔNG bị chạm, không phải luồng tạo đơn.
    await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
      prisma.$executeRaw`INSERT INTO fulfillment_orders (id, organization_id, pod_order_id, external_order_id, account_id, provider, updated_at)
                         VALUES (${orderId}::uuid, ${orgA.id}::uuid, ${crypto.randomUUID()}::uuid, ${`${RUN}-order`}, ${A.id}::uuid, 'SELLERWIX', now())`,
      prisma.$executeRaw`INSERT INTO fulfillment_order_items (id, organization_id, fulfillment_order_id, quantity, provider_sku, base_cost, updated_at)
                         VALUES (${itemId}::uuid, ${orgA.id}::uuid, ${orderId}::uuid, 1, ${sku}, 5.0000, now())`,
    ]);
    costByKey.set(`${RUN}-key-A`, 6.0);
    await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    readOn = true;
    const pA6 = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    const mappingAfter = await prisma.fulfillmentProductMapping.findUnique({ where: { id: mapping.id } });
    check('T5. Giá catalog A đổi 5 → 6: giá tra được = 6, nhưng mapping.base_cost VẪN 5 (chỉ đổi khi người dùng lưu lại ánh xạ)',
      pA6.ok && pA6.price.price === 6 && Number(mappingAfter?.baseCost) === 5,
      `catalog=${pA6.ok ? pA6.price.price : pA6.reason} · mapping=${mappingAfter?.baseCost}`);
    const itemAfter = await prisma.fulfillmentOrderItem.findUnique({ where: { id: itemId } });
    check('T6. Đơn đã gửi: order_item.base_cost VẪN 5 sau khi giá catalog đổi', Number(itemAfter?.baseCost) === 5,
      `${itemAfter?.baseCost}`);
    const pB58 = await price.lookup(orgB.id, B.id, { externalVariantId: sku, sku });
    check('T5b. Giá tài khoản B không bị đổi theo A (vẫn 5.80)', pB58.ok && pB58.price.price === 5.8);

    // ------------------------------------------------ Test 7 — ánh xạ tự động giữ phạm vi tài khoản
    const matchGlobal = await reader.loadMatchIndexRows(orgA.id, A.id);
    readOn = false;
    const matchLegacy = await reader.loadMatchIndexRows(orgA.id, A.id);
    readOn = true;
    const norm = (rows: typeof matchGlobal) => rows.map((r) => strip(r)).sort((x: any, y: any) => x.id.localeCompare(y.id));
    check('T7. Ánh xạ tự động: lớp mới trả ĐÚNG như bảng cũ (cùng id, SKU, giá, sản phẩm, danh mục)',
      matchGlobal.length === 4 && JSON.stringify(norm(matchGlobal)) === JSON.stringify(norm(matchLegacy)),
      `global ${matchGlobal.length} · legacy ${matchLegacy.length}`);
    const legacyIdsA = new Set((await prisma.fulfillmentVariant.findMany({ where: { accountId: A.id } })).map((r) => r.id));
    check('T7b. Mọi ứng viên thuộc tài khoản A (không lẫn B)', matchGlobal.every((r) => legacyIdsA.has(r.id)));
    const outcome = findAutoMapCandidates({ sellerSku: sku, productName: null, skuName: null, productCategory: null }, matchGlobal as never);
    check('T7c. Seller SKU khớp ⇒ đúng 1 ứng viên, là biến thể của A', outcome.candidates.length === 1 &&
      outcome.candidates[0].variantId === legacyA!.id);
    const otherOrg = await reader.loadMatchIndexRows(orgA.id, B.id);
    check('T7d. Phạm vi tổ chức giữ như bảng cũ (tổ chức A không rà danh mục tài khoản riêng của B)', otherOrg.length === 0);

    // ------------------------------------------------ Test 8 — vùng in / production line + parity màn hình
    const productA = (await prisma.fulfillmentProduct.findFirst({ where: { accountId: A.id } }))!;
    const productM = (await prisma.fulfillmentProduct.findFirst({ where: { accountId: M.id } }))!;
    const screen = async (on: boolean) => {
      readOn = on;
      return strip({
        catalogues: await query.listCatalogues(orgA.id, A.id),
        products: (await query.listProducts(orgA.id, A.id, { page: 1, limit: 50 })).items,
        search: (await query.listProducts(orgA.id, A.id, { search: 'unisex', page: 1, limit: 50 })).items,
        variantsA: await query.listVariations(orgA.id, productA.id),
        variantsM: await query.listVariations(orgA.id, productM.id),
      });
    };
    const before = await screen(false);
    const after = await screen(true);
    check('T8. Vùng in Sellerwix: cờ BẬT = cờ TẮT', JSON.stringify(after.variantsA) === JSON.stringify(before.variantsA) &&
      after.variantsA[0]?.printAreas?.length === 2, JSON.stringify(after.variantsA[0]?.printAreas));
    // Mango có variation CHUNG tên + SKU (khác production line): thứ tự TRONG nhóm hoà của bảng cũ không xác định
    // ⇒ so nội dung theo id, và so riêng thứ tự (tên, SKU).
    const byId = (rows: any[]) => JSON.stringify([...rows].sort((x, y) => x.id.localeCompare(y.id)));
    const nameSku = (rows: any[]) => rows.map((v) => `${v.name}|${v.sku}`).join(',');
    check('T8b. Production line Mango: cờ BẬT = cờ TẮT (cùng biến thể, cùng production line, cùng thứ tự tên/SKU)',
      byId(after.variantsM) === byId(before.variantsM) && nameSku(after.variantsM) === nameSku(before.variantsM) &&
      after.variantsM.some((v: any) => v.productionLine === 'USEMB') && after.variantsM.some((v: any) => v.productionLine === 'VNEMB'));
    check('T8c. Danh mục + danh sách sản phẩm + tìm kiếm: cờ BẬT = cờ TẮT (cùng id, tên, giá, số biến thể)',
      JSON.stringify({ ...after, variantsA: 0, variantsM: 0 }) === JSON.stringify({ ...before, variantsA: 0, variantsM: 0 }));

    // ------------------------------------------------ Test 9 — Sellerwix: luồng gửi đơn vẫn đọc bảng cũ
    const sendPath = await catalogRepo.findVariantsForAccount(A.id, [sku]);
    check('T9. Sellerwix — luồng gửi đơn (findVariantsForAccount) vẫn đọc bảng cũ, có print_areas',
      sendPath.length === 1 && Array.isArray((sendPath[0].rawData as any)?.print_areas));
    check('T9b. Sellerwix — đơn vị tiền giá vốn cho đơn (findCostCurrency) không đổi',
      (await catalogRepo.findCostCurrency(A.id, [sku])) === 'USD');

    // ------------------------------------------------ Test 10 — Mango: UUID + giá theo variation
    const m1 = await price.lookup(orgA.id, M.id, { externalVariantId: `${RUN}-variation-uuid-1`, sku: `${RUN}-EM-NY-S` });
    const m2 = await price.lookup(orgA.id, M.id, { externalVariantId: `${RUN}-variation-uuid-2`, sku: `${RUN}-EM-NY-S` });
    check('T10. Mango — giá theo variation UUID (cùng SKU, khác variation ⇒ 28.50 / 39.00)',
      m1.ok && m1.price.price === 28.5 && m2.ok && m2.price.price === 39, `${m1.ok && m1.price.price} / ${m2.ok && m2.price.price}`);
    const mSkuOnlyGlobal = await price.lookup(orgA.id, M.id, { sku: `${RUN}-EM-NY-S` });
    readOn = false;
    const mSkuOnlyLegacy = await price.lookup(orgA.id, M.id, { sku: `${RUN}-EM-NY-S` });
    readOn = true;
    check('T10b. Mango — chỉ có SKU (nhiều variation) ⇒ AMBIGUOUS, giống bảng cũ (không đoán)',
      !mSkuOnlyGlobal.ok && mSkuOnlyGlobal.reason === 'AMBIGUOUS' && !mSkuOnlyLegacy.ok && mSkuOnlyLegacy.reason === 'AMBIGUOUS');
    const gMangoProduct = await prisma.providerCatalogProduct.findFirst({ where: { provider: 'MANGO', externalProductId: `${RUN}-mango-product-uuid` } });
    check('T10c. Mango — product UUID giữ nguyên ở lớp global, không có giá trong payload global',
      Boolean(gMangoProduct) && !('base_price' in ((gMangoProduct?.rawData as object) ?? {})));
    const tier = await prisma.fulfillmentAccountVariant.findFirst({ where: { accountId: M.id }, select: { tier: true, price: true } });
    check('T10d. Mango — tier ở lớp theo tài khoản (GOLD), giá ở lớp theo tài khoản', tier?.tier === 'GOLD' && Boolean(tier?.price));

    // ------------------------------------------------ Test 11 — fallback
    const productC = (await prisma.fulfillmentProduct.findFirst({ where: { accountId: C.id } }))!;
    const cProducts = await query.listProducts(orgA.id, C.id, { page: 1, limit: 10 });
    const cPrice = await price.lookup(orgA.id, C.id, { externalVariantId: `${RUN}-C-ONLY-V`, sku: `${RUN}-C-ONLY-V` });
    const cVariants = await query.listVariations(orgA.id, productC.id);
    check('T11. Tài khoản CHƯA chiếu (cờ BẬT) ⇒ đọc bảng cũ: sản phẩm, biến thể, giá vẫn có',
      cProducts.items[0]?.id === productC.id && cVariants.length === 1 && cPrice.ok && cPrice.price.price === 7.25);
    // Lớp mới chậm hơn bảng cũ (vd dual write lỗi sau một lượt đồng bộ) ⇒ không đọc dữ liệu cũ hơn.
    await prisma.fulfillmentProduct.updateMany({ where: { accountId: A.id }, data: { syncedAt: new Date(Date.now() + 60_000) } });
    await prisma.fulfillmentVariant.updateMany({ where: { accountId: A.id, sku }, data: { price: '6.10' } });
    const stale = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    check('T11b. Lớp mới CHẬM hơn bảng cũ ⇒ đọc bảng cũ (6.10), không trả giá cũ của lớp mới (6)',
      stale.ok && stale.price.price === 6.1, stale.ok ? String(stale.price.price) : stale.reason);
    await globalRepo.projectAccount(A.id, 'SELLERWIX' as never);
    const caught = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    check('T11c. Chiếu lại ⇒ lớp mới theo kịp, đọc lớp mới (6.10)', caught.ok && caught.price.price === 6.1);

    // Design của tổ chức A — Global Catalog không được chạm (kiểm ở T17).
    const design = await prisma.fulfillmentProductDesign.create({
      data: {
        organizationId: orgA.id, tiktokProductId: `${RUN}-tt`, tiktokSkuId: `${RUN}-sku`, sellerSku: `${RUN}-seller`,
        placement: 'FRONT', sourceUrl: 'https://example.com/design.png',
      } as never,
    });
    const designBefore = JSON.stringify(design);

    // ------------------------------------------------ Test 12 — đồng bộ lặp lại
    const c1 = await counts();
    await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    await sync.syncAccount(orgB.id, B.id, 'MANUAL' as never);
    await globalRepo.projectAccount(M.id, 'MANGO' as never);
    const c2 = await counts();
    check('T12. Đồng bộ / chiếu lặp lại: KHÔNG sinh trùng sản phẩm, biến thể global, dòng theo tài khoản',
      JSON.stringify(c1) === JSON.stringify(c2), JSON.stringify(c2));

    // ------------------------------------------------ Test 13 — tài khoản dùng chung (is_global) qua lớp mới
    await prisma.fulfillmentAccount.update({ where: { id: SH.id }, data: { isGlobal: true } });
    await sync.syncAccount(orgA.id, SH.id, 'MANUAL' as never);
    const productSH = (await prisma.fulfillmentProduct.findFirst({ where: { accountId: SH.id } }))!;
    const sharedView = async (on: boolean) => {
      readOn = on;
      return strip({
        products: (await query.listProducts(orgB.id, SH.id, { page: 1, limit: 50 })).items,
        variants: await query.listVariations(orgB.id, productSH.id),
        price: await price.lookup(orgB.id, SH.id, { externalVariantId: sku, sku }),
      });
    };
    const sharedOff = await sharedView(false);
    const sharedOn = await sharedView(true);
    check('T13. Tài khoản DÙNG CHUNG: tổ chức B đọc sản phẩm + biến thể + giá (7.00) qua lớp mới = bảng cũ',
      JSON.stringify(sharedOn) === JSON.stringify(sharedOff) && sharedOn.price.ok && sharedOn.price.price.price === 7,
      sharedOn.price.ok ? String(sharedOn.price.price.price) : sharedOn.price.reason);
    check('T13b. Tài khoản dùng chung có GIÁ RIÊNG (7.00 ≠ A 6.10 ≠ B 5.80) — một biến thể global, ba giá',
      (await prisma.fulfillmentAccountVariant.count({ where: { globalVariantId: gBS[0].id } })) === 3);
    await prisma.fulfillmentAccount.update({ where: { id: SH.id }, data: { isGlobal: false } });
    const denied = async (on: boolean) => {
      readOn = on;
      const p = await price.lookup(orgB.id, SH.id, { externalVariantId: sku, sku });
      let variantsDenied = false;
      try { await query.listVariations(orgB.id, productSH.id); } catch { variantsDenied = true; }
      return !p.ok && variantsDenied;
    };
    check('T13c. Thôi dùng chung ⇒ tổ chức B KHÔNG đọc được giá / biến thể (cả cờ BẬT lẫn TẮT)', (await denied(true)) && (await denied(false)));
    readOn = true;

    // ------------------------------------------------ Test 14 — đồng bộ ĐỒNG THỜI hai tài khoản cùng nhà cung cấp
    costByKey.set(`${RUN}-key-A`, 6.5);
    costByKey.set(`${RUN}-key-B`, 5.9);
    const c3 = await counts();
    const [rA2, rB2] = await Promise.all([
      sync.syncAccount(orgA.id, A.id, 'MANUAL' as never),
      sync.syncAccount(orgB.id, B.id, 'MANUAL' as never),
    ]);
    const pA65 = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    const pB59 = await price.lookup(orgB.id, B.id, { externalVariantId: sku, sku });
    check('T14. Đồng bộ đồng thời A + B: cả hai PROJECTED, giá đúng từng tài khoản (6.50 / 5.90), không trùng bản ghi',
      rA2.globalCatalog?.status === 'PROJECTED' && rB2.globalCatalog?.status === 'PROJECTED' &&
      pA65.ok && pA65.price.price === 6.5 && pB59.ok && pB59.price.price === 5.9 &&
      JSON.stringify(await counts()) === JSON.stringify(c3));

    // ------------------------------------------------ Test 15 — đồng bộ đọc THIẾU (partial)
    failVariantsForKey.add(`${RUN}-key-A`);
    costByKey.set(`${RUN}-key-A`, 9.0);
    const rPartial = await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    failVariantsForKey.delete(`${RUN}-key-A`);
    const activeA = await prisma.fulfillmentAccountVariant.count({ where: { accountId: A.id, status: 'ACTIVE' } });
    const pPartial = await price.lookup(orgA.id, A.id, { externalVariantId: sku, sku });
    check('T15. Đồng bộ đọc thiếu: lượt PARTIAL, không archive; lớp mới giữ 4 biến thể ACTIVE và giá cũ 6.50 (không bịa 9.00)',
      rPartial.complete === false && activeA === 4 && pPartial.ok && pPartial.price.price === 6.5,
      `complete=${rPartial.complete} · active=${activeA} · price=${pPartial.ok ? pPartial.price.price : pPartial.reason}`);

    // ------------------------------------------------ Test 16 — số liệu màn hình cấu hình
    const statusOf = async (on: boolean) => {
      readOn = on;
      const s = await query.status(orgA.id, A.id);
      return JSON.stringify({ c: s.catalogues, p: s.products, v: s.variants, col: s.colors, siz: s.sizes, last: s.lastSyncedAt });
    };
    const statusOff = await statusOf(false);
    const statusOn = await statusOf(true);
    check('T16. Số liệu danh mục (countActive / lastSyncedAt): cờ BẬT = cờ TẮT', statusOn === statusOff, statusOn);
    readOn = true;

    // ------------------------------------------------ Test 17 — Design không bị chạm
    const designAfter = JSON.stringify(await prisma.fulfillmentProductDesign.findUnique({ where: { id: design.id } }));
    check('T17. Product Design của tổ chức không đổi sau mọi lượt đồng bộ / chiếu', designAfter === designBefore);

    // ------------------------------------------------ Test 18 — BASE COST INTEGRITY (tổng hợp)
    const avA = await prisma.fulfillmentAccountVariant.findFirst({ where: { accountId: A.id, globalVariantId: gBS[0].id } });
    const mapFinal = await prisma.fulfillmentProductMapping.findUnique({ where: { id: mapping.id } });
    const itemFinal = await prisma.fulfillmentOrderItem.findUnique({ where: { id: itemId } });
    check('T18. BASE COST INTEGRITY: giá catalog A 5 → 6 → 6.10 → 6.50 ⇒ account variant = 6.50, mapping.base_cost = 5, order_item.base_cost = 5',
      avA?.price === '6.5' && Number(mapFinal?.baseCost) === 5 && Number(itemFinal?.baseCost) === 5,
      `account=${avA?.price} · mapping=${mapFinal?.baseCost} · order=${itemFinal?.baseCost}`);
    check('T18b. Reader không fallback ngoài dự kiến trong suốt test (không có DIVERGENCE / ERROR)',
      reader.readStats().DIVERGENCE === 0 && reader.readStats().ERROR === 0, JSON.stringify(reader.readStats()));
  } finally {
    await prisma.$executeRaw`DELETE FROM fulfillment_order_items WHERE fulfillment_order_id IN
      (SELECT id FROM fulfillment_orders WHERE external_order_id = ${`${RUN}-order`})`;
    await prisma.$executeRaw`DELETE FROM fulfillment_orders WHERE external_order_id = ${`${RUN}-order`}`;
    await prisma.fulfillmentProductDesign.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.fulfillmentProductMapping.deleteMany({ where: { accountId: { in: [A.id, B.id, C.id, M.id, SH.id] } } });
    await prisma.fulfillmentSyncLog.deleteMany({ where: { accountId: { in: [A.id, B.id, C.id, M.id, SH.id] } } });
    // Lớp theo tài khoản + bảng cũ đi theo tài khoản (ON DELETE CASCADE); lớp global là dữ liệu dùng chung ⇒ dọn tay.
    await prisma.fulfillmentAccount.deleteMany({ where: { id: { in: [A.id, B.id, C.id, M.id, SH.id] } } });
    await prisma.providerCatalogVariant.deleteMany({ where: { externalVariantId: { startsWith: RUN } } });
    await prisma.providerCatalogProduct.deleteMany({ where: { externalProductId: { startsWith: RUN } } });
    await prisma.providerCatalogCatalogue.deleteMany({ where: { name: { startsWith: RUN } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    results.push('INFO  đã dọn dữ liệu test');
  }
}

main()
  .catch((error) => results.push(`FAIL  lỗi không mong đợi — ${(error as Error).stack ?? (error as Error).message}`))
  .finally(async () => {
    console.log(results.join('\n'));
    await prisma.$disconnect();
    process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
  });
