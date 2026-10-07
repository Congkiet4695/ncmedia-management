/**
 * Kiểm chứng trên DATABASE THẬT (local) màn "Thống kê công việc nhân viên" — service + SQL THẬT:
 *
 *   P. Lợi nhuận: SQL `orderProfitCtes` == `calculateOrderFinancials` (PodOrderFinanceService, màn Order)
 *      cho TỪNG đơn của tổ chức (kể cả đơn chưa có giá vốn ⇒ cả hai đều NULL).
 *   L. Listing: dữ liệu tạm — chỉ người CHẠY lượt listing được tính; mỗi (shop, sản phẩm TikTok) tính ở lần
 *      thành công đầu tiên (chạy lại / người khác list lại / "đã publish trước đó" không đếm thêm); FAILED,
 *      CREATE_DRAFT, ngoài ngày không tính.
 *   A. Phụ trách: người được gán TikTok Account thấy shop đó (listing 0 nếu họ không chạy) với đơn của shop.
 *   O. Đơn trong ngày (giờ vận hành) == truy vấn độc lập; tổng đơn tóm tắt cộng MỖI shop MỘT lần.
 *   I. Tổ chức khác không thấy dữ liệu của tổ chức này.
 *
 * Mọi dữ liệu tạm được dọn; seller của account được khôi phục.
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/e2e-employee-work.manual.ts
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PodListingJobItemStatus, PodListingJobType, PodListingMarket, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PodEmployeeWorkService } from '../../src/modules/pod-tiktok/services/pod-employee-work.service';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { orderProfitCtes } from '../../src/modules/pod-tiktok/shared/order-profit.sql';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => void job.stop());
  const prisma = app.get(PrismaService);
  const offsetMinutes = app.get(ConfigService).get<number>('timezoneOffsetMinutes', 420);
  const results: Array<[string, boolean, string]> = [];
  const check = (label: string, ok: boolean, detail: unknown) => results.push([label, ok, JSON.stringify(detail)]);
  const cleanup: Array<() => Promise<unknown>> = [];

  try {
    const shop1 = await prisma.podTiktokShop.findFirstOrThrow({
      where: { deletedAt: null, orders: { some: {} } },
      include: { account: true },
    });
    const org = shop1.organizationId;

    // ------------------------------------------------------------- P. Lợi nhuận từng đơn
    const all = await prisma.podOrder.findMany({ where: { organizationId: org, deletedAt: null }, select: { id: true, tiktokOrderId: true } });
    const ts = await app.get(PodOrderFinanceService).summarize(org, all);
    const sqlRows = await prisma.$queryRaw<Array<{ id: string; profit: Prisma.Decimal | null }>>(Prisma.sql`
      WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po WHERE po.organization_id = ${org}::uuid AND po.deleted_at IS NULL),
      ${orderProfitCtes(org, app.get(PodOrderFinanceService).labelCost())}
      SELECT id, profit FROM order_profit`);
    const mismatches = sqlRows.filter((row) => {
      const expected = ts.get(row.id)?.profit ?? null;
      const actual = row.profit === null ? null : Number(row.profit);
      return expected === null ? actual !== null : actual === null || Math.abs(actual - expected) > 0.0001;
    });
    const withProfit = sqlRows.filter((row) => row.profit !== null).length;
    check('P1 lợi nhuận SQL == màn Order (calculateOrderFinancials) cho MỌI đơn', mismatches.length === 0 && sqlRows.length === all.length, {
      orders: all.length,
      withProfit,
      withoutProfit: all.length - withProfit,
      mismatches: mismatches.length,
    });

    // ------------------------------------------------------------- Dữ liệu tạm
    const day = (await prisma.$queryRaw<Array<{ d: string }>>`
      SELECT to_char(ordered_at + make_interval(mins => ${offsetMinutes}::int), 'YYYY-MM-DD') AS d
        FROM pod_orders WHERE shop_id = ${shop1.id}::uuid AND deleted_at IS NULL
       GROUP BY 1 ORDER BY COUNT(*) DESC, 1 DESC LIMIT 1`)[0].d;
    const at = (hour: number, dayShift = 0) =>
      new Date(Date.parse(`${day}T00:00:00.000Z`) + dayShift * 86_400_000 + hour * 3_600_000 - offsetMinutes * 60_000);

    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org, code: 'EMPLOYEE', deletedAt: null } });
    const makeUser = async (label: string) => {
      const user = await prisma.user.create({
        data: { organizationId: org, roleId: role.id, email: `e2e-${label}-${Date.now()}@example.test`, passwordHash: 'x', fullName: `E2E ${label}` },
      });
      const employee = await prisma.employee.create({ data: { organizationId: org, userId: user.id } as never });
      cleanup.push(() => prisma.employee.delete({ where: { id: employee.id } }));
      cleanup.push(() => prisma.user.delete({ where: { id: user.id } }));
      return { user, employee };
    };
    const A = await makeUser('A');
    const B = await makeUser('B');
    const C = await makeUser('C'); // không làm gì ⇒ 0 listing

    // Shop thứ hai (tạm) của tổ chức, account riêng.
    const stamp = Date.now();
    const account2 = await prisma.podTiktokAccount.create({
      data: {
        organizationId: org,
        accountName: 'E2E Account 2',
        openId: `e2e-open-${stamp}`,
        userType: 0,
        accessTokenEnc: 'e2e',
        accessTokenExpiresAt: new Date(),
        refreshTokenEnc: 'e2e',
        refreshTokenExpiresAt: new Date(),
      },
    });
    const shop2 = await prisma.podTiktokShop.create({
      data: {
        organizationId: org,
        accountId: account2.id,
        tiktokShopId: `e2e-shop-${stamp}`,
        shopCipherEnc: 'e2e',
        name: 'E2E Shop 2',
        region: shop1.region,
        sellerType: shop1.sellerType,
      },
    });
    cleanup.unshift(() => prisma.podTiktokAccount.delete({ where: { id: account2.id } }));
    cleanup.unshift(() => prisma.podTiktokShop.delete({ where: { id: shop2.id } }));

    // A PHỤ TRÁCH shop1 (khôi phục cuối).
    const originalSeller = shop1.account.sellerId;
    await prisma.podTiktokAccount.update({ where: { id: shop1.accountId }, data: { sellerId: A.employee.id } });
    cleanup.unshift(() => prisma.podTiktokAccount.update({ where: { id: shop1.accountId }, data: { sellerId: originalSeller } }));

    // Nguồn của item (CHECK one_source): mỗi item một sản phẩm thật khác nhau trong lượt.
    const products = await prisma.podProduct.findMany({ where: { organizationId: org, deletedAt: null }, select: { id: true }, take: 10 });
    const job = async (createdBy: string, type: PodListingJobType, items: Array<{ shopId: string; remote: string | null; status: PodListingJobItemStatus; finishedAt: Date }>) => {
      const created = await prisma.podListingJob.create({
        data: {
          organizationId: org,
          name: `E2E ${type}`,
          market: PodListingMarket.US,
          type,
          createdBy,
          items: {
            create: items.map((item, index) => ({
              organizationId: org,
              productId: products[index].id,
              shopId: item.shopId,
              status: item.status,
              remoteProductId: item.remote,
              finishedAt: item.finishedAt,
            })),
          },
        },
      });
      cleanup.unshift(() => prisma.podListingJob.delete({ where: { id: created.id } }));
    };
    const ok = PodListingJobItemStatus.SUCCESS;
    const tag = `E2E${Date.now()}`;
    // B: 2 sản phẩm lên shop1 trong ngày + 1 lỗi.
    await job(B.user.id, PodListingJobType.PUBLISH, [
      { shopId: shop1.id, remote: `${tag}-1`, status: ok, finishedAt: at(10) },
      { shopId: shop1.id, remote: `${tag}-2`, status: ok, finishedAt: at(10.5) },
      { shopId: shop1.id, remote: null, status: PodListingJobItemStatus.FAILED, finishedAt: at(10.6) },
    ]);
    // B chạy LẠI cùng sản phẩm 1 (retry / "đã publish trước đó") ⇒ không đếm thêm.
    await job(B.user.id, PodListingJobType.PUBLISH, [{ shopId: shop1.id, remote: `${tag}-1`, status: ok, finishedAt: at(11) }]);
    // A list lại sản phẩm 1 trên shop1 (đã do B list trước) ⇒ không tính cho A; A list 1 sản phẩm lên shop2.
    await job(A.user.id, PodListingJobType.CLONE, [
      { shopId: shop1.id, remote: `${tag}-1`, status: ok, finishedAt: at(12) },
      { shopId: shop2.id, remote: `${tag}-3`, status: ok, finishedAt: at(12) },
    ]);
    // Không tính: CREATE_DRAFT (chưa lên sàn), ngoài ngày (hôm trước).
    await job(B.user.id, PodListingJobType.CREATE_DRAFT, [{ shopId: shop1.id, remote: `${tag}-4`, status: ok, finishedAt: at(9) }]);
    await job(B.user.id, PodListingJobType.LIVE_LISTING, [{ shopId: shop1.id, remote: `${tag}-5`, status: ok, finishedAt: at(23.9, -1) }]);

    // ------------------------------------------------------------- P2. Nhánh CÓ lợi nhuận + nhánh biên
    // Đơn shop1 trong ngày (đều có giao dịch TikTok) ⇒ gắn fulfillment tạm với các tình huống giá vốn khác nhau.
    const fAccount = await prisma.fulfillmentAccount.findFirstOrThrow({ where: { organizationId: org, deletedAt: null } });
    const dayOrdersP2 = await prisma.podOrder.findMany({
      where: { shopId: shop1.id, deletedAt: null, orderedAt: { gte: at(0), lte: new Date(at(24).getTime() - 1) } },
      select: { id: true, tiktokOrderId: true, currency: true },
      orderBy: { orderedAt: 'asc' },
    });
    const scenarios: Array<{ status: 'SHIPPED' | 'SUBMITTED' | 'CANCELLED'; currency: string | null; items: Array<{ cost: number; confirmed: boolean }>; ageMs?: number }> = [
      { status: 'SHIPPED', currency: 'USD', items: [{ cost: 9.12, confirmed: true }] }, // OK
      { status: 'SUBMITTED', currency: null, items: [{ cost: 5, confirmed: true }] }, // COST_CURRENCY_UNKNOWN
      { status: 'CANCELLED', currency: 'USD', items: [{ cost: 4, confirmed: true }] }, // huỷ ⇒ không có giá vốn
      { status: 'SHIPPED', currency: 'USD', items: [{ cost: 3, confirmed: true }, { cost: 2, confirmed: false }] }, // COST_PENDING
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const target = dayOrdersP2[index];
      if (!target) break;
      const record = await prisma.fulfillmentOrder.create({
        data: {
          organizationId: org,
          accountId: fAccount.id,
          provider: fAccount.provider,
          podOrderId: target.id,
          externalOrderId: `E2E-EW-${index}-${Date.now()}`,
          status: scenario.status,
          submittedAt: new Date(),
          currency: scenario.currency,
          items: {
            create: scenario.items.map((item) => ({
              organizationId: org,
              providerSku: 'E2E-SKU',
              quantity: 1,
              baseCost: new Prisma.Decimal(item.cost),
              baseCostConfirmedAt: item.confirmed ? new Date() : null,
            })),
          },
        },
      });
      cleanup.unshift(async () => {
        await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: record.id } });
        await prisma.fulfillmentOrder.delete({ where: { id: record.id } });
      });
    }
    const p2Orders = dayOrdersP2.slice(0, scenarios.length);
    const tsP2 = await app.get(PodOrderFinanceService).summarize(org, p2Orders);
    const sqlP2 = await prisma.$queryRaw<Array<{ id: string; profit: Prisma.Decimal | null }>>(Prisma.sql`
      WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po WHERE po.id IN (${Prisma.join(p2Orders.map((o) => Prisma.sql`${o.id}::uuid`))})),
      ${orderProfitCtes(org, app.get(PodOrderFinanceService).labelCost())}
      SELECT id, profit FROM order_profit`);
    const p2 = p2Orders.map((order, index) => ({
      scenario: index,
      ts: tsP2.get(order.id)?.profit ?? null,
      tsStatus: tsP2.get(order.id)?.status,
      sql: sqlP2.find((row) => row.id === order.id)?.profit?.toNumber() ?? null,
    }));
    check('P2 nhánh OK / thiếu đơn vị tiền / fulfill huỷ / chờ báo giá: SQL == màn Order từng đơn, ≥ 1 đơn CÓ lợi nhuận', p2.every((row) => (row.ts === null ? row.sql === null : row.sql !== null && Math.abs(row.sql - row.ts) < 0.0001)) && p2.some((row) => row.ts !== null), p2);

    const service = app.get(PodEmployeeWorkService);
    const result = await service.page(org, { from: day, to: day, limit: 100 });
    const find = (userId: string) => result.items.find((item) => item.userId === userId);
    const rowA = find(A.user.id);
    const rowB = find(B.user.id);
    const rowC = find(C.user.id);

    // Đơn shop1 trong ngày (độc lập), cùng đơn vị tiền mà màn hình chọn.
    const [{ n: shop1Orders }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pod_orders
       WHERE shop_id = ${shop1.id}::uuid AND deleted_at IS NULL AND currency = ${result.currency}
         AND ordered_at BETWEEN ${at(0)} AND ${new Date(at(24).getTime() - 1)}`;
    const dayOrders = await prisma.podOrder.findMany({
      where: { shopId: shop1.id, deletedAt: null, currency: result.currency ?? undefined, orderedAt: { gte: at(0), lte: new Date(at(24).getTime() - 1) } },
      select: { id: true, tiktokOrderId: true },
    });
    const tsDay = await app.get(PodOrderFinanceService).summarize(org, dayOrders);
    const tsProfits = [...tsDay.values()].map((f) => f.profit).filter((p): p is number => p !== null);
    const expectedProfit = tsProfits.length ? Math.round(tsProfits.reduce((s, p) => s + p, 0) * 100) / 100 : null;

    const b1 = rowB?.accountDetails.find((d) => d.shopId === shop1.id);
    check('L1 B (người chạy) = 2 listing trên shop1: chạy lại / người khác list lại / FAILED / draft / hôm trước KHÔNG tính', rowB?.listings === 2 && b1?.listings === 2, { listings: rowB?.listings });
    const a1 = rowA?.accountDetails.find((d) => d.shopId === shop1.id);
    const a2 = rowA?.accountDetails.find((d) => d.shopId === shop2.id);
    check('L2 A list lại sản phẩm B đã list ⇒ 0 trên shop1; 1 trên shop2 (của chính A)', a1?.listings === 0 && a2?.listings === 1 && rowA?.listings === 1, {
      shop1: a1?.listings,
      shop2: a2?.listings,
    });
    check('A1 A PHỤ TRÁCH shop1 ⇒ shop1 hiện dưới A (assigned), B không phụ trách', a1?.assigned === true && b1?.assigned === false && rowA?.accounts === 2, {
      aAccounts: rowA?.accounts,
      a1Assigned: a1?.assigned,
      b1Assigned: b1?.assigned,
    });
    check('A2 nhân viên không làm gì ⇒ vẫn hiện, 0 listing / 0 shop', rowC?.listings === 0 && rowC?.accounts === 0, { listings: rowC?.listings, accounts: rowC?.accounts });
    check('O1 đơn shop1 trong ngày (giờ vận hành) == truy vấn độc lập', b1?.orders === Number(shop1Orders) && a1?.orders === Number(shop1Orders), {
      shown: b1?.orders,
      expected: Number(shop1Orders),
      day,
    });
    check('O2 lợi nhuận shop1 trong ngày == Σ lợi nhuận màn Order (đơn thiếu dữ kiện không cộng, không coi là 0)', (b1?.profit ?? null) === expectedProfit, {
      shown: b1?.profit,
      expected: expectedProfit,
      profitOrders: b1?.profitOrders,
    });
    const employeeSum = (rowB?.accountDetails ?? []).reduce((s, d) => s + d.listings, 0);
    check('O3 tổng của nhân viên = tổng chi tiết shop', employeeSum === rowB?.listings, { employeeSum, row: rowB?.listings });
    check('O4 tóm tắt: listing = 3, shop có listing = 2, người có listing ≥ 2; đơn tính MỖI shop MỘT lần', result.summary.productsListed === 3 && result.summary.accountsListed === 2 && result.summary.orders === Number(shop1Orders), result.summary);

    const onlyB = await service.page(org, { from: day, to: day, userId: B.user.id });
    check('F1 lọc theo người ⇒ chỉ người đó, tóm tắt theo người đó', onlyB.items.length === 1 && onlyB.summary.productsListed === 2, { items: onlyB.items.length, summary: onlyB.summary });

    // ------------------------------------------------------------- I. Cô lập tổ chức
    const otherOrg = await prisma.organization.findFirstOrThrow({ where: { id: { not: org } }, select: { id: true } });
    const other = await service.page(otherOrg.id, { from: day, to: day, limit: 100 });
    const leaked = other.items.some((item) => [A.user.id, B.user.id].includes(item.userId)) || other.summary.productsListed > 0;
    check('I1 tổ chức khác KHÔNG thấy listing / người / shop của tổ chức này', !leaked, { items: other.items.length, summary: other.summary });
  } finally {
    for (const step of cleanup) await step().catch((error: Error) => console.error('cleanup:', error.message));
    await app.close();
  }

  for (const [label, ok, detail] of results) console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  console.log('Đã dọn dữ liệu tạm.');
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
