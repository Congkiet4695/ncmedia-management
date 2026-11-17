/**
 * **Order Base Cost = Provider Total** — Postgres THẬT: màn Order (TS `PodOrderFinanceService` → `calculateOrderFinancials`)
 * và Dashboard / Thống kê nhân viên (SQL `orderProfitCtes`) phải ra CÙNG giá vốn, CÙNG cờ label, CÙNG lợi nhuận.
 *
 * Kịch bản đúng đơn 577685712591753317 (Mango): 2 dòng × 5.45 (Σ 10.90), Provider Total 19.40 (subtotal 18.90 + ship 0.50).
 *
 * CHỈ chạy trên database thử dùng một lần:
 *   DATABASE_URL=postgresql://ncm_test@127.0.0.1:55432/ncm_shot node -r ts-node/register test/manual/e2e-order-base-cost-provider-total.manual.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { orderProfitCtes } from '../../src/modules/pod-tiktok/shared/order-profit.sql';

if (!/@127\.0\.0\.1:55432\//.test(process.env.DATABASE_URL ?? '')) throw new Error('Chỉ chạy trên database thử 127.0.0.1:55432');

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const RUN = `OBC${Date.now()}`;
const LABEL = { amount: 0.5, currency: 'USD' };

async function main(): Promise<void> {
  // Một đơn USD có thật trong database thử, CHƯA có lần fulfill nào và chưa có Base Cost nhập tay.
  const order = await prisma.podOrder.findFirst({
    where: { deletedAt: null, currency: 'USD', baseCost: null, fulfillmentOrders: { none: {} } },
    select: { id: true, organizationId: true, accountId: true, shopId: true, tiktokOrderId: true, designAmount: true },
  });
  if (!order) throw new Error('Không có đơn USD phù hợp trong database thử');
  const design = Number(order.designAmount ?? 0);
  const finance = new PodOrderFinanceService(prisma as never, { get: (_k: string, fallback?: unknown) => (_k === 'orderLabelCost' ? LABEL : fallback) } as never);

  const account = await prisma.fulfillmentAccount.create({
    data: { organizationId: order.organizationId, provider: 'MANGO', name: `${RUN} Mango`, apiKeyEnc: 'not-a-real-key', apiKeyHint: 'none', isActive: true } as never,
  });
  const unsettled = await prisma.podTiktokUnsettledTransaction.create({
    data: {
      organizationId: order.organizationId,
      accountId: order.accountId,
      shopId: order.shopId,
      tiktokTransactionId: `${RUN}-TX`,
      tiktokOrderId: order.tiktokOrderId,
      type: 'ORDER',
      currency: 'USD',
      estSettlementAmount: new Prisma.Decimal('40'),
      estShippingCostAmount: new Prisma.Decimal('-4.99'),
      fetchedAt: new Date(),
    } as never,
  });
  const record = await prisma.fulfillmentOrder.create({
    data: {
      organizationId: order.organizationId,
      podOrderId: order.id,
      accountId: account.id,
      provider: 'MANGO',
      externalOrderId: `NC-${RUN}`,
      status: 'IN_PRODUCTION',
      subtotal: new Prisma.Decimal('18.9'),
      shippingFee: new Prisma.Decimal('0.5'),
      tax: new Prisma.Decimal('0'),
      total: new Prisma.Decimal('19.4'),
      currency: 'USD',
      submittedAt: new Date(),
      items: {
        create: [0, 1].map((index) => ({
          organizationId: order.organizationId,
          providerSku: `5000B-${index}`,
          quantity: 1,
          baseCost: new Prisma.Decimal('5.45'),
          baseCostConfirmedAt: new Date(),
        })),
      },
    } as never,
  });

  const sqlRow = async () =>
    (
      await prisma.$queryRaw<Array<{ base_cost: Prisma.Decimal | null; label_included: boolean | null; profit: Prisma.Decimal | null }>>(Prisma.sql`
        WITH o AS (SELECT id, tiktok_order_id, shop_id FROM pod_orders WHERE id = ${order.id}::uuid),
        ${orderProfitCtes(order.organizationId, LABEL)}
        SELECT base_cost, label_included, profit FROM order_profit`)
    )[0];
  const tsRow = async () => (await finance.summarize(order.organizationId, [{ id: order.id, tiktokOrderId: order.tiktokOrderId }])).get(order.id)!;
  const num = (value: Prisma.Decimal | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

  try {
    // ---- A: nhà cung cấp đã trả tổng ----
    let ts = await tsRow();
    let sql = await sqlRow();
    const expectedA = Math.round((40 - 19.4 - design) * 10_000) / 10_000;
    check(
      'A Provider Total 19.40 (Σ dòng 10.90) ⇒ Base Cost = 19.40, label KHÔNG trừ — màn Order (TS) == Dashboard (SQL)',
      ts.productCost === 19.4 && num(sql.base_cost) === 19.4 && ts.labelIncludedInCost && sql.label_included === true &&
        ts.profit === expectedA && num(sql.profit) === expectedA,
      `TS base=${ts.productCost} profit=${ts.profit} · SQL base=${num(sql.base_cost)} profit=${num(sql.profit)} · kỳ vọng ${expectedA}`,
    );

    // ---- B: nhà cung cấp chưa trả tổng ⇒ Σ dòng đã xác nhận + label (như trước) ----
    await prisma.fulfillmentOrder.update({ where: { id: record.id }, data: { total: null } });
    ts = await tsRow();
    sql = await sqlRow();
    const expectedB = Math.round((40 - 10.9 - 0.5 - design) * 10_000) / 10_000;
    check(
      'B Chưa có Provider Total ⇒ Σ dòng 10.90 + trừ label 0.50 (hành vi cũ) — TS == SQL',
      ts.productCost === 10.9 && num(sql.base_cost) === 10.9 && !ts.labelIncludedInCost && sql.label_included === false &&
        ts.profit === expectedB && num(sql.profit) === expectedB,
      `TS ${ts.productCost}/${ts.profit} · SQL ${num(sql.base_cost)}/${num(sql.profit)} · kỳ vọng ${expectedB}`,
    );

    // ---- C: lần gửi FAILED (có số tổng cũ) ⇒ không có giá vốn thật ----
    await prisma.fulfillmentOrder.update({ where: { id: record.id }, data: { total: new Prisma.Decimal('19.4'), status: 'FAILED' } });
    ts = await tsRow();
    sql = await sqlRow();
    check(
      'C Lần gửi FAILED ⇒ KHÔNG lấy tổng làm giá vốn (không có giá vốn, không lợi nhuận) — TS == SQL',
      ts.productCost === null && ts.status === 'NO_COST' && sql.base_cost === null && sql.profit === null,
      `TS ${ts.productCost}/${ts.status} · SQL ${num(sql.base_cost)}/${num(sql.profit)}`,
    );

    // ---- D: Base Cost nhập tay thắng Provider Total ----
    await prisma.fulfillmentOrder.update({ where: { id: record.id }, data: { status: 'IN_PRODUCTION' } });
    await prisma.podOrder.update({ where: { id: order.id }, data: { baseCost: new Prisma.Decimal('21'), baseCostCurrency: 'USD' } as never });
    ts = await tsRow();
    sql = await sqlRow();
    const expectedD = Math.round((40 - 21 - 0.5 - design) * 10_000) / 10_000;
    check(
      'D Base Cost nhập tay 21 thắng Provider Total, label trừ như trước — TS == SQL',
      ts.productCost === 21 && num(sql.base_cost) === 21 && sql.label_included === false && ts.profit === expectedD && num(sql.profit) === expectedD,
      `TS ${ts.productCost}/${ts.profit} · SQL ${num(sql.base_cost)}/${num(sql.profit)}`,
    );
  } finally {
    await prisma.podOrder.update({ where: { id: order.id }, data: { baseCost: null, baseCostCurrency: null } as never });
    await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: record.id } });
    await prisma.fulfillmentOrder.delete({ where: { id: record.id } });
    await prisma.podTiktokUnsettledTransaction.delete({ where: { id: unsettled.id } });
    await prisma.fulfillmentAccount.delete({ where: { id: account.id } });
  }

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
