/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật + API Pressify THẬT, chỉ-đọc) cho danh mục Pressify + Global Catalog.
 *
 * Chạy (CHỈ trên database thử nghiệm — script tạo và tự dọn dữ liệu của nó):
 *   DATABASE_URL=postgresql://…/ncm_test node -r ts-node/register test/manual/e2e-pressify-catalog.manual.ts
 *
 * Đường đi THẬT: PressifyApiClient (GET https://pressify.us/api/all-product — endpoint CÔNG KHAI, không cần key,
 * chỉ đọc) → PressifyCatalogService → FulfillmentCatalogSyncService (bảng cũ + DUAL WRITE) →
 * FulfillmentGlobalCatalogRepository → PostgreSQL. KHÔNG gọi endpoint đơn hàng nào, không dùng key thật.
 *
 * Kiểm:
 *   P1  hai tài khoản Pressify đồng bộ SONG SONG ⇒ đều thành công + đều chiếu Global Catalog
 *   P2  mỗi variant_id Pressify = ĐÚNG MỘT biến thể global (không trùng)
 *   P3  mỗi tài khoản có đủ biến thể theo tài khoản (giá / trạng thái tách riêng)
 *   P4  giá theo BẬC của từng tài khoản (A = Platinum, B = Diamond) — khác nhau, đúng số API
 *   P5  lớp global KHÔNG chứa giá (không cột giá; raw_data đã bỏ product_prices / basecost / price)
 *   P6  biến thể KHÔNG có SKU vẫn có mặt (sku = '')
 *   P7  Mango có biến thể trùng CHUỖI id ("102") và trùng SKU với Pressify ⇒ hai bản ghi global riêng, không đè nhau
 *   P8  đồng bộ lại ⇒ idempotent (số bản ghi không đổi)
 *   P9  tra giá biến thể theo variant_id (đường lưu Product Mapping) ⇒ đúng giá của bậc tài khoản
 *   P10 đồng bộ danh mục KHÔNG chạm giá vốn đơn hàng (fulfillment_order_items)
 */
import { PrismaClient, FulfillmentCatalogItemStatus as S } from '@prisma/client';
import { MemoryLocks } from './support/fake-tiktok-promotion';
import { PressifyApiClient } from '../../src/modules/fulfillment/pressify/clients/pressify-api.client';
import { PressifyCatalogService } from '../../src/modules/fulfillment/pressify/services/pressify-catalog.service';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import {
  FulfillmentCatalogSyncService,
  GLOBAL_CATALOG_DUAL_WRITE_FLAG,
} from '../../src/modules/fulfillment/services/fulfillment-catalog-sync.service';
import {
  FulfillmentCatalogReader,
  GLOBAL_CATALOG_READ_FLAG,
} from '../../src/modules/fulfillment/services/fulfillment-catalog-reader.service';
import { FulfillmentVariantPriceService } from '../../src/modules/fulfillment/services/fulfillment-variant-price.service';

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const RUN = `PSFE2E${Date.now()}`;

async function main(): Promise<void> {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('Chỉ chạy trên database LOCAL (DATABASE_URL phải trỏ 127.0.0.1 / localhost).');
  }
  // Danh mục Pressify là dữ liệu CHUNG giữa mọi lượt chạy (khoá global = provider + variant_id) ⇒ cần database
  // chưa có dữ liệu PRESSIFY để đếm chính xác.
  const existing = await prisma.providerCatalogVariant.count({
    where: { provider: 'PRESSIFY' as never },
  });
  if (existing > 0)
    throw new Error(
      `Database đã có ${existing} biến thể global PRESSIFY — dùng database thử nghiệm sạch.`,
    );

  const orgA = await prisma.organization.create({
    data: { name: `${RUN} A`, slug: `${RUN.toLowerCase()}-a` } as never,
  });
  const orgB = await prisma.organization.create({
    data: { name: `${RUN} B`, slug: `${RUN.toLowerCase()}-b` } as never,
  });
  const mk = (
    organizationId: string,
    provider: 'PRESSIFY' | 'MANGO',
    name: string,
    providerConfig?: object,
  ) =>
    prisma.fulfillmentAccount.create({
      data: {
        organizationId,
        provider,
        name: `${RUN} ${name}`,
        apiKeyEnc: `${RUN}-not-a-real-key`,
        apiKeyHint: 'none',
        isActive: true,
        ...(providerConfig ? { providerConfig } : {}),
      } as never,
    });
  const A = await mk(orgA.id, 'PRESSIFY', 'Pressify A (Platinum)', { tierId: '13' });
  const B = await mk(orgB.id, 'PRESSIFY', 'Pressify B (Diamond)', { tierId: '14' });
  const M = await mk(orgA.id, 'MANGO', 'Mango');

  const config = {
    get: (k: string, fallback?: unknown) =>
      k === GLOBAL_CATALOG_READ_FLAG
        ? true
        : k === GLOBAL_CATALOG_DUAL_WRITE_FLAG
          ? true
          : fallback,
  } as never;
  const client = new PressifyApiClient({
    get: (_k: string, fallback?: unknown) => fallback,
  } as never);
  const repo = new FulfillmentRepository(prisma as never);
  const catalogRepo = new FulfillmentCatalogRepository(prisma as never);
  const globalRepo = new FulfillmentGlobalCatalogRepository(prisma as never);
  const reader = new FulfillmentCatalogReader(catalogRepo, globalRepo, config);
  const sync = new FulfillmentCatalogSyncService(
    prisma as never,
    repo,
    catalogRepo,
    {} as never,
    {} as never,
    new MemoryLocks() as never,
    globalRepo,
    config,
    new PressifyCatalogService(client),
  );
  const price = new FulfillmentVariantPriceService(reader);

  // Nguồn đối chiếu: đọc THẲNG API một lần (cùng endpoint công khai).
  const api = (await client.listAllProducts()).data;
  const apiVariants = (api.data ?? []).flatMap((p) =>
    (p.variants ?? []).map((v) => ({ ...v, product_id: p.id })),
  );
  const apiIds = new Set(apiVariants.map((v) => String(v.variant_id)));
  const sample = apiVariants.find((v) => v.variant_id === 102) ?? apiVariants[0];
  const tierOf = (v: typeof sample, tier: number) =>
    (v.product_prices ?? []).find(
      (pp) => Number(pp.tier_id) === tier && Number(pp.shipping_type ?? 0) === 0,
    )?.price ?? null;

  const orderItemsTouched = async (since: Date) =>
    prisma.fulfillmentOrderItem.count({ where: { updatedAt: { gte: since } } });
  const startedAt = new Date();

  try {
    // ------------------------------------------------ P1 — đồng bộ SONG SONG hai tài khoản
    const [rA, rB] = await Promise.all([
      sync.syncAccount(orgA.id, A.id, 'MANUAL' as never),
      sync.syncAccount(orgB.id, B.id, 'MANUAL' as never),
    ]);
    check(
      'P1. Hai tài khoản Pressify đồng bộ song song ⇒ đủ dữ liệu + đã chiếu Global Catalog',
      rA.complete &&
        rB.complete &&
        rA.globalCatalog?.status === 'PROJECTED' &&
        rB.globalCatalog?.status === 'PROJECTED',
      `A ${rA.products} sp/${rA.variants} bt (${rA.apiCalls} lời gọi) · B ${rB.products} sp/${rB.variants} bt · ${rA.globalCatalog?.status}/${rB.globalCatalog?.status}`,
    );

    // ------------------------------------------------ P2 — không trùng biến thể global
    const gCount = await prisma.providerCatalogVariant.count({
      where: { provider: 'PRESSIFY' as never },
    });
    const gDup = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT external_variant_id FROM provider_catalog_variants WHERE provider = 'PRESSIFY'
        GROUP BY external_variant_id HAVING COUNT(*) > 1) d`;
    check(
      'P2. Mỗi variant_id Pressify = đúng MỘT biến thể global',
      gCount === apiIds.size && Number(gDup[0].n) === 0,
      `global ${gCount} · API ${apiIds.size} · trùng ${gDup[0].n}`,
    );

    // ------------------------------------------------ P3 — lớp theo tài khoản
    const aCount = await prisma.fulfillmentAccountVariant.count({ where: { accountId: A.id } });
    const bCount = await prisma.fulfillmentAccountVariant.count({ where: { accountId: B.id } });
    check(
      'P3. Mỗi tài khoản có đủ biến thể theo tài khoản',
      aCount === apiIds.size && bCount === apiIds.size,
      `A ${aCount} · B ${bCount}`,
    );

    // ------------------------------------------------ P4 — giá theo bậc của từng tài khoản
    const g102 = await prisma.providerCatalogVariant.findFirst({
      where: { provider: 'PRESSIFY' as never, externalVariantId: String(sample.variant_id) },
    });
    const accountRows = await prisma.fulfillmentAccountVariant.findMany({
      where: { globalVariantId: g102?.id },
    });
    const priceA = accountRows.find((r) => r.accountId === A.id)?.price ?? null;
    const priceB = accountRows.find((r) => r.accountId === B.id)?.price ?? null;
    check(
      'P4. Giá biến thể theo BẬC của từng tài khoản (tách riêng, đúng số API)',
      priceA === tierOf(sample, 13) &&
        priceB === tierOf(sample, 14) &&
        accountRows.every((r) => r.currency === 'USD'),
      `variant ${sample.variant_id}: A(Platinum)=${priceA} · B(Diamond)=${priceB} · API ${tierOf(sample, 13)}/${tierOf(sample, 14)}`,
    );

    // ------------------------------------------------ P5 — lớp global không có giá
    const leaked = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM provider_catalog_variants
      WHERE provider = 'PRESSIFY'
        AND (raw_data ? 'product_prices' OR raw_data ? 'basecost' OR raw_data ? 'price' OR raw_data ? 'landed_cost')`;
    const leakedProducts = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM provider_catalog_products WHERE provider = 'PRESSIFY' AND raw_data ? 'accessories'`;
    const accountKeepsRaw = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM fulfillment_account_variants WHERE account_id = ${A.id}::uuid AND raw_data ? 'product_prices'`;
    check(
      'P5. Lớp global KHÔNG chứa giá (payload đã bỏ giá / phí bậc); lớp theo tài khoản giữ nguyên văn',
      Number(leaked[0].n) === 0 &&
        Number(leakedProducts[0].n) === 0 &&
        Number(accountKeepsRaw[0].n) === aCount,
      `global variant có giá: ${leaked[0].n} · global product có phí bậc: ${leakedProducts[0].n} · account raw đủ: ${accountKeepsRaw[0].n}`,
    );

    // ------------------------------------------------ P6 — biến thể không có SKU
    const noSkuApi = apiVariants.filter((v) => !v.sku).length;
    const noSkuGlobal = await prisma.providerCatalogVariant.count({
      where: { provider: 'PRESSIFY' as never, sku: '' },
    });
    check(
      'P6. Biến thể KHÔNG có SKU vẫn được đồng bộ (sku = chuỗi rỗng)',
      noSkuGlobal === noSkuApi && noSkuApi > 0,
      `API không SKU ${noSkuApi} · global sku='' ${noSkuGlobal}`,
    );

    // ------------------------------------------------ P7 — Mango trùng chuỗi id + trùng SKU
    const syncedAt = new Date();
    const mScope = { organizationId: orgA.id, accountId: M.id, provider: 'MANGO' as const };
    const mCat = await catalogRepo.upsertCatalogues(
      mScope,
      [{ externalCatalogueId: `${RUN}-cat`, name: `${RUN} cat` }],
      syncedAt,
    );
    const mProd = await catalogRepo.upsertProducts(
      mScope,
      [
        {
          externalProductId: `${RUN}-mango-p`,
          externalCatalogueId: `${RUN}-cat`,
          name: `${RUN} Mango Tee`,
          sku: null,
          image: null,
          basePrice: null,
          currency: 'USD',
          variationsCount: 1,
          status: S.ACTIVE,
          rawData: {},
        },
      ],
      mCat,
      syncedAt,
    );
    await catalogRepo.upsertVariants(
      mScope,
      [
        {
          externalProductId: `${RUN}-mango-p`,
          externalVariantId: String(sample.variant_id),
          sku: sample.sku ?? 'X',
          name: 'Mango clash',
          color: 'Pink',
          size: 'XXL',
          price: '99.00',
          status: S.ACTIVE,
          rawData: { price: '99.00' },
        },
      ],
      mProd,
      syncedAt,
    );
    await globalRepo.projectAccount(M.id, 'MANGO' as never);
    const sameId = await prisma.providerCatalogVariant.findMany({
      where: { externalVariantId: String(sample.variant_id) },
      orderBy: { provider: 'asc' },
    });
    const pressifyRow = sameId.find((r) => r.provider === ('PRESSIFY' as never));
    check(
      'P7. Mango trùng chuỗi id + trùng SKU ⇒ 2 bản ghi global tách theo nhà cung cấp, Pressify không bị đè',
      sameId.length === 2 &&
        pressifyRow?.color === (sample.color ?? null) &&
        pressifyRow?.size === (sample.size ?? null),
      sameId.map((r) => `${r.provider}:${r.color}/${r.size}`).join(' · '),
    );

    // ------------------------------------------------ P8 — idempotent
    const before = { g: gCount, a: aCount, b: bCount };
    await sync.syncAccount(orgA.id, A.id, 'MANUAL' as never);
    await sync.syncAccount(orgB.id, B.id, 'CRON' as never);
    const after = {
      g: await prisma.providerCatalogVariant.count({ where: { provider: 'PRESSIFY' as never } }),
      a: await prisma.fulfillmentAccountVariant.count({ where: { accountId: A.id } }),
      b: await prisma.fulfillmentAccountVariant.count({ where: { accountId: B.id } }),
    };
    check(
      'P8. Đồng bộ lại ⇒ không sinh bản ghi trùng',
      JSON.stringify(before) === JSON.stringify(after),
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    );

    // ------------------------------------------------ P9 — tra giá theo variant_id (đường lưu Product Mapping)
    const lookupA = await price.lookup(orgA.id, A.id, {
      externalVariantId: String(sample.variant_id),
      sku: sample.sku ?? '',
    });
    const lookupB = await price.lookup(orgB.id, B.id, {
      externalVariantId: String(sample.variant_id),
      sku: '',
    });
    check(
      'P9. Giá vốn dự kiến của ánh xạ = giá bậc của ĐÚNG tài khoản (tra theo variant_id)',
      lookupA.ok &&
        lookupB.ok &&
        lookupA.price.price === Number(tierOf(sample, 13)) &&
        lookupB.price.price === Number(tierOf(sample, 14)) &&
        lookupA.price.currency === 'USD',
      `A ${lookupA.ok ? `${lookupA.price.price} ${lookupA.price.currency}` : lookupA.reason} · ` +
        `B ${lookupB.ok ? `${lookupB.price.price} ${lookupB.price.currency}` : lookupB.reason}`,
    );

    // ------------------------------------------------ P10 — không chạm giá vốn đơn hàng
    check(
      'P10. Đồng bộ danh mục KHÔNG sửa dòng hàng fulfillment (giá vốn đơn giữ nguyên)',
      (await orderItemsTouched(startedAt)) === 0,
    );
  } finally {
    // Dọn: chỉ dữ liệu của lượt chạy này + danh mục PRESSIFY (database thử nghiệm sạch từ đầu).
    const accounts = [A.id, B.id, M.id];
    await prisma.fulfillmentAccountVariant.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.fulfillmentAccountProduct.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.fulfillmentAccountCatalogue.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.providerCatalogVariant.deleteMany({
      where: {
        OR: [
          { provider: 'PRESSIFY' as never },
          { externalVariantId: String(sample?.variant_id), provider: 'MANGO' as never },
        ],
      },
    });
    await prisma.providerCatalogProduct.deleteMany({
      where: { OR: [{ provider: 'PRESSIFY' as never }, { externalProductId: `${RUN}-mango-p` }] },
    });
    await prisma.providerCatalogCatalogue.deleteMany({
      where: { OR: [{ provider: 'PRESSIFY' as never }, { externalCatalogueId: `${RUN}-cat` }] },
    });
    await prisma.fulfillmentVariant.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.fulfillmentProduct.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.fulfillmentCatalogue.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.fulfillmentSyncLog
      .deleteMany({ where: { accountId: { in: accounts } } })
      .catch(() => undefined);
    await prisma.fulfillmentAccount.deleteMany({ where: { id: { in: accounts } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

main()
  .then(() => {
    console.log(results.join('\n'));
    const failed = results.filter((line) => line.startsWith('FAIL')).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  })
  .catch((error) => {
    console.log(results.join('\n'));
    console.error('E2E lỗi:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
