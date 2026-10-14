import { Prisma } from '@prisma/client';
import { PodDashboardRepository, type DashboardFilter, type SellerSortField } from './pod-dashboard.repository';

/**
 * Kiểm phần "hợp đồng" SQL của bảng Thống kê seller bằng mock (không có DB). Đối chiếu số thật từng đơn
 * (SQL == bản TS của màn Order) chạy CHỈ-ĐỌC trên PostgreSQL: `test/manual/verify-dashboard-seller-shipping.manual.ts`.
 */
describe('PodDashboardRepository.sellerStats — Shipping Fee / Current Profit', () => {
  const FILTER: DashboardFilter = { organizationId: 'org-1', currency: 'USD', accountIds: null };
  const WINDOW = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-14T23:59:59Z') };
  const OPTIONS = {
    activeOnly: false,
    sort: 'orders' as const,
    order: 'desc' as const,
    page: 1,
    limit: 20,
    label: { amount: 0.5, currency: 'USD' },
  };
  const ROW = {
    seller_id: 's1',
    seller_name: 'A',
    seller_email: 'a@x',
    active: true,
    orders: BigInt(3),
    revenue: new Prisma.Decimal('90'),
    revenue_orders: BigInt(3),
    base_cost: new Prisma.Decimal('30'),
    base_cost_orders: BigInt(3),
    shipping_fee: new Prisma.Decimal('7.25'),
    shipping_fee_orders: BigInt(2),
    shipping_included: new Prisma.Decimal('4.25'),
    fulfilled_orders: BigInt(3),
    label: new Prisma.Decimal('1.5'),
    profit: new Prisma.Decimal('51.25'),
    profit_orders: BigInt(2),
    current_profit: new Prisma.Decimal('21.25'),
    paid: new Prisma.Decimal('60'),
    processing: new Prisma.Decimal('0'),
    hold: new Prisma.Decimal('0'),
    returns: BigInt(0),
    total_rows: BigInt(1),
  };

  const run = async (sort: SellerSortField = 'orders') => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([ROW]) };
    const repo = new PodDashboardRepository(prisma as never);
    const result = await repo.sellerStats(FILTER, WINDOW, { ...OPTIONS, sort });
    const sql = (prisma.$queryRaw.mock.calls[0] as [Prisma.Sql])[0].sql.replace(/\s+/g, ' ');
    return { result, sql };
  };

  it('Shipping Fee = Σ phí ship Seller TỪNG ĐƠN từ order_profit (một dòng / đơn — không nhân theo order item)', async () => {
    const { sql } = await run();
    // order_profit có đúng MỘT dòng mỗi đơn (op_cost đã gộp item theo đơn) và được nối theo id đơn.
    expect(sql).toContain('LEFT JOIN order_profit op ON op.id = fin.id');
    expect(sql).toContain('SUM(op.seller_shipping) FILTER (WHERE op.proceeds_currency = UPPER(?');
    expect(sql).toContain('COUNT(op.seller_shipping) FILTER (WHERE op.proceeds_currency = UPPER(?');
    // Không cộng phí ship từ bảng item / fulfillment (nguồn nhân bản theo dòng).
    expect(sql).not.toMatch(/SUM\([^)]*fulfillment_order_items/);
  });

  it('order_profit trả seller_shipping từ CÙNG nhánh phí ship mà Profit Dự kiến dùng', async () => {
    const { sql } = await run();
    expect(sql).toContain('sh.amount AS seller_shipping');
    // Công thức Profit Dự kiến KHÔNG đổi: chỉ trừ phần phí ship CHƯA nằm trong tiền thu về.
    expect(sql).toContain('pr.amount - c.amount - CASE WHEN sh.included THEN 0 ELSE sh.amount END - ?');
  });

  it('current_profit (để sắp xếp) = Paid − Basecost − Label − Shipping Fee, NULL khi label khác đơn vị tiền', async () => {
    const { sql } = await run();
    expect(sql).toMatch(
      /CASE WHEN UPPER\(\?\) = UPPER\(\?\) THEN COALESCE\(pa\.amount, 0\) - COALESCE\(o\.base_cost, 0\) - COALESCE\(o\.fulfilled_orders, 0\) \* \?::numeric - COALESCE\(o\.shipping_fee, 0\) END AS current_profit/,
    );
  });

  it.each([
    ['shippingFee', 'ORDER BY shipping_fee DESC NULLS LAST'],
    ['currentProfit', 'ORDER BY current_profit DESC NULLS LAST'],
  ] as const)('sort=%s ⇒ %s', async (sort, orderBy) => {
    const { sql } = await run(sort);
    expect(sql).toContain(orderBy);
  });

  it('Est. profit (ORDER BY) = Doanh thu − Basecost − Label − (Shipping Fee − phần đã nằm trong Doanh thu)', async () => {
    const { sql } = await run('profit');
    // Phần phí ship ĐÃ nằm trong tiền thu về: cùng cờ `included` mà lợi nhuận từng đơn dùng.
    expect(sql).toContain('sh.included AS seller_shipping_included');
    expect(sql).toContain('SUM(op.seller_shipping) FILTER ( WHERE op.proceeds_currency = UPPER(?) AND op.seller_shipping_included), 0) AS shipping_included');
    expect(sql).toMatch(
      /CASE WHEN UPPER\(\?\) = UPPER\(\?\) THEN COALESCE\(o\.revenue, 0\) - COALESCE\(o\.base_cost, 0\) - COALESCE\(o\.fulfilled_orders, 0\) \* \?::numeric - \(COALESCE\(o\.shipping_fee, 0\) - COALESCE\(o\.shipping_included, 0\)\) END AS profit/,
    );
    // Không còn cộng lợi nhuận từng đơn (chỉ đơn đủ dữ kiện) làm Est. profit.
    expect(sql).not.toContain('SUM(op.profit)');
    expect(sql).toContain('ORDER BY profit DESC NULLS LAST');
  });

  it('ánh xạ dòng: Shipping Fee + độ phủ + phần đã nằm trong Doanh thu', async () => {
    const { result } = await run();
    expect(result.items[0]).toMatchObject({
      shippingFee: '7.25',
      shippingFeeOrders: 2,
      shippingIncluded: '4.25',
      profit: '51.25',
      profitOrders: 2,
      paid: '60',
      baseCost: '30',
      label: '1.5',
    });
    expect(result.total).toBe(1);
  });
});

describe('PodDashboardRepository — Seller Employee trong popup Hold / Trạng thái shop', () => {
  const FILTER: DashboardFilter = { organizationId: 'org-1', currency: 'USD', accountIds: null };
  const repoWith = (rows: unknown[]) => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
    return { repo: new PodDashboardRepository(prisma as never), prisma };
  };
  const sqlOf = (prisma: { $queryRaw: jest.Mock }) =>
    (prisma.$queryRaw.mock.calls[0] as [Prisma.Sql])[0].sql.replace(/\s+/g, ' ');
  const SELLER_JOIN = 'LEFT JOIN employees se ON se.id = a.seller_id LEFT JOIN users su ON su.id = se.user_id';

  it('Hold theo shop: lấy Seller Employee qua TikTok Account của shop (seller_id), cùng MỘT truy vấn (không N+1)', async () => {
    const { repo, prisma } = repoWith([
      { shop_id: 's1', shop_name: 'A', account_name: 'Acc', amount: new Prisma.Decimal('5'), seller_id: 'e1', seller_name: 'Trang', seller_email: 't@x', total_rows: BigInt(2), total_amount: new Prisma.Decimal('7') },
      { shop_id: 's2', shop_name: 'B', account_name: 'Acc', amount: new Prisma.Decimal('2'), seller_id: null, seller_name: null, seller_email: null, total_rows: BigInt(2), total_amount: new Prisma.Decimal('7') },
    ]);
    const result = await repo.holdShops(FILTER, { page: 1, limit: 20 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(prisma);
    expect(sql).toContain(SELLER_JOIN);
    expect(sql).toContain("COALESCE(NULLIF(su.full_name, ''), su.email) AS seller_name");
    // Không dùng seller_name của TikTok (pod_tiktok_accounts.seller_name) làm Seller Employee.
    expect(sql).not.toContain('a.seller_name');
    expect(result.items).toEqual([
      expect.objectContaining({ shopId: 's1', sellerId: 'e1', sellerName: 'Trang', sellerEmail: 't@x' }),
      expect.objectContaining({ shopId: 's2', sellerId: null, sellerName: null, sellerEmail: null }),
    ]);
    // Phân trang / tổng giữ nguyên.
    expect(result).toMatchObject({ total: 2, totalAmount: '7' });
  });

  it('Trạng thái shop: cùng quy tắc Seller Employee, không đổi điều kiện Live / Die', async () => {
    const { repo, prisma } = repoWith([
      { id: 's9', name: 'Die', account_name: 'Acc', region: 'US', seller_id: 'e2', seller_name: 'b@x', seller_email: 'b@x', total_rows: BigInt(1) },
    ]);
    const result = await repo.shopsByStatus(FILTER, 'INACTIVE', { page: 1, limit: 20 });
    const sql = sqlOf(prisma);
    expect(sql).toContain(SELLER_JOIN);
    expect(sql).toContain('AND s.status = ?::"pod_tiktok_shop_status"');
    expect(result).toEqual({
      items: [{ shopId: 's9', shopName: 'Die', accountName: 'Acc', region: 'US', sellerId: 'e2', sellerName: 'b@x', sellerEmail: 'b@x' }],
      total: 1,
    });
  });
});

describe('PodDashboardRepository.earliestActivityDay — mốc đầu của "Tất cả thời gian"', () => {
  it('MIN trên cả ba mốc (đơn / payout / statement), trong phạm vi, KHÔNG lọc đơn vị tiền', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ day: '2025-01-23' }]) };
    const repo = new PodDashboardRepository(prisma as never);
    const day = await repo.earliestActivityDay({ organizationId: 'org-1', currency: 'USD', accountIds: ['acc-1'] }, 420);
    expect(day).toBe('2025-01-23');
    const query = (prisma.$queryRaw.mock.calls[0] as [Prisma.Sql])[0];
    const sql = query.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('SELECT MIN(po.ordered_at) FROM pod_orders po');
    expect(sql).toContain('SELECT MIN(COALESCE(p.paid_at, p.payment_created_at)) FROM pod_tiktok_payments p');
    expect(sql).toContain('SELECT MIN(st.statement_at) FROM pod_tiktok_statements st');
    expect(sql).toContain('po.account_id IN (?::uuid)');
    expect(sql).not.toMatch(/\.currency = /);
  });

  it('chưa có dữ liệu ⇒ null', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ day: null }]) };
    const repo = new PodDashboardRepository(prisma as never);
    expect(await repo.earliestActivityDay({ organizationId: 'org-1', currency: 'USD', accountIds: null }, 420)).toBeNull();
  });
});
