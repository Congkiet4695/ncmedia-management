/**
 * Kiểm thử Dashboard trên DATABASE THẬT: chạy MỌI truy vấn của `PodDashboardRepository` và đối chiếu
 * với truy vấn độc lập, viết thẳng (không qua repository) — sai một công thức là lệch số.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-dashboard.manual.ts
 * Chỉ ĐỌC — không ghi gì vào DB. Phần phân quyền qua HTTP: xem e2e-dashboard-api (cần server chạy).
 */
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodDashboardService } from '../../src/modules/pod-tiktok/services/pod-dashboard.service';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500));
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

async function main() {
  const prisma = new PrismaService();
  const config = { get: (key: string, fallback: unknown) => (key === 'businessTimeZone' ? 'Asia/Ho_Chi_Minh' : fallback) } as unknown as ConfigService;
  const repo = new PodDashboardRepository(prisma);
  const service = new PodDashboardService(repo, config);
  const finance = new PodOrderFinanceService(prisma, config);
  const ALL = { allShops: true, accountIds: [], shopIds: [] };

  const org = await prisma.podOrder.groupBy({ by: ['organizationId'], _count: true, orderBy: { _count: { organizationId: 'desc' } } });
  const orgId = org[0]?.organizationId;
  if (!orgId) throw new Error('DB không có đơn POD nào');
  const one = async (sql: Prisma.Sql) => (await prisma.$queryRaw<Array<Record<string, unknown>>>(sql))[0];

  console.log('\n▶ Overview');
  const t0 = Date.now();
  const overview = await service.overview(orgId, ALL, {});
  console.log(`  (overview ${Date.now() - t0}ms)`, JSON.stringify(overview).slice(0, 300));
  const hold = await one(Prisma.sql`SELECT COALESCE(SUM(est_settlement_amount),0)::float AS amt, COUNT(DISTINCT shop_id)::int AS shops
    FROM pod_tiktok_unsettled_transactions WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL AND currency=${overview.currency}`);
  check('Hold = Σ unsettled est_settlement', near(overview.hold.amount, Number(hold.amt)), [overview.hold, hold]);
  check('Hold shop count', overview.hold.shopCount === Number(hold.shops));
  check('Hold theo seller cộng lại = tổng Hold', near(overview.holdBySeller.reduce((s, r) => s + r.amount, 0), overview.hold.amount));
  const shops = await one(Prisma.sql`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status='ACTIVE')::int AS live
    FROM pod_tiktok_shops WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL`);
  check('Shop: tổng / live', overview.shopStatus.total === shops.n && overview.shopStatus.live === shops.live, [overview.shopStatus, shops]);

  console.log('\n▶ Popup thẻ tổng quan');
  // Hold theo shop: đọc HẾT mọi trang ⇒ Σ = số trên thẻ, số shop = số trên thẻ, không shop nào lặp.
  const holdRows: Array<{ shopId: string; amount: number; shopName: string | null; accountName: string | null }> = [];
  for (let page = 1; ; page++) {
    const res = await service.holdShops(orgId, ALL, { page, limit: 7 });
    holdRows.push(...res.items);
    check(`Popup Hold trang ${page}: totalAmount = thẻ`, near(res.totalAmount, overview.hold.amount), [res.totalAmount, overview.hold.amount]);
    if (page >= res.meta.totalPages) break;
  }
  check('Popup Hold: số shop = số trên thẻ', holdRows.length === overview.hold.shopCount, [holdRows.length, overview.hold.shopCount]);
  check('Popup Hold: không shop nào lặp', new Set(holdRows.map((r) => r.shopId)).size === holdRows.length);
  check('Popup Hold: Σ từng shop = số trên thẻ (sai số làm tròn ≤ 0.005/shop)', Math.abs(holdRows.reduce((sum, r) => sum + r.amount, 0) - overview.hold.amount) <= 0.005 * holdRows.length + 0.011);
  check('Popup Hold: shop nào cũng có tên kết nối + tên shop', holdRows.every((r) => r.shopName && r.accountName));
  for (const [status, key] of [['ACTIVE', 'live'], ['INACTIVE', 'inactive'], ['DEAUTHORIZED', 'deauthorized']] as const) {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const res = await service.shopsByStatus(orgId, ALL, { status, page, limit: 10 });
      ids.push(...res.items.map((r) => r.shopId));
      if (page >= Math.max(1, res.meta.totalPages)) break;
    }
    const direct = await one(Prisma.sql`SELECT array_agg(id::text) AS ids FROM pod_tiktok_shops
      WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL AND status=${status}::"pod_tiktok_shop_status"`);
    const directIds = ((direct.ids as string[] | null) ?? []).sort();
    check(`Popup ${status}: số dòng = số trên thẻ (${overview.shopStatus[key]})`, ids.length === overview.shopStatus[key], [ids.length, overview.shopStatus[key]]);
    check(`Popup ${status}: đúng tập shop có trạng thái này, không lặp`, JSON.stringify([...ids].sort()) === JSON.stringify(directIds) && new Set(ids).size === ids.length);
  }
  const anyAccount = await prisma.podTiktokAccount.findFirst({ where: { organizationId: orgId, deletedAt: null, shops: { some: { deletedAt: null } } }, select: { id: true } });
  if (anyAccount) {
    const sellerScope = { allShops: false, accountIds: [anyAccount.id], shopIds: [] };
    const scoped = await service.shopsByStatus(orgId, sellerScope, { status: 'ACTIVE', limit: 100 });
    const allowed = new Set((await prisma.podTiktokShop.findMany({ where: { accountId: anyAccount.id }, select: { id: true } })).map((r) => r.id));
    check('Popup Live (Seller): chỉ shop thuộc account được gán', scoped.items.every((r) => allowed.has(r.shopId)));
    const scopedHold = await service.holdShops(orgId, sellerScope, { limit: 100 });
    check('Popup Hold (Seller): chỉ shop thuộc account được gán', scopedHold.items.every((r) => allowed.has(r.shopId)));
    const otherShop = await prisma.podTiktokShop.findFirst({ where: { organizationId: orgId, deletedAt: null, accountId: { not: anyAccount.id } }, select: { id: true } });
    if (otherShop) {
      const leak = await service.holdShops(orgId, sellerScope, { shopId: otherShop.id });
      const leak2 = await service.shopsByStatus(orgId, sellerScope, { status: 'ACTIVE', shopId: otherShop.id });
      check('🔴 Seller sửa shopId sang shop ngoài phạm vi ⇒ popup rỗng', leak.meta.total === 0 && leak2.meta.total === 0);
    }
  }
  const noneScope = { allShops: false, accountIds: [], shopIds: [] };
  check('Popup: người không được gán account nào ⇒ rỗng',
    (await service.holdShops(orgId, noneScope, {})).meta.total === 0 && (await service.shopsByStatus(orgId, noneScope, { status: 'ACTIVE' })).meta.total === 0);
  const month = await one(Prisma.sql`SELECT COUNT(*)::int AS n FROM pod_orders WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL
    AND currency=${overview.currency}
    AND ordered_at >= date_trunc('month', now() AT TIME ZONE 'UTC' + interval '7 hours') - interval '7 hours'`);
  check('Tháng này: số đơn (date_trunc độc lập, UTC+7)', overview.periods.thisMonth.orders === month.n, [overview.periods.thisMonth, month]);

  console.log('\n▶ Summary (tháng hiện tại)');
  const summary = await service.summary(orgId, ALL, {});
  console.log(' ', JSON.stringify(summary).slice(0, 400));
  check('Tổng đơn summary = Tháng này', summary.orders.total === overview.periods.thisMonth.orders);
  check('Σ nhóm trạng thái = tổng', summary.orders.groups.reduce((s, g) => s + g.count, 0) === summary.orders.total);
  check('Đơn hoàn: báo chưa có dữ liệu', summary.returnsAvailable === false);

  console.log('\n▶ Toàn bộ lịch sử (365 ngày)');
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() + 7 * 3600_000 - 365 * 86_400_000).toISOString().slice(0, 10);
  const range = { from: yearAgo, to: today };
  const s2 = await service.summary(orgId, ALL, range);
  const paidRef = await one(Prisma.sql`SELECT COALESCE(SUM(amount),0)::float AS amt FROM pod_tiktok_payments
    WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL AND status='PAID' AND currency=${overview.currency}
      AND COALESCE(paid_at, payment_created_at) >= (${yearAgo}::date - interval '7 hours')`);
  check('Đã thanh toán = Σ payments PAID', near(s2.finance.paid, Number(paidRef.amt)), [s2.finance, paidRef]);
  const procRef = await one(Prisma.sql`SELECT COALESCE(SUM(settlement_amount),0)::float AS amt FROM pod_tiktok_statements
    WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL AND "paymentStatus"='PROCESSING' AND currency=${overview.currency}
      AND statement_at >= (${yearAgo}::date - interval '7 hours')`);
  check('Đang xử lý = Σ statement PROCESSING', near(s2.finance.processing, Number(procRef.amt)), [s2.finance, procRef]);

  const sellers = await service.sellers(orgId, ALL, { ...range, sort: 'orders', order: 'desc', page: 1, limit: 100 });
  console.log(' ', JSON.stringify(sellers.items).slice(0, 400));
  check('Seller: Σ đơn = tổng đơn của kỳ', sellers.items.reduce((s, r) => s + r.orders, 0) === s2.orders.total, [sellers.items.map((r) => r.orders), s2.orders.total]);
  check('Seller: Σ đã thanh toán = tài chính', near(sellers.items.reduce((s, r) => s + r.paid, 0), s2.finance.paid));
  check('Seller: Σ on hold = Hold', near(sellers.items.reduce((s, r) => s + r.hold, 0), overview.hold.amount));
  // --- Bảng seller: đối chiếu TỪNG ĐƠN với màn Order (calculateOrderFinancials qua PodOrderFinanceService) ---
  const cur = String(overview.currency).toUpperCase();
  const windowOrders = await prisma.$queryRaw<Array<{ id: string; tiktok_order_id: string; seller_id: string | null; fulfilled: boolean }>>(Prisma.sql`
    SELECT po.id, po.tiktok_order_id, a.seller_id,
           EXISTS (SELECT 1 FROM fulfillment_orders f WHERE f.pod_order_id = po.id AND f.deleted_at IS NULL
                     AND f.organization_id = po.organization_id
                     AND f.status::text NOT IN ('DRAFT','FAILED','CANCELLED','REJECTED')) AS fulfilled
      FROM pod_orders po JOIN pod_tiktok_accounts a ON a.id = po.account_id
     WHERE po.organization_id=${orgId}::uuid AND po.deleted_at IS NULL AND po.currency=${overview.currency}
       AND po.ordered_at >= (${yearAgo}::date - interval '7 hours')`);
  const fin = await finance.summarize(orgId, windowOrders.map((o) => ({ id: o.id, tiktokOrderId: o.tiktok_order_id })));
  const label = finance.labelCost();
  type Expected = { revenue: number; revenueOrders: number; baseCost: number; baseCostOrders: number; fulfilled: number; profit: number | null; profitOrders: number };
  const expected = new Map<string | null, Expected>();
  let settledOrders = 0;
  let estimatedOrders = 0;
  for (const o of windowOrders) {
    const e = expected.get(o.seller_id) ?? { revenue: 0, revenueOrders: 0, baseCost: 0, baseCostOrders: 0, fulfilled: 0, profit: null, profitOrders: 0 };
    const f = fin.get(o.id);
    if (f?.proceeds && f.proceeds.currency.toUpperCase() === cur) {
      e.revenue += f.proceeds.amount;
      e.revenueOrders += 1;
      if (f.proceeds.source === 'SETTLED') settledOrders += 1;
      else estimatedOrders += 1;
      if (f.profit !== null) {
        e.profit = (e.profit ?? 0) + f.profit;
        e.profitOrders += 1;
      }
    }
    if (f && f.productCost !== null && f.productCostConfirmed && (f.costCurrency ?? '').toUpperCase() === cur) {
      e.baseCost += f.productCost;
      e.baseCostOrders += 1;
    }
    if (o.fulfilled) e.fulfilled += 1;
    expected.set(o.seller_id, e);
  }
  console.log(`  (${windowOrders.length} đơn: ${settledOrders} đã quyết toán, ${estimatedOrders} ước tính; label ${label.amount} ${label.currency})`);
  const mismatched = sellers.items.filter((r) => {
    const e = expected.get(r.sellerId) ?? { revenue: 0, revenueOrders: 0, baseCost: 0, baseCostOrders: 0, fulfilled: 0, profit: null, profitOrders: 0 };
    const labelExpected = label.currency.toUpperCase() === cur ? e.fulfilled * label.amount : null;
    return !(
      near(r.revenue, e.revenue) && r.revenueOrders === e.revenueOrders &&
      near(r.baseCost, e.baseCost) && r.baseCostOrders === e.baseCostOrders &&
      r.fulfilledOrders === e.fulfilled &&
      (labelExpected === null ? r.label === null : r.label !== null && near(r.label, labelExpected)) &&
      r.profitOrders === e.profitOrders &&
      // Est. profit (2026-10-14) tính trên các tổng của dòng, không trừ hai lần phí ship đã nằm trong Doanh thu.
      ((r.label === null ? null : r.revenue - r.baseCost - r.label - (r.shippingFee - r.shippingIncluded)) === null ? r.profit === null : r.profit !== null && near(r.profit, (r.label === null ? null : r.revenue - r.baseCost - r.label - (r.shippingFee - r.shippingIncluded))!))
    );
  });
  check('Doanh thu / Basecost / Label / Profit Dự kiến của MỌI seller = cộng từng đơn theo màn Order', mismatched.length === 0,
    mismatched.map((r) => ({ r, e: expected.get(r.sellerId) })));
  check('Doanh thu: mỗi đơn MỘT giá trị (settled ?? estimated) — số đơn có tiền thu về ≤ số đơn', sellers.items.every((r) => r.revenueOrders <= r.orders));
  const both = await one(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM pod_orders po
     WHERE po.organization_id=${orgId}::uuid AND po.deleted_at IS NULL AND po.currency=${overview.currency}
       AND po.ordered_at >= (${yearAgo}::date - interval '7 hours')
       AND EXISTS (SELECT 1 FROM pod_tiktok_statement_transactions t WHERE t.organization_id=po.organization_id AND t.deleted_at IS NULL AND t.type='ORDER' AND t.tiktok_order_id=po.tiktok_order_id)
       AND EXISTS (SELECT 1 FROM pod_tiktok_unsettled_transactions u WHERE u.organization_id=po.organization_id AND u.deleted_at IS NULL AND u.type='ORDER' AND u.tiktok_order_id=po.tiktok_order_id)`);
  console.log(`  (${Number(both.n)} đơn có CẢ giao dịch đã quyết toán lẫn chưa quyết toán — chỉ settled được cộng)`);
  check('Label = số đơn đã fulfill × label/đơn (mỗi đơn một lần dù nhiều dòng / nhiều lần gửi)',
    sellers.items.every((r) => r.label === null || near(r.label, r.fulfilledOrders * label.amount)));
  check('profitOrders (lợi nhuận từng đơn đủ dữ kiện — tham khảo) ≤ đơn đã fulfill', sellers.items.every((r) => r.profitOrders <= r.fulfilledOrders));
  check('API không còn cột "Doanh thu dự kiến"', sellers.items.every((r) => !('estRevenue' in r)));
  const sortedByName = await service.sellers(orgId, ALL, { ...range, sort: 'name', order: 'asc', page: 1, limit: 5 });
  check('Sắp xếp / phân trang chạy được', Array.isArray(sortedByName.items) && sortedByName.meta.limit === 5);
  const active = await service.sellers(orgId, ALL, { ...range, activeOnly: true, page: 1, limit: 20 });
  check('Lọc nhân viên đang hoạt động chạy được', active.items.every((r) => r.active));

  console.log('\n▶ Xu hướng');
  const t1 = Date.now();
  const trends = await service.trends(orgId, ALL, range);
  console.log(`  (trends ${Date.now() - t1}ms)`);
  const expectedDays = Math.round((Date.parse(today) - Date.parse(yearAgo)) / 86_400_000) + 1;
  check('Đủ MỌI ngày trong khoảng (ngày trống = 0)', trends.finance.length === expectedDays && trends.orders.length === expectedDays, [trends.finance.length, expectedDays]);
  check('Ngày liên tục, tăng dần', trends.orders.every((r, i) => i === 0 || Date.parse(r.day) - Date.parse(trends.orders[i - 1].day) === 86_400_000));
  check('Σ đơn theo ngày = tổng đơn kỳ', trends.orders.reduce((s, r) => s + r.total, 0) === s2.orders.total);
  check('Σ đã thanh toán theo ngày = tài chính', near(trends.finance.reduce((s, r) => s + r.paid, 0), s2.finance.paid));

  console.log('\n▶ Phạm vi');
  const none = await service.overview(orgId, { allShops: false, accountIds: [], shopIds: [] }, {});
  check('Người không được gán account nào ⇒ mọi số = 0', none.hold.amount === 0 && none.shopStatus.total === 0 && none.periods.thisMonth.orders === 0, none);
  const other = await service.overview('00000000-0000-0000-0000-000000000000', ALL, {});
  check('Tổ chức khác ⇒ không thấy dữ liệu', other.hold.amount === 0 && other.shopStatus.total === 0 && other.currencies.length === 0);
  const allOptions = await service.filterOptions(orgId, ALL);
  const noneOptions = await service.filterOptions(orgId, { allShops: false, accountIds: [], shopIds: [] });
  check('Bộ lọc: Admin thấy shop của tổ chức', allOptions.shops.length === Number(shops.n), allOptions);
  check('Bộ lọc: người không được gán account ⇒ không thấy shop / seller nào', noneOptions.shops.length === 0 && noneOptions.sellers.length === 0, noneOptions);
  const gbp = await service.summary(orgId, ALL, { ...range, currency: 'GBP' });
  check('Đơn vị tiền khác (GBP) ⇒ không trộn số USD', gbp.orders.total === 0 && gbp.finance.paid === 0);

  console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
