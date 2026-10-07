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
  const config = { get: (key: string, fallback: unknown) => (key === 'timezoneOffsetMinutes' ? 420 : fallback) } as unknown as ConfigService;
  const repo = new PodDashboardRepository(prisma);
  const service = new PodDashboardService(repo, config);
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
  check('PF = Σ lợi nhuận từng đơn theo công thức màn Order (null khi không đơn nào tính được; đối chiếu từng đơn: e2e-employee-work P1)', sellers.items.every((r) => r.profit === null || Number.isFinite(r.profit)));
  const gmv = await one(Prisma.sql`SELECT COALESCE(SUM(total_amount),0)::float AS amt FROM pod_orders
    WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL AND currency=${overview.currency} AND status <> 'CANCELLED'
      AND ordered_at >= (${yearAgo}::date - interval '7 hours')`);
  check('Doanh thu (GMV) = Σ total_amount trừ đơn huỷ', near(sellers.items.reduce((s, r) => s + r.revenue, 0), Number(gmv.amt)), gmv);
  const est = await one(Prisma.sql`
    WITH o AS (SELECT tiktok_order_id FROM pod_orders WHERE organization_id=${orgId}::uuid AND deleted_at IS NULL
                 AND currency=${overview.currency} AND ordered_at >= (${yearAgo}::date - interval '7 hours'))
    SELECT COALESCE(SUM(COALESCE(
      (SELECT SUM(settlement_amount) FROM pod_tiktok_statement_transactions t WHERE t.organization_id=${orgId}::uuid AND t.deleted_at IS NULL AND t.type='ORDER' AND t.tiktok_order_id=o.tiktok_order_id),
      (SELECT SUM(est_settlement_amount) FROM pod_tiktok_unsettled_transactions u WHERE u.organization_id=${orgId}::uuid AND u.deleted_at IS NULL AND u.type='ORDER' AND u.tiktok_order_id=o.tiktok_order_id)
    )),0)::float AS amt FROM o`);
  check('Est. Revenue = Σ (settled ?? est_settlement) theo đơn', near(sellers.items.reduce((s, r) => s + r.estRevenue, 0), Number(est.amt)), est);
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
