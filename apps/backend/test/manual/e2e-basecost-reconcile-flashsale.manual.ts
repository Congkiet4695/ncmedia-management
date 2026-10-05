/**
 * Kiểm chứng trên DATABASE THẬT (local), bằng service THẬT (không gọi nhà cung cấp / TikTok):
 *
 *   A. Auto Flash Sale — lưu "Khoảng thời gian", đọc lại luật; bỏ trống field mới ⇒ GIỮ giá trị cũ.
 *   B. Base Cost thủ công — đơn đã fulfill chưa có giá ⇒ nhập tay ⇒ DB (giá + xác nhận + đơn vị tiền
 *      + nhật ký) ⇒ Lợi nhuận (PodOrderFinanceService) ⇒ Basecost Dashboard (SQL thật); Seller shop
 *      khác ⇒ 403.
 *   C. Đối soát — bản ghi FAILED đã có mã nhà cung cấp và SUBMITTING bị kẹt nằm trong lượt đồng bộ.
 *
 * Mọi dữ liệu tạm được dọn; cấu hình Auto được khôi phục nguyên trạng.
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/e2e-basecost-reconcile-flashsale.manual.ts
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { FulfillmentProvider, FulfillmentStatus, PodFlashSaleAutoDuration } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { FulfillmentRepository } from '../../src/modules/fulfillment/repositories/fulfillment.repository';
import { FulfillmentService } from '../../src/modules/fulfillment/services/fulfillment.service';
import { PodFlashSaleAutoService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-auto.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => void job.stop());
  const prisma = app.get(PrismaService);
  const results: Array<[string, boolean, string]> = [];
  const check = (label: string, ok: boolean, detail: unknown) => results.push([label, ok, JSON.stringify(detail)]);
  const createdRecords: string[] = [];
  let restoreConfig: (() => Promise<void>) | null = null;

  try {
    // ------------------------------------------------------------- A. Auto Flash Sale
    const auto = app.get(PodFlashSaleAutoService);
    // Tổ chức có đơn POD kèm dữ liệu tài chính TikTok (cần cho phần B) + một Admin của CHÍNH tổ chức đó.
    const withFinance = await prisma.podTiktokUnsettledTransaction.findFirstOrThrow({
      where: { type: 'ORDER', deletedAt: null },
      select: { organizationId: true },
    });
    const org = withFinance.organizationId;
    const admin = await prisma.user.findFirstOrThrow({
      where: { organizationId: org, deletedAt: null, role: { code: 'ADMIN' } },
      select: { id: true, organizationId: true },
    });
    const original = await prisma.podFlashSaleAutoConfig.findUnique({ where: { organizationId: org } });
    restoreConfig = async () => {
      if (original) {
        await prisma.podFlashSaleAutoConfig.update({
          where: { organizationId: org },
          data: {
            enabled: original.enabled,
            runTime: original.runTime,
            timezone: original.timezone,
            duration: original.duration,
            durationMode: original.durationMode,
            lastScheduledAt: original.lastScheduledAt,
            deletedAt: original.deletedAt,
          },
        });
      } else {
        await prisma.podFlashSaleAutoConfig.deleteMany({ where: { organizationId: org } });
      }
    };
    const base = { enabled: false, runTime: original?.runTime ?? '05:00', timezone: original?.timezone ?? 'America/Los_Angeles' };
    const saved = await auto.updateConfig(org, admin.id, { ...base, duration: PodFlashSaleAutoDuration.ONE_DAY });
    const row = await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } });
    check('A1 lưu Khoảng thời gian = 1 ngày (DB)', row.duration === 'ONE_DAY' && row.durationMode === 'CALENDAR_DAYS', {
      duration: row.duration,
      mode: row.durationMode,
    });
    check('A2 luật trả về: 1 ngày lịch, kết thúc 23:59:59', saved.rules.durationDays === 1 && saved.rules.endOfDay === '23:59:59', saved.rules);
    await auto.updateConfig(org, admin.id, base); // client cũ: không gửi duration
    const kept = await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } });
    check('A3 không gửi field mới ⇒ GIỮ cấu hình đang lưu', kept.duration === 'ONE_DAY', { duration: kept.duration });

    // ------------------------------------------------------------- B. Base Cost thủ công
    const order = await prisma.podOrder.findFirstOrThrow({
      where: {
        organizationId: org,
        deletedAt: null,
        fulfillmentOrders: { none: {} },
        items: { some: {} },
        tiktokOrderId: {
          in: (
            await prisma.podTiktokUnsettledTransaction.findMany({
              where: { organizationId: org, type: 'ORDER', deletedAt: null },
              select: { tiktokOrderId: true },
            })
          ).map((tx) => tx.tiktokOrderId as string),
        },
      },
      include: { items: true },
      orderBy: { orderedAt: 'desc' },
    });
    const account = await prisma.fulfillmentAccount.findFirstOrThrow({
      where: { organizationId: org, provider: FulfillmentProvider.SELLERWIX, deletedAt: null },
    });
    const record = await prisma.fulfillmentOrder.create({
      data: {
        organizationId: org,
        accountId: account.id,
        provider: FulfillmentProvider.SELLERWIX,
        podOrderId: order.id,
        externalOrderId: `E2E-BC-${Date.now()}`,
        providerOrderId: `e2e-bc-${Date.now()}`,
        status: FulfillmentStatus.SHIPPED,
        submittedAt: new Date(),
        currency: null,
        items: {
          create: { organizationId: org, podOrderItemId: order.items[0].id, providerSku: 'SW-PF-PLPPP-WH-24X36', quantity: 1 },
        },
      },
      include: { items: true },
    });
    createdRecords.push(record.id);

    const finance = app.get(PodOrderFinanceService);
    const dashboard = app.get(PodDashboardRepository);
    const financials = async () => (await finance.summarize(org, [{ id: order.id, tiktokOrderId: order.tiktokOrderId }])).get(order.id);
    const window = { from: new Date(order.orderedAt.getTime() - 86_400_000), to: new Date(order.orderedAt.getTime() + 86_400_000) };
    const dashboardCost = async () =>
      (
        await dashboard.sellerStats(
          { organizationId: org, currency: order.currency ?? 'USD', accountIds: [order.accountId] },
          window,
          { activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 100 },
        )
      ).items.reduce((sum, item) => sum + Number(item.baseCost), 0);

    const before = await financials();
    const dashBefore = await dashboardCost();
    check('B1 TRƯỚC: đơn đã fulfill nhưng chưa có giá ⇒ lợi nhuận chưa tính', before?.status === 'NO_COST' || before?.status === 'COST_PENDING', before?.status);

    const service = app.get(FulfillmentService);
    const otherShopSeller = { allShops: false, accountIds: [], shopIds: ['00000000-0000-4000-8000-000000000000'] };
    const forbidden = await service
      .updateBaseCostManually(org, admin.id, order.id, { items: [{ itemId: record.items[0].id, baseCost: 1 }], currency: 'USD' }, otherShopSeller)
      .then(() => 'NO_ERROR')
      .catch((error: { response?: { code?: string } }) => error.response?.code ?? 'ERR');
    check('B2 người không được gán shop ⇒ 403, không ghi', forbidden === 'POD_SHOP_FORBIDDEN', forbidden);

    await service.updateBaseCostManually(
      org,
      admin.id,
      order.id,
      { items: [{ itemId: record.items[0].id, baseCost: 9.12 }], currency: 'USD', reason: 'E2E — hoá đơn thử' },
      { allShops: true, accountIds: [], shopIds: [] },
    );
    const stored = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: record.id }, include: { items: true, histories: true } });
    const history = stored.histories.find((entry) => entry.eventType === 'BASE_COST_MANUAL_UPDATED');
    check('B3 DB: giá 9.12 đã xác nhận + đơn vị tiền USD', Number(stored.items[0].baseCost) === 9.12 && stored.items[0].baseCostConfirmedAt !== null && stored.currency === 'USD', {
      baseCost: String(stored.items[0].baseCost),
      currency: stored.currency,
    });
    check('B4 nhật ký kiểm toán: người làm + giá cũ/mới + lý do', Boolean(history) && history?.performedBy === admin.id && JSON.stringify(history?.payload).includes('E2E — hoá đơn thử'), history?.message);
    const after = await financials();
    const expected = after?.proceeds ? Math.round((after.proceeds.amount - 9.12) * 10_000) / 10_000 : null;
    check('B5 Lợi nhuận tính lại ngay = tiền thu về − 9.12', after?.status === 'OK' && after.profit === expected, {
      status: after?.status,
      proceeds: after?.proceeds?.amount,
      profit: after?.profit,
      margin: after?.margin,
    });
    const dashAfter = await dashboardCost();
    check('B6 Basecost Dashboard tăng đúng 9.12', Math.abs(dashAfter - dashBefore - 9.12) < 0.0001, { dashBefore, dashAfter });

    // ------------------------------------------------------------- C. Đối soát
    // UNIQUE (pod_order_id, provider): bản ghi FAILED dùng nhà cung cấp KHÁC trên cùng đơn; bản ghi kẹt dùng đơn khác.
    const mangoAccount = await prisma.fulfillmentAccount.findFirstOrThrow({
      where: { organizationId: org, provider: FulfillmentProvider.MANGO, deletedAt: null },
    });
    const failedRecord = await prisma.fulfillmentOrder.create({
      data: {
        organizationId: org,
        accountId: mangoAccount.id,
        provider: FulfillmentProvider.MANGO,
        podOrderId: order.id,
        externalOrderId: `E2E-RC-${Date.now()}`,
        providerOrderId: `e2e-rc-${Date.now()}`,
        status: FulfillmentStatus.FAILED,
        submittedAt: new Date(),
      },
    });
    createdRecords.push(failedRecord.id);
    const otherOrder = await prisma.podOrder.findFirstOrThrow({
      where: { organizationId: org, deletedAt: null, fulfillmentOrders: { none: {} }, id: { not: order.id } },
      select: { id: true },
    });
    const stuckRecord = await prisma.fulfillmentOrder.create({
      data: {
        organizationId: org,
        accountId: account.id,
        provider: FulfillmentProvider.SELLERWIX,
        podOrderId: otherOrder.id,
        externalOrderId: `E2E-ST-${Date.now()}`,
        status: FulfillmentStatus.SUBMITTING,
      },
    });
    createdRecords.push(stuckRecord.id);
    await prisma.$executeRaw`UPDATE fulfillment_orders SET updated_at = now() - interval '10 minutes' WHERE id = ${stuckRecord.id}::uuid`;
    const toSync = await app.get(FulfillmentRepository).findOrdersToSync(5000, org);
    check('C1 FAILED nhưng đã có mã nhà cung cấp ⇒ nằm trong lượt đối soát', toSync.some((item) => item.id === failedRecord.id), failedRecord.id);
    {
      check('C2 SUBMITTING kẹt > 2 phút (chưa có mã) ⇒ nằm trong lượt đối soát', toSync.some((item) => item.id === stuckRecord.id), stuckRecord.id);
    }
    check('C3 bản ghi đã xác nhận giá (SHIPPED) vẫn được đồng bộ như cũ', toSync.some((item) => item.id === record.id), record.id);
  } finally {
    for (const id of createdRecords) {
      await prisma.fulfillmentHistory.deleteMany({ where: { fulfillmentOrderId: id } });
      await prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId: id } });
      await prisma.fulfillmentOrder.delete({ where: { id } });
    }
    if (restoreConfig) await restoreConfig();
    await app.close();
  }

  for (const [label, ok, detail] of results) console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  console.log('Đã dọn dữ liệu tạm + khôi phục cấu hình Auto.');
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
