/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP Return Orders trên DATABASE THẬT (PostgreSQL) — TikTok được GIẢ LẬP (không gọi
 * API thật, không cần token).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-pod-return.manual.ts
 *
 * Dùng một shop + một đơn THẬT đã có trong DB (đơn có giao dịch hoàn tiền trong statement) để chứng minh
 * câu SQL đọc đúng dữ liệu thật. Yêu cầu Return/Refund do script tạo mang `return_id` tiền tố `E2ERET`
 * và được XOÁ ở cuối (kèm sự kiện thông báo, trạng thái đồng bộ RETURN; watermark shop khôi phục).
 *
 * Kiểm:
 *   · INSERT thật qua đường đồng bộ (UNIQUE organization_id + tiktok_return_id) — chạy lại không trùng
 *   · outbox: đúng MỘT sự kiện RETURN_REFUND_REQUEST / yêu cầu (UNIQUE idempotency của notification_events)
 *   · danh sách / tổng quan / bộ lọc (raw SQL) + phạm vi shop của Seller
 *   · tiền quyết toán đọc từ revenue_breakdown thật, mỗi đơn MỘT lần dù nhiều yêu cầu
 *   · dashboard: returnStats + sellerStats.returns + profit KHÔNG đổi (không trừ refund lần hai)
 */
import { ConfigService } from '@nestjs/config';
import { PodSyncTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodShopSyncStatusRepository } from '../../src/modules/pod-tiktok/repositories/pod-shop-sync-status.repository';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodReturnRepository } from '../../src/modules/pod-return/repositories/pod-return.repository';
import { PodReturnSyncService } from '../../src/modules/pod-return/services/pod-return-sync.service';
import type { TiktokReturnOrder } from '../../src/modules/tiktok-sdk/types/tiktok-return-refund.types';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

const PREFIX = 'E2ERET';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  // Đơn THẬT có giao dịch hoàn tiền trong statement đã quyết toán.
  const [real] = await prisma.$queryRaw<Array<{ organization_id: string; shop_id: string; tiktok_order_id: string; currency: string }>>`
    SELECT t.organization_id, t.shop_id, t.tiktok_order_id, t.currency
      FROM pod_tiktok_statement_transactions t
      JOIN pod_orders po ON po.organization_id = t.organization_id AND po.tiktok_order_id = t.tiktok_order_id
     WHERE t.deleted_at IS NULL AND (t.revenue_breakdown->>'refund_subtotal_before_discount_amount')::numeric <> 0
     LIMIT 1`;
  if (!real) throw new Error('Không có đơn thật nào có giao dịch hoàn tiền — không chạy được kiểm thử này.');
  const shop = await prisma.podTiktokShop.findUniqueOrThrow({
    where: { id: real.shop_id },
    select: { id: true, organizationId: true, accountId: true, name: true, lastReturnSyncCursor: true },
  });
  const order = await prisma.podOrder.findFirstOrThrow({
    where: { organizationId: real.organization_id, tiktokOrderId: real.tiktok_order_id },
    select: { id: true, orderedAt: true, items: { select: { tiktokLineItemId: true, salePrice: true } } },
  });
  const hadReturnStatus = await prisma.podShopSyncStatus.count({ where: { shopId: shop.id, syncType: 'RETURN' } });
  const [expected] = await prisma.$queryRaw<Array<{ amount: Prisma.Decimal }>>`
    SELECT -SUM((revenue_breakdown->>'refund_subtotal_before_discount_amount')::numeric
              + (revenue_breakdown->>'seller_discount_refund_amount')::numeric) AS amount
      FROM pod_tiktok_statement_transactions
     WHERE organization_id = ${real.organization_id}::uuid AND tiktok_order_id = ${real.tiktok_order_id}
       AND deleted_at IS NULL AND revenue_breakdown IS NOT NULL`;
  console.log(`Đơn thật ${real.tiktok_order_id} · shop ${shop.name} · settled refund kỳ vọng ${expected.amount}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const line = order.items[0];
  const pages: TiktokReturnOrder[][] = [
    [
      {
        returnId: `${PREFIX}1`, orderId: real.tiktok_order_id, returnType: 'REFUND',
        returnStatus: 'RETURN_OR_REFUND_REQUEST_COMPLETE', returnReasonText: 'E2E reason', createTime: nowSec - 60, updateTime: nowSec - 30,
        refundAmount: { currency: real.currency, refundTotal: '28.99' },
        returnLineItems: [{ returnLineItemId: `${PREFIX}1-l1`, orderLineItemId: line?.tiktokLineItemId, productName: 'E2E', skuId: 'E2E-SKU' }],
      },
    ],
    [
      {
        // Yêu cầu THỨ HAI cùng đơn — tiền quyết toán vẫn chỉ tính MỘT lần.
        returnId: `${PREFIX}2`, orderId: real.tiktok_order_id, returnType: 'RETURN_AND_REFUND',
        returnStatus: 'RETURN_OR_REFUND_REQUEST_CANCEL', createTime: nowSec - 50, updateTime: nowSec - 20,
        refundAmount: { currency: real.currency, refundTotal: '28.99' },
        returnLineItems: [],
      },
    ],
  ];
  const api = {
    searchReturns: async (_ctx: unknown, params: { pageToken?: string }) => {
      const index = params.pageToken ? Number(params.pageToken) : 0;
      return { data: { items: pages[index] ?? [], nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined }, requestId: 'fake' };
    },
  };
  const notifications = {
    isEnabled: async () => true,
    enqueueInTransaction: async (tx: Prisma.TransactionClient, events: any[]) => {
      const result = await tx.notificationEvent.createMany({
        data: events.map((e) => ({ organizationId: e.organizationId, eventType: e.eventType, entityType: e.entityType, entityId: e.entityId, payload: e.payload })),
        skipDuplicates: true,
      });
      return result.count;
    },
    kick: () => undefined,
  };
  const locks = { acquire: async (key: string) => ({ key, token: 'x' }), release: async () => undefined, renew: async () => true };
  const config = new ConfigService({});
  const repo = new PodReturnRepository(prisma);
  const sync = new PodReturnSyncService(
    prisma, config, repo, api as any,
    { resolve: async () => ({ accessToken: 'x', shopCipher: 'y' }) } as any,
    new PodShopSyncStatusRepository(prisma), locks as any, notifications as any,
  );

  try {
    // Watermark có sẵn ⇒ lượt tăng dần (gửi thông báo).
    const target = { ...shop, lastReturnSyncCursor: BigInt(nowSec - 3600) };
    const first = await sync.syncShop(target, PodSyncTrigger.MANUAL, null);
    check('lượt 1: 2 yêu cầu được tạo qua 2 trang', first.created === 2 && first.fetched === 2 && first.status === 'SUCCESS', first);
    const second = await sync.syncShop(target, PodSyncTrigger.CRON, null);
    check('lượt 2 (chạy lại): không tạo trùng', second.created === 0 && second.unchanged === 2, second);
    const rows = await prisma.podReturnRequest.findMany({ where: { tiktokReturnId: { startsWith: PREFIX } }, include: { items: true } });
    check('DB: đúng 2 dòng, gắn đúng tổ chức / kết nối / shop / đơn POD', rows.length === 2 && rows.every((r) => r.organizationId === shop.organizationId && r.accountId === shop.accountId && r.shopId === shop.id && r.orderId === order.id));
    const r1 = rows.find((r) => r.tiktokReturnId === `${PREFIX}1`)!;
    check('Paid Amount = sale_price của đúng dòng', line?.salePrice ? r1.paidAmount?.equals(line.salePrice) === true : r1.paidAmount === null, { paid: r1.paidAmount, sale: line?.salePrice });
    const events = await prisma.notificationEvent.findMany({ where: { entityId: { in: rows.map((r) => r.id) } } });
    check('outbox: đúng MỘT sự kiện mỗi yêu cầu sau 2 lượt', events.length === 2 && events.every((e) => e.eventType === 'RETURN_REFUND_REQUEST'), events.length);

    const base = { dateField: 'requestedAt' as const, search: PREFIX };
    const page = await repo.findPage(shop.organizationId, base, { page: 1, limit: 10, sortBy: 'requestedAt', sortOrder: 'desc' });
    check('danh sách (raw SQL) trả 2 dòng, sắp mới nhất trước', page.total === 2 && page.items[0].tiktokReturnId === `${PREFIX}2`, page.total);
    const filtered = await repo.findPage(shop.organizationId, { ...base, statusGroup: 'COMPLETED' }, { page: 1, limit: 10, sortBy: 'refundTotal', sortOrder: 'asc' });
    check('lọc nhóm trạng thái COMPLETED ⇒ 1 dòng', filtered.total === 1);
    const otherSeller = await repo.findPage(shop.organizationId, { ...base, shopScope: ['00000000-0000-0000-0000-000000000000'] }, { page: 1, limit: 10, sortBy: 'requestedAt', sortOrder: 'desc' });
    check('Seller có phạm vi shop khác ⇒ 0 dòng', otherSeller.total === 0);
    const otherOrg = await repo.findPage('00000000-0000-0000-0000-000000000000', base, { page: 1, limit: 10, sortBy: 'requestedAt', sortOrder: 'desc' });
    check('tổ chức khác ⇒ 0 dòng', otherOrg.total === 0);

    const summary = await repo.summary(shop.organizationId, base);
    const usd = summary.amounts.find((a) => a.currency === real.currency)!;
    check('tổng quan: 1 đơn, 1 đơn đã hoàn', summary.orders === 1 && summary.refundedOrders === 1, summary);
    check('requested chỉ tính yêu cầu còn hiệu lực (yêu cầu huỷ không cộng)', usd.requested.equals(new Prisma.Decimal('28.99')), usd.requested);
    check('settled refund = giá trị thật trong revenue_breakdown, MỘT lần dù 2 yêu cầu', usd.settled.equals(expected.amount), { got: usd.settled, expected: expected.amount });
    const byOrder = await repo.settledRefundByOrder(shop.organizationId, [real.tiktok_order_id, real.tiktok_order_id]);
    check('settledRefundByOrder đúng', byOrder.get(real.tiktok_order_id)?.equals(expected.amount) === true);
    const options = await repo.filterOptions(shop.organizationId, undefined);
    check('filter-options có REFUND + RETURN_AND_REFUND', options.returnTypes.includes('REFUND') && options.returnTypes.includes('RETURN_AND_REFUND'));

    // Dashboard trên cùng đơn.
    const dash = new PodDashboardRepository(prisma);
    const filter = { organizationId: shop.organizationId, currency: real.currency, accountIds: null, shopId: shop.id };
    const day = order.orderedAt!;
    const window = { from: new Date(day.getTime() - 86_400_000), before: new Date(day.getTime() + 86_400_000) };
    check('returnsAvailable = true sau khi đồng bộ RETURN thành công', await dash.returnsAvailable(filter));
    const stats = await dash.returnStats(filter, window);
    check('returnStats: 2 yêu cầu, 1 đơn hoàn, settled đúng', stats.requests === 2 && stats.refundedOrders === 1 && stats.returnedOrders === 1 && new Prisma.Decimal(stats.settledRefund).equals(expected.amount), stats);
    const label = { amount: 0.5, currency: 'USD' };
    const sellers = await dash.sellerStats(filter, window, { activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 50, label });
    const totalReturns = sellers.items.reduce((sum, row) => sum + row.returns, 0);
    check('sellerStats.returns = 1 đơn (yêu cầu huỷ không tính)', totalReturns === 1, sellers.items.map((r) => r.returns));
    const profitBefore = sellers.items.map((r) => r.profit);
    await prisma.podReturnRequest.updateMany({ where: { tiktokReturnId: { startsWith: PREFIX } }, data: { deletedAt: new Date() } });
    const after = await dash.sellerStats(filter, window, { activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 50, label });
    check('profit KHÔNG phụ thuộc yêu cầu Return/Refund (không trừ hai lần)', JSON.stringify(after.items.map((r) => r.profit)) === JSON.stringify(profitBefore));
  } finally {
    const ids = (await prisma.podReturnRequest.findMany({ where: { tiktokReturnId: { startsWith: PREFIX } }, select: { id: true } })).map((r) => r.id);
    await prisma.notificationEvent.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.podReturnRequest.deleteMany({ where: { id: { in: ids } } });
    if (hadReturnStatus === 0) await prisma.podShopSyncStatus.deleteMany({ where: { shopId: shop.id, syncType: 'RETURN' } });
    await prisma.podTiktokShop.update({ where: { id: shop.id }, data: { lastReturnSyncCursor: shop.lastReturnSyncCursor } });
    const left = await prisma.podReturnRequest.count({ where: { tiktokReturnId: { startsWith: PREFIX } } });
    check('dọn dẹp: không còn dữ liệu kiểm thử', left === 0);
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
