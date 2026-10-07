/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật) cho công thức lợi nhuận mới:
 *   Profit = Est. proceeds − Base cost − Phí ship Seller CHƯA trong proceeds − Label (0.50 / đơn)
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-order-profit-shipping.manual.ts
 *
 * Dữ liệu tài chính là dữ liệu THẬT đã đồng bộ từ TikTok (statement + unsettled transactions). Để mọi
 * nhánh phí ship đều được tính tới lợi nhuận, kịch bản gắn TẠM một lần fulfill có giá vốn xác nhận
 * ($4 / đơn) cho mọi đơn chưa fulfill, rồi đối chiếu TỪNG ĐƠN:
 *   - TS (`calculateOrderFinancials`, màn Order) == SQL (`orderProfitCtes`, Thống kê nhân viên / Dashboard);
 *   - đơn ĐÃ có phí ship trong proceeds ⇒ KHÔNG bị trừ lần hai;
 *   - đơn CHƯA có ⇒ trừ đúng seller_shipping_fee_discount_amount;
 *   - TikTok thiếu dữ liệu ⇒ SHIPPING_UNKNOWN (không lấp 0).
 * Mọi dữ liệu tạm được xoá / khôi phục ở cuối.
 */
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { orderProfitCtes } from '../../src/modules/pod-tiktok/shared/order-profit.sql';

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? a == b : Math.abs(a - b) < 0.0001;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const finance = app.get(PodOrderFinanceService);
  const label = finance.labelCost();
  const createdFulfillments: string[] = [];
  const restore: Array<() => Promise<unknown>> = [];

  const sample = await prisma.podOrder.findFirstOrThrow({ where: { deletedAt: null, currency: 'USD' }, select: { organizationId: true } });
  const org = sample.organizationId;
  const fAccount = await prisma.fulfillmentAccount.findFirstOrThrow({ where: { organizationId: org, deletedAt: null } });

  const sqlProfits = async (ids: string[]) =>
    new Map(
      (
        await prisma.$queryRaw<Array<{ id: string; profit: Prisma.Decimal | null }>>(Prisma.sql`
          WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po WHERE po.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})),
          ${orderProfitCtes(org, label)}
          SELECT id, profit FROM order_profit`)
      ).map((row) => [row.id, row.profit === null ? null : Number(row.profit)]),
    );

  try {
    check('Label cost cấu hình = 0.50 USD / đơn', label.amount === 0.5 && label.currency === 'USD', label);

    const orders = await prisma.podOrder.findMany({
      where: { organizationId: org, deletedAt: null },
      select: { id: true, tiktokOrderId: true, fulfillmentOrders: { where: { deletedAt: null }, select: { id: true } } },
    });
    for (const order of orders.filter((o) => o.fulfillmentOrders.length === 0)) {
      const record = await prisma.fulfillmentOrder.create({
        data: {
          organizationId: org,
          accountId: fAccount.id,
          provider: fAccount.provider,
          podOrderId: order.id,
          externalOrderId: `E2E-PS-${order.id.slice(0, 8)}-${Date.now()}`.slice(0, 40),
          status: 'SHIPPED',
          submittedAt: new Date(),
          currency: 'USD',
          items: { create: [{ organizationId: org, providerSku: 'E2E', quantity: 1, baseCost: new Prisma.Decimal(4), baseCostConfirmedAt: new Date() }] },
        },
      });
      createdFulfillments.push(record.id);
    }

    const ids = orders.map((o) => o.id);
    const ts = await finance.summarize(org, orders);
    const sql = await sqlProfits(ids);
    const mismatches = ids.filter((id) => !near(ts.get(id)?.profit ?? null, sql.get(id) ?? null));
    const bySource: Record<string, number> = {};
    for (const f of ts.values()) {
      const key = f.sellerShipping ? `${f.sellerShipping.source}${f.sellerShipping.includedInProceeds ? ' (đã trong proceeds)' : ' (chưa trừ)'}` : `null:${f.status}`;
      bySource[key] = (bySource[key] ?? 0) + 1;
    }
    check(`SQL == TS lợi nhuận cho MỌI đơn (${ids.length}) — mọi nhánh phí ship`, mismatches.length === 0, { mismatches: mismatches.length, bySource });

    // Đã có phí ship trong proceeds ⇒ profit = proceeds − 4 − 0.50 (KHÔNG trừ ship lần hai).
    const included = [...ts.values()].filter((f) => f.status === 'OK' && f.sellerShipping?.includedInProceeds && (f.sellerShipping?.amount ?? 0) > 0);
    check(
      'Phí ship ĐÃ nằm trong proceeds ⇒ không trừ lần hai (profit = proceeds − base − label)',
      included.length > 0 && included.every((f) => near(f.profit, (f.proceeds?.amount ?? 0) - 4 - label.amount)),
      { orders: included.length, sample: included[0] && { proceeds: included[0].proceeds?.amount, ship: included[0].sellerShipping, profit: included[0].profit } },
    );

    // "Shipping fee after discounts = $0" nhưng Seller tài trợ free ship ⇒ trừ đúng khoản đó.
    const pending = [...ts.values()].filter((f) => f.status === 'OK' && f.sellerShipping && !f.sellerShipping.includedInProceeds && f.sellerShipping.amount > 0);
    check(
      'TEST 1 (dữ liệu thật) — ship sau giảm $0, Seller tài trợ $X ⇒ trừ X (profit = proceeds − base − X − label)',
      pending.length > 0 && pending.every((f) => near(f.profit, (f.proceeds?.amount ?? 0) - 4 - (f.sellerShipping?.amount ?? 0) - label.amount)),
      { orders: pending.length, sample: pending[0] && { proceeds: pending[0].proceeds?.amount, ship: pending[0].sellerShipping, profit: pending[0].profit } },
    );

    // TEST 5 — TikTok chưa có breakdown + order detail không có seller discount ⇒ SHIPPING_UNKNOWN cả hai bên.
    const target = await prisma.podTiktokUnsettledTransaction.findFirstOrThrow({
      where: { organizationId: org, deletedAt: null, estShippingCostAmount: 0, tiktokOrderId: { not: null } },
    });
    const order = await prisma.podOrder.findFirstOrThrow({ where: { organizationId: org, tiktokOrderId: target.tiktokOrderId as string } });
    restore.push(() => prisma.podTiktokUnsettledTransaction.update({ where: { id: target.id }, data: { shippingCostBreakdown: target.shippingCostBreakdown ?? Prisma.JsonNull } }));
    restore.push(() => prisma.podOrder.update({ where: { id: order.id }, data: { shippingFeeSellerDiscount: order.shippingFeeSellerDiscount } }));
    await prisma.podTiktokUnsettledTransaction.update({ where: { id: target.id }, data: { shippingCostBreakdown: Prisma.JsonNull } });
    await prisma.podOrder.update({ where: { id: order.id }, data: { shippingFeeSellerDiscount: null } });
    const unknownTs = (await finance.summarize(org, [order])).get(order.id);
    const unknownSql = (await sqlProfits([order.id])).get(order.id);
    check('TEST 5 — TikTok chưa trả dữ liệu phí ship ⇒ sellerShipping NULL, profit NULL (TS & SQL), KHÔNG lấp 0', unknownTs?.status === 'SHIPPING_UNKNOWN' && unknownTs.sellerShipping === null && unknownTs.profit === null && unknownSql === null, { status: unknownTs?.status });

    // Nguồn dự phòng Get Order Detail khi chỉ breakdown thiếu.
    await prisma.podOrder.update({ where: { id: order.id }, data: { shippingFeeSellerDiscount: order.shippingFeeSellerDiscount } });
    const fallbackTs = (await finance.summarize(org, [order])).get(order.id);
    const fallbackSql = (await sqlProfits([order.id])).get(order.id);
    check('Breakdown thiếu ⇒ dùng payment.shipping_fee_seller_discount (Get Order Detail); TS == SQL', fallbackTs?.sellerShipping?.source === 'ORDER_DETAIL' && near(fallbackTs.profit, fallbackSql ?? null), { ship: fallbackTs?.sellerShipping, ts: fallbackTs?.profit, sql: fallbackSql });

    // TEST 8 — đổi base cost ⇒ lợi nhuận tính lại ngay (không lưu sẵn).
    const any = [...ts.entries()].find(([, f]) => f.status === 'OK');
    if (any && createdFulfillments.length) {
      const [orderId, before] = any;
      const item = await prisma.fulfillmentOrderItem.findFirstOrThrow({ where: { fulfillmentOrder: { podOrderId: orderId, deletedAt: null } } });
      const oldCost = item.baseCost;
      restore.push(() => prisma.fulfillmentOrderItem.update({ where: { id: item.id }, data: { baseCost: oldCost } }));
      await prisma.fulfillmentOrderItem.update({ where: { id: item.id }, data: { baseCost: new Prisma.Decimal(Number(oldCost) + 1) } });
      const after = (await finance.summarize(org, orders.filter((o) => o.id === orderId))).get(orderId);
      check('TEST 8 — tăng base cost $1 ⇒ lợi nhuận giảm đúng $1 ngay lần đọc sau', near((before.profit ?? 0) - 1, after?.profit ?? null), { before: before.profit, after: after?.profit });
    }
  } finally {
    for (const undo of restore.reverse()) await undo();
    if (createdFulfillments.length) {
      await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: { in: createdFulfillments } } });
      await prisma.fulfillmentOrder.deleteMany({ where: { id: { in: createdFulfillments } } });
    }
    console.log(`Đã dọn ${createdFulfillments.length} lần fulfill tạm; dữ liệu tài chính đã khôi phục.`);
    console.log(results.join('\n'));
    await app.close();
  }
  if (results.some((r) => r.startsWith('❌'))) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
