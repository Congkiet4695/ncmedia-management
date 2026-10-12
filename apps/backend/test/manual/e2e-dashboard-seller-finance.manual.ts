/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật) cho bảng "Thống kê seller" của Dashboard: Doanh thu · Basecost · Label ·
 * Profit Dự kiến, với bộ đơn mẫu TẠM phủ mọi nhánh:
 *
 *   O1  đã quyết toán 20 (ship −3 đã trong proceeds) + CÒN một dòng ước tính 25 ⇒ chỉ cộng 20; fulfill 2 dòng (4 + 2)
 *   O2  ước tính 15, ship TikTok chưa tính, Seller tài trợ 2.5 (breakdown) ⇒ trừ 2.5; fulfill 5
 *   O3  ước tính 12, fulfill CHƯA xác nhận giá ⇒ label có, base cost không cộng, profit KHÔNG tính (không coi là 0)
 *   O4  đã quyết toán 18; lần fulfill 1 HUỶ (100) rồi gửi lại 6 ⇒ base cost 6, label MỘT lần
 *   O5  chưa có dữ liệu tài chính, chưa fulfill ⇒ không doanh thu, không label
 *   O6  đã quyết toán 9; fulfill đã HUỶ ⇒ không label, không base cost
 *   O7  ước tính 10, ship do Seller tự gửi (không phải TikTok) & TikTok chưa tính ⇒ phí ship CHƯA xác định ⇒ profit NULL
 *
 * Kỳ vọng (label 0.50 USD): đơn 7 · Doanh thu 84 (6 đơn) · Basecost 19 (4 đơn) · đã fulfill 5 ⇒ Label 2.50 ·
 * Profit Dự kiến 13.5 + 7 + 11.5 = 32 (3 đơn). Mỗi con số còn được đối chiếu với màn Order (PodOrderFinanceService).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-dashboard-seller-finance.manual.ts
 * Đơn mẫu đặt vào một ngày KHÔNG có dữ liệu thật (2020-01-15) và được xoá sạch ở cuối.
 */
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodDashboardService } from '../../src/modules/pod-tiktok/services/pod-dashboard.service';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${ok || detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`);
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? a == b : Math.abs(a - b) < 0.0001;

const DAY = '2020-01-15';
const AT = new Date('2020-01-15T05:00:00.000Z'); // 12:00 giờ vận hành (+07)
const TAG = `E2EDSF${Date.now()}`;

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const config = { get: (key: string, fallback: unknown) => (key === 'timezoneOffsetMinutes' ? 420 : fallback) } as unknown as ConfigService;
  const service = new PodDashboardService(new PodDashboardRepository(prisma), config);
  const finance = new PodOrderFinanceService(prisma, config);
  const label = finance.labelCost();
  const ALL = { allShops: true, accountIds: [], shopIds: [] };

  const shop = await prisma.podTiktokShop.findFirstOrThrow({ where: { deletedAt: null }, include: { account: true } });
  const org = shop.organizationId;
  const statement = await prisma.podTiktokStatement.findFirstOrThrow({ where: { organizationId: org } });
  // UNIQUE (pod_order_id, provider): gửi lại CÙNG nhà cung cấp = cập nhật bản ghi cũ; gửi sang nhà cung cấp KHÁC = bản ghi mới.
  const fAccounts = await prisma.fulfillmentAccount.findMany({ where: { organizationId: org, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const providers = [...new Map(fAccounts.map((a) => [a.provider, a])).values()];
  if (providers.length < 2) throw new Error('Cần ít nhất 2 nhà cung cấp fulfillment để mô phỏng gửi lại sang nhà cung cấp khác');
  const [fAccount, fAccount2] = providers;
  const existing = await prisma.podOrder.count({ where: { organizationId: org, orderedAt: { gte: new Date('2020-01-14T17:00:00Z'), lte: new Date('2020-01-15T16:59:59Z') } } });
  if (existing > 0) throw new Error(`Ngày ${DAY} đã có ${existing} đơn thật — chọn ngày khác`);

  const created = { orders: [] as string[], fulfillments: [] as string[], settled: [] as string[], unsettled: [] as string[] };
  const order = async (key: string, shippingType: string | null) => {
    const row = await prisma.podOrder.create({
      data: {
        organizationId: org,
        accountId: shop.accountId,
        shopId: shop.id,
        tiktokOrderId: `${TAG}-${key}`,
        status: 'DELIVERED',
        currency: 'USD',
        orderedAt: AT,
        tiktokCreateTime: BigInt(Math.floor(AT.getTime() / 1000)),
        tiktokUpdateTime: BigInt(Math.floor(AT.getTime() / 1000)),
        tiktokUpdatedAt: AT,
        payloadHash: '0'.repeat(64),
        rawPayload: {},
        syncSource: 'MANUAL',
        lastSyncedAt: new Date(),
        shippingType,
      } as never,
    });
    created.orders.push(row.id);
    return row;
  };
  const settled = async (orderKey: string, amount: number, ship: number) => {
    const row = await prisma.podTiktokStatementTransaction.create({
      data: {
        organizationId: org, accountId: shop.accountId, shopId: shop.id, statementId: statement.id,
        tiktokTransactionId: `${TAG}-S-${orderKey}`, type: 'ORDER', tiktokOrderId: `${TAG}-${orderKey}`, currency: 'USD',
        settlementAmount: new Prisma.Decimal(amount), shippingCostAmount: new Prisma.Decimal(ship),
      },
    });
    created.settled.push(row.id);
  };
  const unsettled = async (orderKey: string, amount: number, ship: number, breakdown: Prisma.InputJsonValue | null) => {
    const row = await prisma.podTiktokUnsettledTransaction.create({
      data: {
        organizationId: org, accountId: shop.accountId, shopId: shop.id,
        tiktokTransactionId: `${TAG}-U-${orderKey}`, type: 'ORDER', tiktokOrderId: `${TAG}-${orderKey}`, currency: 'USD',
        estSettlementAmount: new Prisma.Decimal(amount), estShippingCostAmount: new Prisma.Decimal(ship),
        shippingCostBreakdown: breakdown ?? Prisma.JsonNull, fetchedAt: new Date(),
      },
    });
    created.unsettled.push(row.id);
  };
  const fulfill = async (podOrderId: string, status: string, costs: number[], confirmed: boolean, updatedAt: Date, account = fAccount) => {
    const row = await prisma.fulfillmentOrder.create({
      data: {
        organizationId: org, accountId: account.id, provider: account.provider, podOrderId,
        externalOrderId: `${TAG}-F-${created.fulfillments.length}`.slice(0, 40), status: status as never,
        submittedAt: new Date(), currency: 'USD',
        items: {
          create: costs.map((cost) => ({
            organizationId: org, providerSku: 'E2E', quantity: 1, baseCost: new Prisma.Decimal(cost),
            baseCostConfirmedAt: confirmed ? new Date() : null,
          })),
        },
      },
    });
    created.fulfillments.push(row.id);
    await prisma.$executeRaw`UPDATE fulfillment_orders SET updated_at = ${updatedAt} WHERE id = ${row.id}::uuid`;
  };

  try {
    check('Label cấu hình = 0.50 USD / đơn (một nguồn với màn Order)', label.amount === 0.5 && label.currency === 'USD', label);
    const early = new Date(Date.now() - 3600_000);
    const late = new Date();

    const o1 = await order('O1', 'TIKTOK');
    await settled('O1', 20, -3);
    await unsettled('O1', 25, -3, null);
    await fulfill(o1.id, 'SHIPPED', [4, 2], true, late);

    const o2 = await order('O2', 'TIKTOK');
    await unsettled('O2', 15, 0, { actual_shipping_fee_amount: '0', supplementary_component: { seller_shipping_fee_discount_amount: '-2.5' } });
    await fulfill(o2.id, 'SHIPPED', [5], true, late);

    const o3 = await order('O3', 'TIKTOK');
    await unsettled('O3', 12, -1, null);
    await fulfill(o3.id, 'SUBMITTED', [3], false, late);

    const o4 = await order('O4', 'TIKTOK');
    await settled('O4', 18, -2);
    await fulfill(o4.id, 'CANCELLED', [100], true, early);
    await fulfill(o4.id, 'SUBMITTED', [6], true, late, fAccount2); // gửi lại sang nhà cung cấp khác

    await order('O5', 'TIKTOK');

    const o6 = await order('O6', 'TIKTOK');
    await settled('O6', 9, -1);
    await fulfill(o6.id, 'CANCELLED', [7], true, late);

    const o7 = await order('O7', 'SELLER');
    await unsettled('O7', 10, 0, null);
    await fulfill(o7.id, 'SHIPPED', [2], true, late);

    const page = await service.sellers(org, ALL, { from: DAY, to: DAY, page: 1, limit: 100 });
    const row = page.items.find((r) => r.sellerId === (shop.account.sellerId ?? null));
    check('Có đúng một dòng seller cho ngày mẫu', page.items.filter((r) => r.orders > 0).length === 1 && !!row, page.items);
    if (!row) throw new Error('không thấy dòng seller');

    check('Tổng đơn = 7', row.orders === 7, row);
    check('Doanh thu = 84: settled khi đã quyết toán, ước tính khi chưa (O1 KHÔNG cộng thêm 25 ước tính)', near(row.revenue, 84) && row.revenueOrders === 6, row);
    check('Đơn chưa có dữ liệu tài chính (O5) không được tính 0 vào doanh thu — revenueOrders 6/7', row.revenueOrders === 6 && row.orders === 7);
    check('Basecost = 19: chỉ giá đã xác nhận của lần fulfill đang giữ (O4 bỏ lần huỷ 100; O3 chưa xác nhận không cộng)', near(row.baseCost, 19) && row.baseCostOrders === 4, row);
    check('Label = 5 đơn đã fulfill × 0.50 = 2.50 (O1 hai dòng vẫn MỘT label; O4 gửi lại vẫn MỘT; O6 huỷ ⇒ 0)', row.fulfilledOrders === 5 && near(row.label, 2.5), row);
    check('Profit Dự kiến = 32 = Σ (Doanh thu − Base − Label − Ship Seller chưa trong proceeds) của 3 đơn đủ dữ kiện', near(row.profit, 32) && row.profitOrders === 3, row);
    check('O3 (chưa xác nhận giá) & O7 (phí ship chưa xác định) KHÔNG bị tính profit với 0', row.profitOrders === 3);

    // Đối chiếu TỪNG ĐƠN với màn Order.
    const orders = await prisma.podOrder.findMany({ where: { id: { in: created.orders } }, select: { id: true, tiktokOrderId: true } });
    const fin = await finance.summarize(org, orders);
    const byKey = (key: string) => fin.get(orders.find((o) => o.tiktokOrderId === `${TAG}-${key}`)!.id)!;
    check('Màn Order O1: proceeds SETTLED 20, profit 13.5', byKey('O1').proceeds?.source === 'SETTLED' && near(byKey('O1').proceeds?.amount, 20) && near(byKey('O1').profit, 13.5), byKey('O1'));
    check('Màn Order O2: ship Seller 2.5 chưa trong proceeds ⇒ profit 15 − 5 − 2.5 − 0.5 = 7', near(byKey('O2').profit, 7) && byKey('O2').sellerShipping?.includedInProceeds === false, byKey('O2'));
    check('Màn Order O3: profit null (chờ xác nhận giá)', byKey('O3').profit === null, byKey('O3').status);
    check('Màn Order O4: base cost 6 (lần gửi lại), profit 11.5', near(byKey('O4').productCost, 6) && near(byKey('O4').profit, 11.5), byKey('O4'));
    check('Màn Order O7: phí ship chưa xác định ⇒ profit null (không lấp 0)', byKey('O7').profit === null && byKey('O7').sellerShipping === null, byKey('O7').status);
    const tsProfit = [...fin.values()].reduce((sum, f) => sum + (f.profit ?? 0), 0);
    const tsRevenue = [...fin.values()].reduce((sum, f) => sum + (f.proceeds?.amount ?? 0), 0);
    check('Dashboard == Σ màn Order (Doanh thu, Profit)', near(row.revenue, tsRevenue) && near(row.profit, tsProfit), { tsRevenue, tsProfit });

    // Cancel fulfill rồi re-fulfill O2 ⇒ label không nhân đôi, profit theo lần gửi mới.
    const o2records = await prisma.fulfillmentOrder.findMany({ where: { podOrderId: o2.id } });
    await prisma.fulfillmentOrder.update({ where: { id: o2records[0].id }, data: { status: 'CANCELLED' as never } });
    const afterCancel = (await service.sellers(org, ALL, { from: DAY, to: DAY, limit: 100 })).items.find((r) => r.sellerId === row.sellerId)!;
    check('Huỷ fulfill O2 ⇒ còn 4 đơn đã fulfill (label 2.00), profit bỏ O2 (25)', afterCancel.fulfilledOrders === 4 && near(afterCancel.label, 2) && near(afterCancel.profit, 25), afterCancel);
    await prisma.fulfillmentOrder.update({ where: { id: o2records[0].id }, data: { status: 'SUBMITTED' as never } }); // gửi lại cùng nhà cung cấp
    const afterRefulfill = (await service.sellers(org, ALL, { from: DAY, to: DAY, limit: 100 })).items.find((r) => r.sellerId === row.sellerId)!;
    check('Fulfill lại O2 ⇒ quay về 5 đơn / label 2.50 / profit 32 (không cộng label hay base hai lần)', afterRefulfill.fulfilledOrders === 5 && near(afterRefulfill.label, 2.5) && near(afterRefulfill.profit, 32) && near(afterRefulfill.baseCost, 19), afterRefulfill);

    // Sắp xếp theo Label chạy được (whitelist).
    const sorted = await service.sellers(org, ALL, { from: DAY, to: DAY, sort: 'label', order: 'desc', limit: 5 });
    check('Sắp xếp theo cột Label', sorted.items.length > 0);
  } finally {
    await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: { in: created.fulfillments } } });
    await prisma.fulfillmentOrder.deleteMany({ where: { podOrderId: { in: created.orders } } });
    await prisma.podTiktokStatementTransaction.deleteMany({ where: { id: { in: created.settled } } });
    await prisma.podTiktokUnsettledTransaction.deleteMany({ where: { id: { in: created.unsettled } } });
    await prisma.podOrder.deleteMany({ where: { id: { in: created.orders } } });
    const left = await prisma.podOrder.count({ where: { tiktokOrderId: { startsWith: TAG } } });
    results.push(`${left === 0 ? '✅' : '❌'} Đã dọn sạch dữ liệu mẫu (${created.orders.length} đơn, ${created.fulfillments.length} lần fulfill)`);
    console.log(results.join('\n'));
    await prisma.$disconnect();
  }
  if (results.some((r) => r.startsWith('❌'))) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
