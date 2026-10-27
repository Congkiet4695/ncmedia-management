/* eslint-disable */
/**
 * Đối chiếu CHỈ-ĐỌC (database thật) cho hai cột mới của bảng Thống kê seller:
 *   Shipping Fee   = Σ phí ship Seller TỪNG ĐƠN
 *   Current Profit = Paid − Basecost − Label − Shipping Fee
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/verify-dashboard-seller-shipping.manual.ts
 *
 * 🔴 KHÔNG ghi gì: mọi truy vấn nằm trong MỘT transaction `READ ONLY` (PostgreSQL từ chối mọi lệnh ghi),
 * và không dựng AppModule (không khởi động cron). An toàn để chạy cả trên DB dùng chung.
 *
 * Kiểm:
 *   1. `order_profit` đúng MỘT dòng mỗi đơn — kể cả đơn có nhiều dòng item fulfill (không nhân phí ship).
 *   2. Shipping Fee / số đơn của SQL (Dashboard) == Σ `sellerShipping.amount` của bản TS (màn Order) theo seller.
 *   3. Profit Dự kiến (2026-10-14) = Revenue − Basecost − Label − (Shipping Fee − phần đã nằm trong Revenue): phần
 *      "đã nằm trong" của SQL == Σ `sellerShipping.amount` có `includedInProceeds` của bản TS; giá trị hiển thị
 *      (`sellerEstProfit`) == công thức tính tay == biểu thức ORDER BY của SQL; sort=profit đúng thứ tự.
 *   4. Current Profit của service == Paid − Basecost − Label − Shipping Fee trên cùng dòng.
 *   5. Lặp lại cho nhiều khoảng ngày và bộ lọc shop.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { sellerCurrentProfit, sellerEstProfit } from '../../src/modules/pod-tiktok/shared/dashboard-metrics';
import { orderProfitCtes } from '../../src/modules/pod-tiktok/shared/order-profit.sql';

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const DAY = 86_400_000;

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const config = { get: (_key: string, fallback: unknown) => fallback } as never;
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const db = tx as unknown as PrismaService;
        const repo = new PodDashboardRepository(db);
        const finance = new PodOrderFinanceService(db, config);
        const label = finance.labelCost();

        const [busiest] = await db.$queryRaw<Array<{ organization_id: string; currency: string; max_at: Date }>>(Prisma.sql`
          SELECT organization_id, currency, MAX(ordered_at) AS max_at FROM pod_orders
           WHERE deleted_at IS NULL AND ordered_at IS NOT NULL
           GROUP BY organization_id, currency ORDER BY COUNT(*) DESC LIMIT 1`);
        if (!busiest) throw new Error('Không có đơn nào để đối chiếu');
        const org = busiest.organization_id;
        const currency = busiest.currency;
        const end = new Date(busiest.max_at);

        const shops = await db.$queryRaw<Array<{ shop_id: string }>>(Prisma.sql`
          SELECT shop_id FROM pod_orders WHERE organization_id = ${org}::uuid AND deleted_at IS NULL AND currency = ${currency}
           GROUP BY shop_id ORDER BY COUNT(*) DESC LIMIT 1`);
        const scenarios = [
          { name: '7 ngày', from: new Date(end.getTime() - 7 * DAY), shopId: undefined as string | undefined },
          { name: '60 ngày', from: new Date(end.getTime() - 60 * DAY), shopId: undefined },
          { name: '60 ngày · 1 shop', from: new Date(end.getTime() - 60 * DAY), shopId: shops[0]?.shop_id },
        ];

        for (const scenario of scenarios) {
          const window = { from: scenario.from, before: end };
          const filter = { organizationId: org, currency, accountIds: null, shopId: scenario.shopId };
          const tag = `[${scenario.name}]`;

          const orders = await db.$queryRaw<Array<{ id: string; tiktok_order_id: string; seller_id: string | null; items: bigint }>>(Prisma.sql`
            SELECT po.id, po.tiktok_order_id, a.seller_id,
                   (SELECT COUNT(*) FROM fulfillment_orders f JOIN fulfillment_order_items i ON i.fulfillment_order_id = f.id
                     WHERE f.pod_order_id = po.id AND f.deleted_at IS NULL AND i.deleted_at IS NULL)::bigint AS items
              FROM pod_orders po JOIN pod_tiktok_accounts a ON a.id = po.account_id
             WHERE po.organization_id = ${org}::uuid AND po.deleted_at IS NULL AND po.currency = ${currency}
               AND po.ordered_at >= ${window.from} AND po.ordered_at < ${window.before}
               ${scenario.shopId ? Prisma.sql`AND po.shop_id = ${scenario.shopId}::uuid` : Prisma.empty}`);
          const multiItem = orders.filter((o) => Number(o.items) > 1).length;

          // 1. Một dòng mỗi đơn trong order_profit.
          if (orders.length > 0) {
            const [dup] = await db.$queryRaw<Array<{ rows: bigint; ids: bigint }>>(Prisma.sql`
              WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po
                          WHERE po.id IN (${Prisma.join(orders.map((o) => Prisma.sql`${o.id}::uuid`))})),
              ${orderProfitCtes(org, label)}
              SELECT COUNT(*)::bigint AS rows, COUNT(DISTINCT id)::bigint AS ids FROM order_profit`);
            check(`${tag} order_profit một dòng / đơn (${orders.length} đơn, ${multiItem} đơn nhiều item)`, dup.rows === dup.ids && Number(dup.ids) === orders.length, { rows: Number(dup.rows), ids: Number(dup.ids) });
          }

          // 2–3. Bản TS (màn Order) cộng theo seller.
          const ts = new Map<string, { ship: number; shipOrders: number; included: number; revenue: number }>();
          for (let i = 0; i < orders.length; i += 500) {
            const chunk = orders.slice(i, i + 500);
            const fin = await finance.summarize(org, chunk.map((o) => ({ id: o.id, tiktokOrderId: o.tiktok_order_id })));
            for (const order of chunk) {
              const f = fin.get(order.id)!;
              const key = order.seller_id ?? 'null';
              const acc = ts.get(key) ?? { ship: 0, shipOrders: 0, included: 0, revenue: 0 };
              if (f.proceeds && f.proceeds.currency.toUpperCase() === currency.toUpperCase()) {
                acc.revenue += f.proceeds.amount;
                if (f.sellerShipping) {
                  acc.ship += f.sellerShipping.amount;
                  acc.shipOrders += 1;
                  if (f.sellerShipping.includedInProceeds) acc.included += f.sellerShipping.amount;
                }
              }
              ts.set(key, acc);
            }
          }

          const { items } = await repo.sellerStats(filter, window, {
            activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 500, label,
          });
          const shipMismatch: unknown[] = [];
          const profitMismatch: unknown[] = [];
          const currentMismatch: unknown[] = [];
          for (const row of items) {
            const expected = ts.get(row.sellerId ?? 'null') ?? { ship: 0, shipOrders: 0, included: 0, revenue: 0 };
            if (!near(Number(row.shippingFee), expected.ship) || row.shippingFeeOrders !== expected.shipOrders) {
              shipMismatch.push({ seller: row.sellerName, sql: row.shippingFee, sqlOrders: row.shippingFeeOrders, ts: expected.ship, tsOrders: expected.shipOrders });
            }
            // Est. profit: phần phí ship đã nằm trong Revenue khớp bản TS; hiển thị == công thức tay == SQL ORDER BY.
            const shown = sellerEstProfit(row);
            const manualProfit = row.label === null ? null
              : expected.revenue - Number(row.baseCost) - Number(row.label) - (expected.ship - expected.included);
            const sqlOrderBy = row.profit === null ? null : Number(row.profit);
            if (
              !near(Number(row.shippingIncluded), expected.included) ||
              !near(Number(row.revenue), expected.revenue) ||
              (shown === null) !== (manualProfit === null) ||
              (shown !== null && (!near(Number(shown), manualProfit!) || !near(Number(shown), sqlOrderBy!)))
            ) {
              profitMismatch.push({ seller: row.sellerName, shown, manualProfit, sqlOrderBy, included: row.shippingIncluded, tsIncluded: expected.included });
            }
            const current = sellerCurrentProfit(row);
            const manual = row.label === null ? null : Number(row.paid) - Number(row.baseCost) - Number(row.label) - Number(row.shippingFee);
            if ((current === null) !== (manual === null) || (current !== null && !near(Number(current), manual!))) {
              currentMismatch.push({ seller: row.sellerName, current, manual });
            }
          }
          const totalShip = items.reduce((sum, row) => sum + Number(row.shippingFee), 0);
          check(`${tag} Shipping Fee SQL == TS theo seller (${items.length} seller, Σ ${totalShip.toFixed(2)} ${currency})`, shipMismatch.length === 0, shipMismatch.slice(0, 5));
          const totalIncluded = items.reduce((sum, row) => sum + Number(row.shippingIncluded), 0);
          check(`${tag} Est. profit = Revenue − Basecost − Label − (Shipping Fee − đã trong Revenue Σ ${totalIncluded.toFixed(2)}) — hiển thị == tay == SQL`, profitMismatch.length === 0, profitMismatch.slice(0, 5));
          check(`${tag} Current Profit == Paid − Basecost − Label − Shipping Fee`, currentMismatch.length === 0, currentMismatch.slice(0, 5));

          // Thứ tự sắp xếp theo current_profit (SQL) khớp giá trị hiển thị (TS).
          const sorted = await repo.sellerStats(filter, window, {
            activeOnly: false, sort: 'currentProfit', order: 'desc', page: 1, limit: 500, label,
          });
          const values = sorted.items.map((row) => sellerCurrentProfit(row)).filter((v): v is string => v !== null).map(Number);
          check(`${tag} sort=currentProfit giảm dần đúng theo giá trị hiển thị`, values.every((v, i) => i === 0 || values[i - 1] >= v - 0.0001));
          const byProfit = await repo.sellerStats(filter, window, {
            activeOnly: false, sort: 'profit', order: 'desc', page: 1, limit: 500, label,
          });
          const profits = byProfit.items.map((row) => sellerEstProfit(row)).filter((v): v is string => v !== null).map(Number);
          check(`${tag} sort=profit giảm dần đúng theo giá trị hiển thị`, profits.every((v, i) => i === 0 || profits[i - 1] >= v - 0.0001));
        }
      },
      { timeout: 600_000, maxWait: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
  console.log(results.join('\n'));
  if (results.some((line) => line.startsWith('❌'))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
