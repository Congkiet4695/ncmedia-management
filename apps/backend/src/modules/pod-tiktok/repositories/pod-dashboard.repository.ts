import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { LabelCostConfig } from '../shared/order-financials';
import { orderProfitCtes } from '../shared/order-profit.sql';
import { settledRefundAmountSql } from '../shared/settled-refund.sql';
import { ORDER_STATUS_GROUPS, type OrderStatusGroup } from '../shared/order-status-groups';

/** Phạm vi + bộ lọc dùng chung cho MỌI truy vấn dashboard. */
export interface DashboardFilter {
  organizationId: string;
  /** Mọi số tiền chỉ cộng trong MỘT đơn vị tiền — không trộn USD/GBP, không tự quy đổi. */
  currency: string;
  /** `null` = toàn tổ chức (Admin). Mảng = CHỈ các TikTok Account này (Seller) — rỗng ⇒ không có gì. */
  accountIds: string[] | null;
  shopId?: string;
  /** Employee id của seller phụ trách TikTok Account. */
  sellerId?: string;
}

export interface Window {
  from: Date;
  to: Date;
}

/** Cột của bảng Thống kê seller được phép sắp xếp (whitelist — chống SQL injection qua ORDER BY). */
export const SELLER_SORT_FIELDS = [
  'name',
  'orders',
  'revenue',
  'baseCost',
  'label',
  'profit',
  'paid',
  'processing',
  'hold',
] as const;
export type SellerSortField = (typeof SELLER_SORT_FIELDS)[number];

export interface HoldTotalRow {
  currency: string;
  amount: string;
  shopCount: number;
}
export interface HoldBySellerRow {
  sellerId: string | null;
  sellerName: string | null;
  shopCount: number;
  amount: string;
}
export interface ShopStatusRow {
  status: string;
  count: number;
}
/** Một shop trong popup Hold — CÙNG nguồn / phạm vi với `holdTotals` (một đơn vị tiền). */
export interface HoldShopRow {
  shopId: string;
  shopName: string | null;
  accountName: string | null;
  amount: string;
}
/** Một shop trong popup Trạng thái shop — CÙNG điều kiện với `shopStatuses`. */
export interface ShopListRow {
  shopId: string;
  shopName: string;
  accountName: string | null;
  region: string | null;
}
/** Trạng thái shop thật (`pod_tiktok_shops.status`) — Live = ACTIVE, Die = INACTIVE. */
export const SHOP_STATUSES = ['ACTIVE', 'INACTIVE', 'DEAUTHORIZED'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];
export interface PeriodRow {
  orders: number;
  estRevenue: string;
  payout: string;
}
export interface OrderGroupRow {
  group: OrderStatusGroup;
  count: number;
  amount: string;
}
export interface SellerStatRow {
  sellerId: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
  active: boolean;
  orders: number;
  /** Σ tiền thu về từng đơn: đã quyết toán ?? ước tính (mỗi đơn MỘT giá trị). */
  revenue: string;
  /** Số đơn có tiền thu về (phần còn lại chưa có dữ liệu tài chính — không coi là 0). */
  revenueOrders: number;
  /** Σ giá vốn đã xác nhận của lần fulfill đang giữ đơn. */
  baseCost: string;
  baseCostOrders: number;
  /** Số đơn đã fulfill (có lần fulfill đang giữ đơn) — mỗi đơn MỘT label. */
  fulfilledOrders: number;
  /** Σ label = số đơn đã fulfill × label/đơn; NULL khi label khác đơn vị tiền đang xem. */
  label: string | null;
  /** NULL = không đơn nào của seller tính được lợi nhuận. */
  profit: string | null;
  /** Số đơn tính được lợi nhuận (đủ dữ kiện). */
  profitOrders: number;
  paid: string;
  processing: string;
  hold: string;
  /** Số đơn (trong khoảng) có yêu cầu Return/Refund còn hiệu lực (không huỷ / không bị từ chối). */
  returns: number;
}
/** Chỉ số Return/Refund của các đơn trong khoảng. */
export interface ReturnStatsRow {
  requests: number;
  returnedOrders: number;
  refundedOrders: number;
  /** Doanh thu bị TikTok trừ lại do hoàn tiền (statement đã quyết toán) — xem `settledRefundAmountSql`. */
  settledRefund: string;
}
export interface FinanceTrendRow {
  day: string;
  paid: string;
  processing: string;
}
export interface OrderTrendRow {
  day: string;
  total: number;
  delivered: number;
  inProgress: number;
  cancelled: number;
}

const ZERO = new Prisma.Decimal(0);
const dec = (value: Prisma.Decimal | string | number | null | undefined): string =>
  value === null || value === undefined ? ZERO.toString() : new Prisma.Decimal(value).toString();

/**
 * PodDashboardRepository — số liệu Dashboard, TOÀN BỘ tổng hợp bằng SQL (GROUP BY / SUM / FILTER /
 * generate_series) tại PostgreSQL. Không kéo đơn về Node rồi cộng, không N+1 theo seller / shop:
 * mỗi widget là MỘT truy vấn.
 *
 * Nguồn số liệu (quyết định PO 2026-10-01, docs/dashboard/README.md):
 *   Hold         = Σ est_settlement_amount — pod_tiktok_unsettled_transactions (TikTok chưa quyết toán)
 *   Đã thanh toán = Σ amount — pod_tiktok_payments status PAID, theo ngày chi (paid_at ?? payment_created_at)
 *   Đang xử lý    = Σ settlement_amount — pod_tiktok_statements payment PROCESSING (đã quyết toán, chưa chi)
 *   Est. Revenue  = tiền thu về của đơn: settlement (giao dịch ORDER đã quyết toán) ?? est_settlement
 *                   (chưa quyết toán) — cùng quy tắc với cột Giá (`order-financials.ts`)
 *   Bảng seller — MỌI cột tiền theo đơn lấy từ `orderProfitCtes` (CÙNG nguồn với màn Order):
 *     Doanh thu      = Σ tiền thu về từng đơn (đã quyết toán ?? ước tính — mỗi đơn MỘT giá trị)
 *     Basecost       = Σ giá vốn đã xác nhận của lần fulfill đang giữ đơn (lần gửi lại thay lần cũ)
 *     Label          = số đơn đã fulfill × label/đơn (cấu hình ORDER_LABEL_COST — label không lưu theo đơn)
 *     Profit Dự kiến = Σ lợi nhuận TỪNG ĐƠN: tiền thu về − giá vốn − label − phí ship Seller CHƯA nằm trong
 *                      tiền thu về. Đơn thiếu dữ kiện không cộng (không coi là 0); không đơn nào ⇒ NULL ("—").
 *
 * 🔴 Phạm vi tổ chức + phạm vi Seller nằm trong MỌI câu WHERE (`scope()`), không lọc ở frontend.
 */
@Injectable()
export class PodDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Tổng quan (không theo khoảng ngày)
  // ---------------------------------------------------------------------------

  /** Tổng Hold theo từng đơn vị tiền + số shop có khoản hold. */
  async holdTotals(filter: DashboardFilter): Promise<HoldTotalRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ currency: string; amount: Prisma.Decimal | null; shop_count: bigint }>
    >(Prisma.sql`
      SELECT u.currency,
             COALESCE(SUM(u.est_settlement_amount), 0) AS amount,
             COUNT(DISTINCT u.shop_id)::bigint          AS shop_count
        FROM pod_tiktok_unsettled_transactions u
       WHERE u.organization_id = ${filter.organizationId}::uuid
         AND u.deleted_at IS NULL
         AND ${this.scope(filter, 'u', { currency: false })}
       GROUP BY u.currency
       ORDER BY amount DESC`);
    return rows.map((row) => ({
      currency: row.currency,
      amount: dec(row.amount),
      shopCount: Number(row.shop_count),
    }));
  }

  /** Hold theo seller (Employee phụ trách TikTok Account) — đủ mọi seller có hold, giảm dần. */
  async holdBySeller(filter: DashboardFilter): Promise<HoldBySellerRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ seller_id: string | null; seller_name: string | null; shop_count: bigint; amount: Prisma.Decimal | null }>
    >(Prisma.sql`
      SELECT a.seller_id,
             MIN(COALESCE(NULLIF(us.full_name, ''), us.email)) AS seller_name,
             COUNT(DISTINCT u.shop_id)::bigint                 AS shop_count,
             COALESCE(SUM(u.est_settlement_amount), 0)         AS amount
        FROM pod_tiktok_unsettled_transactions u
        JOIN pod_tiktok_accounts a ON a.id = u.account_id
        LEFT JOIN employees e ON e.id = a.seller_id
        LEFT JOIN users us ON us.id = e.user_id
       WHERE u.organization_id = ${filter.organizationId}::uuid
         AND u.deleted_at IS NULL
         AND ${this.scope(filter, 'u')}
       GROUP BY a.seller_id
      HAVING COALESCE(SUM(u.est_settlement_amount), 0) <> 0
       ORDER BY amount DESC, seller_name ASC NULLS LAST`);
    return rows.map((row) => ({
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      shopCount: Number(row.shop_count),
      amount: dec(row.amount),
    }));
  }

  /**
   * Popup "Tổng tiền đang hold": Hold theo TỪNG shop — CÙNG nguồn (`pod_tiktok_unsettled_transactions`),
   * CÙNG phạm vi và CÙNG đơn vị tiền với `holdTotals` ⇒ Σ các dòng = số trên thẻ, số dòng = số shop trên thẻ.
   * Gộp theo `shop_id` TRƯỚC khi nối tên ⇒ một shop một dòng dù có nhiều giao dịch.
   */
  async holdShops(
    filter: DashboardFilter,
    page: { page: number; limit: number },
  ): Promise<{ items: HoldShopRow[]; total: number; totalAmount: string }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        shop_id: string;
        shop_name: string | null;
        account_name: string | null;
        amount: Prisma.Decimal | null;
        total_rows: bigint;
        total_amount: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      WITH h AS (
        SELECT u.shop_id, COALESCE(SUM(u.est_settlement_amount), 0) AS amount
          FROM pod_tiktok_unsettled_transactions u
         WHERE u.organization_id = ${filter.organizationId}::uuid
           AND u.deleted_at IS NULL
           AND ${this.scope(filter, 'u')}
         GROUP BY u.shop_id
      )
      SELECT h.shop_id, s.name AS shop_name, a.account_name, h.amount,
             COUNT(*) OVER ()::bigint AS total_rows,
             SUM(h.amount) OVER ()    AS total_amount
        FROM h
        LEFT JOIN pod_tiktok_shops s    ON s.id = h.shop_id AND s.organization_id = ${filter.organizationId}::uuid
        LEFT JOIN pod_tiktok_accounts a ON a.id = s.account_id
       ORDER BY h.amount DESC, s.name ASC NULLS LAST, h.shop_id
       LIMIT ${page.limit} OFFSET ${(page.page - 1) * page.limit}`);
    return {
      items: rows.map((row) => ({
        shopId: row.shop_id,
        shopName: row.shop_name,
        accountName: row.account_name,
        amount: dec(row.amount),
      })),
      total: Number(rows[0]?.total_rows ?? 0),
      totalAmount: dec(rows[0]?.total_amount),
    };
  }

  /** Số shop theo trạng thái thật (`pod_tiktok_shops.status`). */
  async shopStatuses(filter: DashboardFilter): Promise<ShopStatusRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
      SELECT s.status::text AS status, COUNT(*)::bigint AS count
        FROM pod_tiktok_shops s
       WHERE ${this.shopConds(filter)}
       GROUP BY s.status`);
    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  /**
   * Popup "Trạng thái shop": các shop của MỘT trạng thái — CÙNG điều kiện `shopConds` với `shopStatuses`
   * ⇒ số dòng = số trên thẻ. Mỗi dòng `pod_tiktok_shops` là một shop (UNIQUE tổ chức + tiktok_shop_id).
   */
  async shopsByStatus(
    filter: DashboardFilter,
    status: ShopStatus,
    page: { page: number; limit: number },
  ): Promise<{ items: ShopListRow[]; total: number }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; account_name: string | null; region: string | null; total_rows: bigint }>
    >(Prisma.sql`
      SELECT s.id, s.name, a.account_name, s.region, COUNT(*) OVER ()::bigint AS total_rows
        FROM pod_tiktok_shops s
        LEFT JOIN pod_tiktok_accounts a ON a.id = s.account_id
       WHERE ${this.shopConds(filter)}
         AND s.status = ${status}::"pod_tiktok_shop_status"
       ORDER BY a.account_name ASC NULLS LAST, s.name ASC, s.id
       LIMIT ${page.limit} OFFSET ${(page.page - 1) * page.limit}`);
    return {
      items: rows.map((row) => ({
        shopId: row.id,
        shopName: row.name,
        accountName: row.account_name,
        region: row.region,
      })),
      total: Number(rows[0]?.total_rows ?? 0),
    };
  }

  /** Đơn vị tiền xuất hiện trong dữ liệu của tổ chức (đơn + tài chính) — nguồn bộ chọn Currency. */
  async currencies(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ currency: string; n: bigint }>>(Prisma.sql`
      SELECT currency, SUM(n)::bigint AS n FROM (
        SELECT currency, COUNT(*) AS n FROM pod_orders
         WHERE organization_id = ${organizationId}::uuid AND deleted_at IS NULL AND currency IS NOT NULL
         GROUP BY currency
        UNION ALL
        SELECT currency, COUNT(*) FROM pod_tiktok_payments
         WHERE organization_id = ${organizationId}::uuid AND deleted_at IS NULL GROUP BY currency
        UNION ALL
        SELECT currency, COUNT(*) FROM pod_tiktok_unsettled_transactions
         WHERE organization_id = ${organizationId}::uuid AND deleted_at IS NULL GROUP BY currency
      ) x
      GROUP BY currency
      ORDER BY n DESC, currency ASC`);
    return rows.map((row) => row.currency);
  }

  /** Shop + seller cho bộ lọc — CHỈ trong phạm vi người xem (Seller không thấy shop / seller khác). */
  async filterOptions(
    organizationId: string,
    accountIds: string[] | null,
  ): Promise<{
    shops: Array<{ id: string; name: string; region: string | null }>;
    sellers: Array<{ id: string; name: string }>;
  }> {
    const accountCond = accountIds ? this.inAccounts('s.account_id', accountIds) : Prisma.sql`TRUE`;
    const shops = await this.prisma.$queryRaw<Array<{ id: string; name: string; region: string | null }>>(Prisma.sql`
      SELECT s.id, s.name, s.region FROM pod_tiktok_shops s
       WHERE s.organization_id = ${organizationId}::uuid AND s.deleted_at IS NULL AND ${accountCond}
       ORDER BY s.name ASC`);
    const sellers = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
      SELECT DISTINCT e.id, COALESCE(NULLIF(us.full_name, ''), us.email) AS name
        FROM pod_tiktok_shops s
        JOIN pod_tiktok_accounts a ON a.id = s.account_id AND a.deleted_at IS NULL
        JOIN employees e ON e.id = a.seller_id AND e.deleted_at IS NULL
        JOIN users us ON us.id = e.user_id
       WHERE s.organization_id = ${organizationId}::uuid AND s.deleted_at IS NULL AND ${accountCond}
       ORDER BY name ASC`);
    return { shops, sellers };
  }

  // ---------------------------------------------------------------------------
  // Theo khoảng thời gian
  // ---------------------------------------------------------------------------

  /** Số đơn + Est. Revenue + Payout cho NHIỀU kỳ trong MỘT truy vấn (FILTER theo từng kỳ). */
  async periods(filter: DashboardFilter, windows: Window[]): Promise<PeriodRow[]> {
    const outer: Window = {
      from: new Date(Math.min(...windows.map((w) => w.from.getTime()))),
      to: new Date(Math.max(...windows.map((w) => w.to.getTime()))),
    };
    const orderCols = windows.map(
      (w, i) => Prisma.sql`
        COUNT(*) FILTER (WHERE fin.ordered_at BETWEEN ${w.from} AND ${w.to})::bigint AS ${Prisma.raw(`orders_${i}`)},
        COALESCE(SUM(fin.proceeds) FILTER (WHERE fin.ordered_at BETWEEN ${w.from} AND ${w.to}), 0) AS ${Prisma.raw(`est_${i}`)}`,
    );
    const payoutCols = windows.map(
      (w, i) => Prisma.sql`
        COALESCE(SUM(p.amount) FILTER (WHERE COALESCE(p.paid_at, p.payment_created_at) BETWEEN ${w.from} AND ${w.to}), 0)
          AS ${Prisma.raw(`payout_${i}`)}`,
    );
    const [orderRow] = await this.prisma.$queryRaw<Array<Record<string, Prisma.Decimal | bigint | null>>>(Prisma.sql`
      WITH ${this.orderFinanceCte(filter, outer)}
      SELECT ${Prisma.join(orderCols, ', ')} FROM fin`);
    const [payoutRow] = await this.prisma.$queryRaw<Array<Record<string, Prisma.Decimal | null>>>(Prisma.sql`
      SELECT ${Prisma.join(payoutCols, ', ')}
        FROM pod_tiktok_payments p
       WHERE ${this.paidPaymentsWhere(filter, outer)}`);
    return windows.map((_, i) => ({
      orders: Number(orderRow?.[`orders_${i}`] ?? 0),
      estRevenue: dec(orderRow?.[`est_${i}`] as Prisma.Decimal | null),
      payout: dec(payoutRow?.[`payout_${i}`]),
    }));
  }

  /** Đã thanh toán + Đang xử lý trong khoảng. */
  async finance(filter: DashboardFilter, window: Window): Promise<{ paid: string; processing: string }> {
    const [paid] = await this.prisma.$queryRaw<Array<{ amount: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(p.amount), 0) AS amount
        FROM pod_tiktok_payments p
       WHERE ${this.paidPaymentsWhere(filter, window)}`);
    const [processing] = await this.prisma.$queryRaw<Array<{ amount: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(st.settlement_amount), 0) AS amount
        FROM pod_tiktok_statements st
       WHERE ${this.processingStatementsWhere(filter, window)}`);
    return { paid: dec(paid?.amount), processing: dec(processing?.amount) };
  }

  /**
   * Đã có dữ liệu Return/Refund cho phạm vi chưa: ít nhất một shop trong phạm vi đã đồng bộ RETURN
   * thành công. Chưa ⇒ giao diện giữ "chưa có dữ liệu" thay vì hiện 0 gây hiểu nhầm.
   */
  async returnsAvailable(filter: DashboardFilter): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM pod_shop_sync_statuses ss
         WHERE ss.organization_id = ${filter.organizationId}::uuid
           AND ss.sync_type = 'RETURN'::"pod_shop_sync_type"
           AND ss.status IN ('SUCCESS'::"pod_sync_status", 'PARTIAL'::"pod_sync_status")
           AND ${this.scope(filter, 'ss', { currency: false })}
      ) AS ok`);
    return row?.ok === true;
  }

  /**
   * Return/Refund của các ĐƠN trong khoảng (cùng tập đơn với nhóm trạng thái):
   *  - requests       : số YÊU CẦU (một đơn có thể có nhiều yêu cầu);
   *  - returnedOrders : số đơn có yêu cầu còn hiệu lực (không CANCELLED / REJECTED);
   *  - refundedOrders : số đơn TikTok xác nhận đã hoàn tiền (`refund_completed`);
   *  - settledRefund  : doanh thu bị trừ lại trong statement đã quyết toán, cùng đơn vị tiền tệ.
   * 🔴 Không cộng refund_total của yêu cầu vào tiền: yêu cầu ≠ giao dịch hoàn tiền.
   */
  async returnStats(filter: DashboardFilter, window: Window): Promise<ReturnStatsRow> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ requests: bigint; returned: bigint; refunded: bigint; settled: Prisma.Decimal | null }>
    >(Prisma.sql`
      WITH o AS (
        SELECT po.tiktok_order_id FROM pod_orders po WHERE ${this.ordersWhere(filter, window)}
      ),
      r AS (
        SELECT rr.tiktok_order_id, rr.status_group, rr.refund_completed
          FROM pod_return_requests rr JOIN o ON o.tiktok_order_id = rr.tiktok_order_id
         WHERE rr.organization_id = ${filter.organizationId}::uuid AND rr.deleted_at IS NULL
      )
      SELECT (SELECT COUNT(*) FROM r)::bigint AS requests,
             (SELECT COUNT(DISTINCT tiktok_order_id) FROM r
               WHERE status_group NOT IN ('CANCELLED'::"pod_return_status_group", 'REJECTED'::"pod_return_status_group"))::bigint AS returned,
             (SELECT COUNT(DISTINCT tiktok_order_id) FROM r WHERE refund_completed)::bigint AS refunded,
             (SELECT SUM(${settledRefundAmountSql('t')})
                FROM pod_tiktok_statement_transactions t JOIN o ON o.tiktok_order_id = t.tiktok_order_id
               WHERE t.organization_id = ${filter.organizationId}::uuid AND t.deleted_at IS NULL
                 AND t.revenue_breakdown IS NOT NULL AND t.currency = ${filter.currency}) AS settled`);
    return {
      requests: Number(row?.requests ?? 0),
      returnedOrders: Number(row?.returned ?? 0),
      refundedOrders: Number(row?.refunded ?? 0),
      settledRefund: dec(row?.settled),
    };
  }

  /** Số đơn + tổng tiền theo nhóm trạng thái trong khoảng. */
  async orderGroups(filter: DashboardFilter, window: Window): Promise<OrderGroupRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ grp: OrderStatusGroup; count: bigint; amount: Prisma.Decimal | null }>
    >(Prisma.sql`
      SELECT ${this.statusGroup('po.status')} AS grp,
             COUNT(*)::bigint                      AS count,
             COALESCE(SUM(po.total_amount), 0)     AS amount
        FROM pod_orders po
       WHERE ${this.ordersWhere(filter, window)}
       GROUP BY grp`);
    return rows.map((row) => ({ group: row.grp, count: Number(row.count), amount: dec(row.amount) }));
  }

  /**
   * Bảng Thống kê seller — MỘT truy vấn: seller = Employee được gán làm seller của ít nhất một TikTok
   * Account (`pod_tiktok_accounts.seller_id`), cộng nhóm "chưa gán seller" (chỉ khi xem toàn tổ chức).
   */
  async sellerStats(
    filter: DashboardFilter,
    window: Window,
    options: {
      activeOnly: boolean;
      search?: string;
      sort: SellerSortField;
      order: 'asc' | 'desc';
      page: number;
      limit: number;
      /** Chi phí label mỗi đơn — cùng nguồn với màn Order. */
      label: LabelCostConfig;
    },
  ): Promise<{ items: SellerStatRow[]; total: number }> {
    const sellerConds: Prisma.Sql[] = [
      Prisma.sql`e.organization_id = ${filter.organizationId}::uuid`,
      Prisma.sql`e.deleted_at IS NULL`,
      Prisma.sql`EXISTS (SELECT 1 FROM pod_tiktok_accounts sa
                          WHERE sa.seller_id = e.id AND sa.deleted_at IS NULL
                            AND sa.organization_id = ${filter.organizationId}::uuid
                            ${filter.accountIds ? Prisma.sql`AND ${this.inAccounts('sa.id', filter.accountIds)}` : Prisma.empty})`,
    ];
    if (options.activeOnly) {
      sellerConds.push(Prisma.sql`e.status = 'ACTIVE'::"employee_status" AND us.status = 'ACTIVE'::"user_status"`);
    }
    if (filter.sellerId) sellerConds.push(Prisma.sql`e.id = ${filter.sellerId}::uuid`);
    if (options.search) {
      const pattern = `%${options.search}%`;
      sellerConds.push(Prisma.sql`(us.full_name ILIKE ${pattern} OR us.email ILIKE ${pattern})`);
    }
    // Nhóm "chưa gán seller" chỉ có nghĩa khi xem TOÀN tổ chức và không lọc theo seller / tìm kiếm.
    const includeUnassigned = !filter.accountIds && !filter.sellerId && !options.search;
    const cur = Prisma.sql`UPPER(${filter.currency})`;
    // Label chỉ cộng được trong CÙNG đơn vị tiền (không quy đổi) — khác ⇒ NULL, như lợi nhuận từng đơn.
    const labelSameCurrency = Prisma.sql`UPPER(${options.label.currency}) = ${cur}`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        seller_id: string | null;
        seller_name: string | null;
        seller_email: string | null;
        active: boolean;
        orders: bigint;
        revenue: Prisma.Decimal;
        revenue_orders: bigint;
        base_cost: Prisma.Decimal;
        base_cost_orders: bigint;
        fulfilled_orders: bigint;
        label: Prisma.Decimal | null;
        profit: Prisma.Decimal | null;
        profit_orders: bigint;
        paid: Prisma.Decimal;
        processing: Prisma.Decimal;
        hold: Prisma.Decimal;
        returns: bigint;
        total_rows: bigint;
      }>
    >(Prisma.sql`
      WITH ${this.orderFinanceCte(filter, window)},
      ${orderProfitCtes(filter.organizationId, options.label)},
      by_orders AS (
        SELECT a.seller_id,
               COUNT(*)::bigint                                                             AS orders,
               COALESCE(SUM(op.proceeds) FILTER (WHERE op.proceeds_currency = ${cur}), 0)   AS revenue,
               COUNT(op.proceeds) FILTER (WHERE op.proceeds_currency = ${cur})::bigint      AS revenue_orders,
               COALESCE(SUM(op.base_cost) FILTER (WHERE op.cost_currency = ${cur}), 0)      AS base_cost,
               COUNT(op.base_cost) FILTER (WHERE op.cost_currency = ${cur})::bigint         AS base_cost_orders,
               COUNT(*) FILTER (WHERE op.fulfilled)::bigint                                 AS fulfilled_orders,
               SUM(op.profit) FILTER (WHERE op.proceeds_currency = ${cur})                  AS profit,
               COUNT(op.profit) FILTER (WHERE op.proceeds_currency = ${cur})::bigint        AS profit_orders
          FROM fin
          JOIN pod_tiktok_accounts a ON a.id = fin.account_id
          LEFT JOIN order_profit op  ON op.id = fin.id
         GROUP BY a.seller_id
      ),
      by_paid AS (
        SELECT a.seller_id, SUM(p.amount) AS amount
          FROM pod_tiktok_payments p JOIN pod_tiktok_accounts a ON a.id = p.account_id
         WHERE ${this.paidPaymentsWhere(filter, window)}
         GROUP BY a.seller_id
      ),
      by_processing AS (
        SELECT a.seller_id, SUM(st.settlement_amount) AS amount
          FROM pod_tiktok_statements st JOIN pod_tiktok_accounts a ON a.id = st.account_id
         WHERE ${this.processingStatementsWhere(filter, window)}
         GROUP BY a.seller_id
      ),
      by_returns AS (
        SELECT a.seller_id, COUNT(DISTINCT fin.tiktok_order_id)::bigint AS orders
          FROM fin
          JOIN pod_tiktok_accounts a ON a.id = fin.account_id
          JOIN pod_return_requests rr
            ON rr.organization_id = ${filter.organizationId}::uuid AND rr.deleted_at IS NULL
           AND rr.tiktok_order_id = fin.tiktok_order_id
           AND rr.status_group NOT IN ('CANCELLED'::"pod_return_status_group", 'REJECTED'::"pod_return_status_group")
         GROUP BY a.seller_id
      ),
      by_hold AS (
        SELECT a.seller_id, SUM(u.est_settlement_amount) AS amount
          FROM pod_tiktok_unsettled_transactions u JOIN pod_tiktok_accounts a ON a.id = u.account_id
         WHERE u.organization_id = ${filter.organizationId}::uuid AND u.deleted_at IS NULL
           AND ${this.scope(filter, 'u')}
         GROUP BY a.seller_id
      ),
      sellers AS (
        SELECT e.id AS seller_id,
               COALESCE(NULLIF(us.full_name, ''), us.email) AS seller_name,
               us.email AS seller_email,
               (e.status = 'ACTIVE'::"employee_status" AND us.status = 'ACTIVE'::"user_status") AS active
          FROM employees e JOIN users us ON us.id = e.user_id
         WHERE ${Prisma.join(sellerConds, ' AND ')}
        ${
          includeUnassigned
            ? Prisma.sql`UNION ALL
        SELECT NULL::uuid, NULL, NULL, TRUE
         WHERE EXISTS (SELECT 1 FROM by_orders WHERE seller_id IS NULL)
            OR EXISTS (SELECT 1 FROM by_paid WHERE seller_id IS NULL)
            OR EXISTS (SELECT 1 FROM by_processing WHERE seller_id IS NULL)
            OR EXISTS (SELECT 1 FROM by_hold WHERE seller_id IS NULL)`
            : Prisma.empty
        }
      ),
      merged AS (
        SELECT s.seller_id, s.seller_name, s.seller_email, s.active,
               COALESCE(o.orders, 0)::bigint             AS orders,
               COALESCE(o.revenue, 0)                    AS revenue,
               COALESCE(o.revenue_orders, 0)::bigint     AS revenue_orders,
               COALESCE(o.base_cost, 0)                  AS base_cost,
               COALESCE(o.base_cost_orders, 0)::bigint   AS base_cost_orders,
               COALESCE(o.fulfilled_orders, 0)::bigint   AS fulfilled_orders,
               CASE WHEN ${labelSameCurrency}
                    THEN COALESCE(o.fulfilled_orders, 0) * ${options.label.amount}::numeric END AS label,
               o.profit                                  AS profit,
               COALESCE(o.profit_orders, 0)::bigint      AS profit_orders,
               COALESCE(pa.amount, 0)                    AS paid,
               COALESCE(pr.amount, 0)                    AS processing,
               COALESCE(h.amount, 0)                     AS hold,
               COALESCE(rt.orders, 0)::bigint            AS returns
          FROM sellers s
          LEFT JOIN by_orders o      ON o.seller_id  IS NOT DISTINCT FROM s.seller_id
          LEFT JOIN by_paid pa       ON pa.seller_id IS NOT DISTINCT FROM s.seller_id
          LEFT JOIN by_processing pr ON pr.seller_id IS NOT DISTINCT FROM s.seller_id
          LEFT JOIN by_hold h        ON h.seller_id  IS NOT DISTINCT FROM s.seller_id
          LEFT JOIN by_returns rt    ON rt.seller_id IS NOT DISTINCT FROM s.seller_id
      )
      SELECT merged.*, COUNT(*) OVER ()::bigint AS total_rows
        FROM merged
       ${this.sellerOrderBy(options.sort, options.order)}
       LIMIT ${options.limit} OFFSET ${(options.page - 1) * options.limit}`);

    return {
      items: rows.map((row) => ({
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        sellerEmail: row.seller_email,
        active: row.active,
        orders: Number(row.orders),
        revenue: dec(row.revenue),
        revenueOrders: Number(row.revenue_orders),
        baseCost: dec(row.base_cost),
        baseCostOrders: Number(row.base_cost_orders),
        fulfilledOrders: Number(row.fulfilled_orders),
        label: row.label === null ? null : dec(row.label),
        profit: row.profit === null ? null : dec(row.profit),
        profitOrders: Number(row.profit_orders),
        paid: dec(row.paid),
        processing: dec(row.processing),
        hold: dec(row.hold),
        returns: Number(row.returns),
      })),
      total: Number(rows[0]?.total_rows ?? 0),
    };
  }

  /** Xu hướng tài chính theo NGÀY (giờ vận hành) — mọi ngày trong khoảng, ngày trống = 0. */
  async financeTrend(
    filter: DashboardFilter,
    window: Window,
    days: { fromDay: string; toDay: string },
    offsetMinutes: number,
  ): Promise<FinanceTrendRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; paid: Prisma.Decimal | null; processing: Prisma.Decimal | null }>
    >(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${days.fromDay}::date, ${days.toDay}::date, INTERVAL '1 day')::date AS day
      ),
      paid AS (
        SELECT ${this.localDate('COALESCE(p.paid_at, p.payment_created_at)', offsetMinutes)} AS day,
               SUM(p.amount) AS amount
          FROM pod_tiktok_payments p
         WHERE ${this.paidPaymentsWhere(filter, window)}
         GROUP BY 1
      ),
      processing AS (
        SELECT ${this.localDate('st.statement_at', offsetMinutes)} AS day, SUM(st.settlement_amount) AS amount
          FROM pod_tiktok_statements st
         WHERE ${this.processingStatementsWhere(filter, window)}
         GROUP BY 1
      )
      SELECT d.day, COALESCE(pa.amount, 0) AS paid, COALESCE(pr.amount, 0) AS processing
        FROM days d
        LEFT JOIN paid pa ON pa.day = d.day
        LEFT JOIN processing pr ON pr.day = d.day
       ORDER BY d.day`);
    return rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      paid: dec(row.paid),
      processing: dec(row.processing),
    }));
  }

  /** Xu hướng đơn theo NGÀY đặt (giờ vận hành) — mọi ngày trong khoảng, ngày trống = 0. */
  async orderTrend(
    filter: DashboardFilter,
    window: Window,
    days: { fromDay: string; toDay: string },
    offsetMinutes: number,
  ): Promise<OrderTrendRow[]> {
    const inProgress = [
      ...ORDER_STATUS_GROUPS.TO_SHIP,
      ...ORDER_STATUS_GROUPS.AWAITING_COLLECTION,
      ...ORDER_STATUS_GROUPS.SHIPPING,
    ];
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; total: bigint; delivered: bigint; in_progress: bigint; cancelled: bigint }>
    >(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${days.fromDay}::date, ${days.toDay}::date, INTERVAL '1 day')::date AS day
      ),
      o AS (
        SELECT ${this.localDate('po.ordered_at', offsetMinutes)} AS day,
               COUNT(*)::bigint AS total,
               COUNT(*) FILTER (WHERE po.status IN (${Prisma.join(ORDER_STATUS_GROUPS.DELIVERED)}))::bigint AS delivered,
               COUNT(*) FILTER (WHERE po.status IN (${Prisma.join(inProgress)}))::bigint AS in_progress,
               COUNT(*) FILTER (WHERE po.status IN (${Prisma.join(ORDER_STATUS_GROUPS.CANCELLED)}))::bigint AS cancelled
          FROM pod_orders po
         WHERE ${this.ordersWhere(filter, window)}
         GROUP BY 1
      )
      SELECT d.day,
             COALESCE(o.total, 0)::bigint       AS total,
             COALESCE(o.delivered, 0)::bigint   AS delivered,
             COALESCE(o.in_progress, 0)::bigint AS in_progress,
             COALESCE(o.cancelled, 0)::bigint   AS cancelled
        FROM days d LEFT JOIN o ON o.day = d.day
       ORDER BY d.day`);
    return rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      total: Number(row.total),
      delivered: Number(row.delivered),
      inProgress: Number(row.in_progress),
      cancelled: Number(row.cancelled),
    }));
  }

  // ---------------------------------------------------------------------------
  // Mảnh SQL dùng chung
  // ---------------------------------------------------------------------------

  /**
   * CTE `fin`: đơn trong khoảng + tiền thu về (đã quyết toán ?? ước tính).
   * Hai nguồn tài chính được gộp theo ĐƠN trước khi join ⇒ không nhân bản dòng.
   */
  private orderFinanceCte(filter: DashboardFilter, window: Window): Prisma.Sql {
    return Prisma.sql`
      o AS (
        SELECT po.id, po.tiktok_order_id, po.account_id, po.shop_id, po.status, po.total_amount, po.ordered_at
          FROM pod_orders po
         WHERE ${this.ordersWhere(filter, window)}
      ),
      settled AS (
        SELECT t.tiktok_order_id, SUM(t.settlement_amount) AS amount
          FROM pod_tiktok_statement_transactions t
          JOIN o ON o.tiktok_order_id = t.tiktok_order_id
         WHERE t.organization_id = ${filter.organizationId}::uuid AND t.deleted_at IS NULL
           AND t.type = 'ORDER'::"pod_statement_tx_type" AND t.currency = ${filter.currency}
         GROUP BY t.tiktok_order_id
      ),
      unsettled AS (
        SELECT u.tiktok_order_id, SUM(u.est_settlement_amount) AS amount
          FROM pod_tiktok_unsettled_transactions u
          JOIN o ON o.tiktok_order_id = u.tiktok_order_id
         WHERE u.organization_id = ${filter.organizationId}::uuid AND u.deleted_at IS NULL
           AND u.type = 'ORDER' AND u.currency = ${filter.currency}
         GROUP BY u.tiktok_order_id
      ),
      fin AS (
        SELECT o.*,
               COALESCE(s.amount, un.amount) AS proceeds
          FROM o
          LEFT JOIN settled s    ON s.tiktok_order_id = o.tiktok_order_id
          LEFT JOIN unsettled un ON un.tiktok_order_id = o.tiktok_order_id
      )`;
  }

  private ordersWhere(filter: DashboardFilter, window: Window): Prisma.Sql {
    return Prisma.sql`po.organization_id = ${filter.organizationId}::uuid
       AND po.deleted_at IS NULL
       AND po.currency = ${filter.currency}
       AND po.ordered_at BETWEEN ${window.from} AND ${window.to}
       AND ${this.scope(filter, 'po', { currency: false })}`;
  }

  private paidPaymentsWhere(filter: DashboardFilter, window: Window): Prisma.Sql {
    return Prisma.sql`p.organization_id = ${filter.organizationId}::uuid
       AND p.deleted_at IS NULL
       AND p.status = 'PAID'::"pod_payout_status"
       AND COALESCE(p.paid_at, p.payment_created_at) BETWEEN ${window.from} AND ${window.to}
       AND ${this.scope(filter, 'p')}`;
  }

  private processingStatementsWhere(filter: DashboardFilter, window: Window): Prisma.Sql {
    return Prisma.sql`st.organization_id = ${filter.organizationId}::uuid
       AND st.deleted_at IS NULL
       AND st."paymentStatus" = 'PROCESSING'::"pod_payout_status"
       AND st.statement_at BETWEEN ${window.from} AND ${window.to}
       AND ${this.scope(filter, 'st')}`;
  }

  /** Điều kiện trên `pod_tiktok_shops s` — dùng chung cho thẻ Trạng thái shop và popup của nó. */
  private shopConds(filter: DashboardFilter): Prisma.Sql {
    const conds: Prisma.Sql[] = [
      Prisma.sql`s.organization_id = ${filter.organizationId}::uuid`,
      Prisma.sql`s.deleted_at IS NULL`,
    ];
    if (filter.accountIds) conds.push(this.inAccounts('s.account_id', filter.accountIds));
    if (filter.shopId) conds.push(Prisma.sql`s.id = ${filter.shopId}::uuid`);
    if (filter.sellerId) conds.push(this.ofSeller('s.account_id', filter));
    return Prisma.join(conds, ' AND ');
  }

  /**
   * Phạm vi + bộ lọc cho bảng có `account_id`, `shop_id` (và `currency` nếu `currency !== false`).
   * `alias` là hằng số trong file này — không bao giờ đến từ người dùng.
   */
  private scope(filter: DashboardFilter, alias: string, opts: { currency?: boolean } = {}): Prisma.Sql {
    const conds: Prisma.Sql[] = [];
    if (opts.currency !== false) conds.push(Prisma.sql`${Prisma.raw(alias)}.currency = ${filter.currency}`);
    if (filter.accountIds) conds.push(this.inAccounts(`${alias}.account_id`, filter.accountIds));
    if (filter.shopId) conds.push(Prisma.sql`${Prisma.raw(alias)}.shop_id = ${filter.shopId}::uuid`);
    if (filter.sellerId) conds.push(this.ofSeller(`${alias}.account_id`, filter));
    return conds.length ? Prisma.join(conds, ' AND ') : Prisma.sql`TRUE`;
  }

  private inAccounts(column: string, accountIds: string[]): Prisma.Sql {
    if (accountIds.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})`;
  }

  private ofSeller(column: string, filter: DashboardFilter): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(column)} IN (
      SELECT sa.id FROM pod_tiktok_accounts sa
       WHERE sa.organization_id = ${filter.organizationId}::uuid AND sa.seller_id = ${filter.sellerId}::uuid)`;
  }

  /** CASE trạng thái TikTok → nhóm thống kê, dựng từ `ORDER_STATUS_GROUPS` (không lặp điều kiện). */
  private statusGroup(column: string): Prisma.Sql {
    const whens = Object.entries(ORDER_STATUS_GROUPS).map(
      ([group, statuses]) =>
        Prisma.sql`WHEN ${Prisma.raw(column)} IN (${Prisma.join([...statuses])}) THEN ${group}`,
    );
    return Prisma.sql`(CASE ${Prisma.join(whens, ' ')} ELSE 'OTHER' END)`;
  }

  /** Ngày theo giờ vận hành của một cột timestamptz. */
  private localDate(column: string, offsetMinutes: number): Prisma.Sql {
    return Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') + make_interval(mins => ${offsetMinutes}::int))::date`;
  }

  private sellerOrderBy(field: SellerSortField, order: 'asc' | 'desc'): Prisma.Sql {
    const column: Record<SellerSortField, string> = {
      name: 'seller_name',
      orders: 'orders',
      revenue: 'revenue',
      baseCost: 'base_cost',
      label: 'label',
      profit: 'profit',
      paid: 'paid',
      processing: 'processing',
      hold: 'hold',
    };
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    // NULLS LAST: nhóm "chưa gán seller" (tên NULL) không chiếm đầu bảng khi sắp theo tên.
    return Prisma.raw(`ORDER BY ${column[field]} ${direction} NULLS LAST, seller_name ASC NULLS LAST`);
  }
}
