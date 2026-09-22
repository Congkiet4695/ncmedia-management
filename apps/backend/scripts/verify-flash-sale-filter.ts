/**
 * Kiểm chứng bộ lọc "sản phẩm đang chạy Flash Sale" trên DATABASE THẬT (local).
 *
 * Tạo dữ liệu tạm (một shop giả + sản phẩm + các đợt Flash Sale ở đúng các vị trí thời gian
 * của CASE 1–8), chạy `PodProductRepository.findMany` với `flashSale = RUNNING / NOT_RUNNING`,
 * kiểm phân trang (CASE 9), rồi XOÁ đúng dữ liệu tạm. Không đụng dữ liệu thật.
 *
 * Chạy: `node -r ts-node/register scripts/verify-flash-sale-filter.ts`
 */
import 'dotenv/config';
import { PodFlashSaleStatus, PrismaClient } from '@prisma/client';
import { PodProductRepository } from '../src/modules/pod-product/repositories/pod-product.repository';
import type { PrismaService } from '../src/database/prisma.service';

const TAG = '[verify-flash-sale-filter]';
const FROM = new Date('2026-09-22T15:00:00Z');
const TO = new Date('2026-09-23T15:00:00Z');

async function main() {
  const prisma = new PrismaClient();
  const repo = new PodProductRepository(prisma as unknown as PrismaService);

  const org = await prisma.organization.findFirst({ select: { id: true } });
  const account = await prisma.podTiktokAccount.findFirst({ where: { organizationId: org?.id }, select: { id: true } });
  if (!org || !account) throw new Error('Cần một tổ chức có TikTok Account trong DB.');

  // Hai shop tạm: A (đang kiểm) và B (shop khác — CASE 8).
  const mkShop = (suffix: string) =>
    prisma.podTiktokShop.create({
      data: { organizationId: org.id, accountId: account.id, tiktokShopId: `${TAG}-${suffix}-${Date.now()}`, name: `${TAG} shop ${suffix}`, region: 'US', shopCipherEnc: 'verify', sellerType: 'LOCAL' },
      select: { id: true },
    });
  const shopA = await mkShop('A');
  const shopB = await mkShop('B');

  const cases: Array<{ key: string; sale?: { start: string; end: string; status?: PodFlashSaleStatus }; shop?: 'B'; expectRunning: boolean }> = [
    { key: 'C1 không có sale', expectRunning: false },
    { key: 'C2 sale nằm trọn', sale: { start: '2026-09-22T18:00:00Z', end: '2026-09-23T10:00:00Z' }, expectRunning: true },
    { key: 'C3 bắt đầu trước, kết thúc trong', sale: { start: '2026-09-20T10:00:00Z', end: '2026-09-22T20:00:00Z' }, expectRunning: true },
    { key: 'C4 bắt đầu trong, kết thúc sau', sale: { start: '2026-09-23T10:00:00Z', end: '2026-09-25T00:00:00Z' }, expectRunning: true },
    { key: 'C5 bao phủ', sale: { start: '2026-09-20T00:00:00Z', end: '2026-09-30T00:00:00Z' }, expectRunning: true },
    { key: 'C6 kết thúc trước (14:00)', sale: { start: '2026-09-20T10:00:00Z', end: '2026-09-22T14:00:00Z' }, expectRunning: false },
    { key: 'C6b kết thúc ĐÚNG mốc from', sale: { start: '2026-09-20T10:00:00Z', end: '2026-09-22T15:00:00Z' }, expectRunning: false },
    { key: 'C7 bắt đầu sau', sale: { start: '2026-09-24T00:00:00Z', end: '2026-09-25T00:00:00Z' }, expectRunning: false },
    { key: 'C7b bắt đầu ĐÚNG mốc to', sale: { start: '2026-09-23T15:00:00Z', end: '2026-09-25T00:00:00Z' }, expectRunning: false },
    { key: 'C8 sale giao nhưng ở SHOP KHÁC', sale: { start: '2026-09-22T18:00:00Z', end: '2026-09-23T10:00:00Z' }, shop: 'B', expectRunning: false },
    { key: 'Sale DRAFT giao thời gian', sale: { start: '2026-09-22T18:00:00Z', end: '2026-09-23T10:00:00Z', status: PodFlashSaleStatus.DRAFT }, expectRunning: false },
  ];

  const productIds: string[] = [];
  const saleIds: string[] = [];
  try {
    for (const c of cases) {
      const shopId = c.shop === 'B' ? shopB.id : shopA.id;
      const product = await prisma.podProduct.create({
        data: {
          organizationId: org.id,
          accountId: account.id,
          shopId,
          tiktokProductId: `${TAG}-${c.key}-${Date.now()}`.slice(0, 64),
          title: `${TAG} ${c.key}`,
          status: 'ACTIVATE',
          payloadHash: '0'.repeat(64),
          variants: { create: { organizationId: org.id, tiktokSkuId: `${TAG}-sku-${Date.now()}-${Math.random()}`.slice(0, 64), sellerSku: 'VF-1', salePrice: '10', currency: 'USD' } },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      productIds.push(product.id);
      if (c.sale) {
        const sale = await prisma.podFlashSale.create({
          data: {
            organizationId: org.id,
            accountId: account.id,
            shopId,
            name: `${TAG} ${c.key}`,
            status: c.sale.status ?? PodFlashSaleStatus.RUNNING,
            startAt: new Date(c.sale.start),
            endAt: new Date(c.sale.end),
            timezone: 'UTC',
            items: {
              create: {
                organizationId: org.id,
                productId: product.id,
                variantId: product.variants[0]?.id,
                originalPrice: '10',
                flashSalePrice: '8',
                discountPercent: '20',
              },
            },
          },
          select: { id: true },
        });
        saleIds.push(sale.id);
      }
    }

    // Sản phẩm shop B (CASE 8) không được lọt vào bất kỳ kết quả nào của shop A.
    const base = { shopId: shopA.id, page: 1, limit: 100, sortBy: 'createdAt' as const, sortOrder: 'asc' as const, search: TAG };
    const running = await repo.findMany(org.id, { ...base, flashSale: { mode: 'RUNNING', from: FROM, to: TO } });
    const notRunning = await repo.findMany(org.id, { ...base, flashSale: { mode: 'NOT_RUNNING', from: FROM, to: TO } });
    const all = await repo.findMany(org.id, { ...base });

    let failed = 0;
    const check = (name: string, ok: boolean, detail = '') => {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`);
      if (!ok) failed += 1;
    };
    const titlesOf = (rows: { items: Array<{ title: string | null }> }) => rows.items.map((row) => row.title ?? '');
    for (const c of cases) {
      const inRunning = titlesOf(running).some((title) => title.endsWith(c.key));
      const inNotRunning = titlesOf(notRunning).some((title) => title.endsWith(c.key));
      if (c.shop === 'B') {
        check(`${c.key} ⇒ không xuất hiện ở shop A`, !inRunning && !inNotRunning);
        continue;
      }
      check(`${c.key} ⇒ ${c.expectRunning ? 'ĐANG CHẠY' : 'CHƯA CHẠY'}`, inRunning === c.expectRunning && inNotRunning === !c.expectRunning);
    }
    const shopACount = cases.filter((c) => c.shop !== 'B').length;
    check('ALL = RUNNING ∪ NOT_RUNNING, không thiếu không trùng', all.total === shopACount && running.total + notRunning.total === shopACount, `all=${all.total} running=${running.total} notRunning=${notRunning.total}`);

    // CASE 9: phân trang trên kết quả đã lọc — total đúng, trang 1 + trang 2 ghép lại đủ, không trùng.
    const p1 = await repo.findMany(org.id, { ...base, limit: 2, page: 1, flashSale: { mode: 'NOT_RUNNING', from: FROM, to: TO } });
    const p2 = await repo.findMany(org.id, { ...base, limit: 2, page: 2, flashSale: { mode: 'NOT_RUNNING', from: FROM, to: TO } });
    const p3 = await repo.findMany(org.id, { ...base, limit: 2, page: 3, flashSale: { mode: 'NOT_RUNNING', from: FROM, to: TO } });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((row) => row.id);
    check('CASE 9: phân trang NOT_RUNNING (limit 2) — total đúng, các trang không trùng', p1.total === notRunning.total && new Set(ids).size === ids.length && ids.length === Math.min(6, notRunning.total), `total=${p1.total} pages=${p1.items.length}/${p2.items.length}/${p3.items.length}`);

    console.log(`\n${cases.length + 2 - failed}/${cases.length + 2} PASS`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.podFlashSale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.podProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.podTiktokShop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
