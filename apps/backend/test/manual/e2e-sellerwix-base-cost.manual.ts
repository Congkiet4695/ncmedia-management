/**
 * Kiểm chứng trên DATABASE THẬT (local) chuỗi giá vốn Sellerwix — "Premium Luster Photo Paper Poster":
 *
 *   response Get order details (đúng dạng tài liệu Sellerwix) ─▶ fulfillment_order_items.base_cost
 *   ─▶ fulfillment_orders.currency ─▶ Lợi nhuận (PodOrderFinanceService) ─▶ Basecost Dashboard (SQL thật)
 *
 * Các bước:
 *   1. Tạo bản ghi fulfillment Sellerwix TẠM cho một đơn POD có dữ liệu tài chính, ĐÚNG trạng thái
 *      của đơn bị lỗi trước bản vá: dòng hàng mang ảnh chụp giá catalog, `currency = NULL`.
 *   2. Ghi nhận TRƯỚC: Lợi nhuận + Basecost Dashboard.
 *   3. Chứng minh nguyên nhân gốc: kể cả khi giá đã xác nhận, `currency = NULL` ⇒ COST_CURRENCY_UNKNOWN,
 *      Dashboard bỏ Basecost.
 *   4. Áp response Sellerwix qua `SellerwixFulfillmentService.applyProviderState` THẬT (không gọi API).
 *   5. Ghi nhận SAU và so sánh. 6. Dọn bản ghi tạm (chỉ đúng bản ghi vừa tạo).
 *
 * Chạy: `node -r ts-node/register -r dotenv/config test/manual/e2e-sellerwix-base-cost.manual.ts`
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { FulfillmentProvider, FulfillmentStatus, FulfillmentTrigger, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { SellerwixFulfillmentService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-fulfillment.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';

const POSTER_SKU = 'SW-PF-PLPPP-WH-24X36';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const scheduler = app.get(SchedulerRegistry);
  scheduler.getCronJobs().forEach((job) => void job.stop());
  const prisma = app.get(PrismaService);
  const sellerwix = app.get(SellerwixFulfillmentService);
  const finance = app.get(PodOrderFinanceService);
  const dashboard = app.get(PodDashboardRepository);
  const results: Array<[string, boolean, string]> = [];
  let createdId: string | null = null;

  try {
    const variant = await prisma.fulfillmentVariant.findFirstOrThrow({
      where: { sku: POSTER_SKU, provider: FulfillmentProvider.SELLERWIX, deletedAt: null },
      include: { product: { select: { name: true } } },
    });
    const account = await prisma.fulfillmentAccount.findUniqueOrThrow({ where: { id: variant.accountId } });
    // Đơn POD có giao dịch tài chính và CHƯA có fulfillment nào — không đụng dữ liệu đang dùng.
    const order = await prisma.podOrder.findFirstOrThrow({
      where: {
        organizationId: account.organizationId,
        deletedAt: null,
        fulfillmentOrders: { none: {} },
        items: { some: {} },
        tiktokOrderId: {
          in: (
            await prisma.podTiktokUnsettledTransaction.findMany({
              where: { organizationId: account.organizationId, type: 'ORDER', deletedAt: null },
              select: { tiktokOrderId: true },
            })
          ).map((row) => row.tiktokOrderId as string),
        },
      },
      include: { items: true },
      orderBy: { orderedAt: 'desc' },
    });
    const item = order.items[0];
    console.log(`Sản phẩm: ${variant.product.name} / ${POSTER_SKU} (catalog cost ${variant.price})`);
    console.log(`Đơn POD: ${order.id} (TikTok ${order.tiktokOrderId}, ${order.currency})`);

    const record = await prisma.fulfillmentOrder.create({
      data: {
        organizationId: order.organizationId,
        accountId: account.id,
        provider: FulfillmentProvider.SELLERWIX,
        podOrderId: order.id,
        externalOrderId: `E2E-${order.tiktokOrderId}`.slice(0, 40),
        providerOrderId: `e2e-swx-${Date.now()}`,
        status: FulfillmentStatus.SUBMITTED,
        submittedAt: new Date(),
        currency: null,
        items: {
          create: {
            organizationId: order.organizationId,
            podOrderItemId: item.id,
            providerSku: POSTER_SKU,
            quantity: 1,
            baseCost: new Prisma.Decimal(variant.price ?? '0'),
          },
        },
      },
      include: { items: true },
    });
    createdId = record.id;

    const day = new Date(order.orderedAt);
    const window = { from: new Date(day.getTime() - 86_400_000), to: new Date(day.getTime() + 86_400_000) };
    const dashboardBaseCost = async () => {
      const stats = await dashboard.sellerStats(
        { organizationId: order.organizationId, currency: order.currency ?? 'USD', accountIds: [order.accountId] },
        window,
        { activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 100, label: { amount: 0.5, currency: 'USD' } },
      );
      return stats.items.reduce((sum, row) => sum + Number(row.baseCost), 0);
    };
    const financials = async () =>
      (await finance.summarize(order.organizationId, [{ id: order.id, tiktokOrderId: order.tiktokOrderId }])).get(
        order.id,
      );

    // --- TRƯỚC ---
    const before = await financials();
    const dashBefore = await dashboardBaseCost();
    results.push(['TRƯỚC: lợi nhuận chưa tính (giá chưa xác nhận)', before?.status === 'COST_PENDING', String(before?.status)]);

    // --- Nguyên nhân gốc: giá đã xác nhận nhưng currency NULL ---
    await prisma.fulfillmentOrderItem.updateMany({
      where: { fulfillmentOrderId: record.id },
      data: { baseCostConfirmedAt: new Date() },
    });
    const rootCause = await financials();
    const dashRootCause = await dashboardBaseCost();
    results.push([
      'NGUYÊN NHÂN GỐC: giá đã xác nhận + currency NULL ⇒ COST_CURRENCY_UNKNOWN',
      rootCause?.status === 'COST_CURRENCY_UNKNOWN',
      String(rootCause?.status),
    ]);
    results.push([
      'NGUYÊN NHÂN GỐC: Dashboard bỏ Basecost của đơn currency NULL',
      dashRootCause === dashBefore,
      `${dashBefore} → ${dashRootCause}`,
    ]);
    await prisma.fulfillmentOrderItem.updateMany({
      where: { fulfillmentOrderId: record.id },
      data: { baseCostConfirmedAt: null },
    });

    // --- Áp response Sellerwix (dạng Get order details của tài liệu) qua service THẬT ---
    const fresh = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: record.id } });
    const providerCost = Number(variant.price);
    await sellerwix.applyProviderState(
      fresh,
      {
        id: fresh.providerOrderId as string,
        reference_id: fresh.externalOrderId,
        total_cost: providerCost + 4,
        line_items: [
          { id: '90001', reference_id: item.tiktokLineItemId ?? item.id, sku: POSTER_SKU, quantity: 1, item_cost: providerCost },
        ],
        fulfillments: [{ status: 'in supplier', shipping_cost: 4, trackings: [] }],
      },
      FulfillmentTrigger.CRON,
    );

    const stored = await prisma.fulfillmentOrder.findUniqueOrThrow({
      where: { id: record.id },
      include: { items: true },
    });
    const after = await financials();
    const dashAfter = await dashboardBaseCost();
    results.push([
      'SAU: fulfillment_orders.currency = SELLERWIX_COST_CURRENCY',
      stored.currency === 'USD',
      String(stored.currency),
    ]);
    results.push([
      'SAU: base_cost = item_cost của dòng biến thể, đã xác nhận, provider_item_id liên kết',
      Number(stored.items[0].baseCost) === providerCost &&
        stored.items[0].baseCostConfirmedAt !== null &&
        stored.items[0].providerItemId === '90001',
      `${String(stored.items[0].baseCost)} / ${String(stored.items[0].baseCostConfirmedAt)} / ${stored.items[0].providerItemId}`,
    ]);
    const expectedProfit = after?.proceeds ? Math.round((after.proceeds.amount - providerCost) * 10_000) / 10_000 : null;
    results.push([
      'SAU: Lợi nhuận tính được = tiền thu về − base cost',
      after?.status === 'OK' && after.productCost === providerCost && after.profit === expectedProfit,
      `${after?.status} proceeds=${after?.proceeds?.amount} cost=${after?.productCost} profit=${after?.profit}`,
    ]);
    results.push([
      'SAU: Basecost Dashboard tăng đúng bằng base cost của đơn',
      Math.abs(dashAfter - dashBefore - providerCost) < 0.0001,
      `${dashBefore} → ${dashAfter}`,
    ]);
  } finally {
    if (createdId) {
      await prisma.fulfillmentHistory.deleteMany({ where: { fulfillmentOrderId: createdId } });
      await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: createdId } });
      await prisma.fulfillmentOrder.delete({ where: { id: createdId } });
      console.log('Đã dọn bản ghi tạm.');
    }
    await app.close();
  }

  for (const [label, ok, detail] of results) console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
