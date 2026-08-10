import { Injectable } from '@nestjs/common';
import { PodPayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Bộ lọc dùng chung cho MỌI truy vấn báo cáo payout. */
export interface PayoutReportFilter {
  organizationId: string;
  /** Lọc theo `payment_created_at` (thời điểm TikTok khởi tạo chi trả). */
  from?: Date;
  to?: Date;
  status?: PodPayoutStatus;
  /** Row-level: chỉ tính account do user này quản lý. `undefined` = toàn Organization. */
  sellerScope?: string;
  /** Lọc theo tên/email seller hoặc tên account. */
  search?: string;
}

export interface PayoutSummaryRow {
  totalPayout: string;
  currency: string | null;
  paymentCount: number;
  accountCount: number;
  sellerCount: number;
  orderCount: number;
}

export interface PayoutSellerRow {
  sellerId: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  accountCount: number;
  orderCount: number;
  totalPayout: string;
  currency: string | null;
}

export interface PayoutAccountRow {
  accountId: string;
  accountName: string;
  shopName: string | null;
  sellerId: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  orderCount: number;
  totalPayout: string;
  currency: string | null;
}

/** Cột được phép sắp xếp (whitelist — chống SQL injection qua ORDER BY). */
export const PAYOUT_SORT_FIELDS = ['totalPayout', 'orderCount', 'accountCount', 'name'] as const;
export type PayoutSortField = (typeof PAYOUT_SORT_FIELDS)[number];
export type PayoutSortOrder = 'asc' | 'desc';

/**
 * PodPayoutReportRepository — TOÀN BỘ số liệu được tính bằng SQL aggregate
 * (GROUP BY / SUM / COUNT DISTINCT) tại PostgreSQL.
 *
 * 🔴 KHÔNG kéo bản ghi về JavaScript rồi cộng: dữ liệu payout tăng theo ngày và theo số
 * shop, vòng lặp phía Node sẽ hỏng khi mở rộng. Cũng KHÔNG có N+1: mỗi bảng trên màn hình
 * là ĐÚNG MỘT truy vấn (một cho dữ liệu, một cho tổng số dòng phục vụ phân trang).
 *
 * Cách tính (docs/pod-tiktok/10-payout-report.md):
 *   Total Payout = SUM(pod_tiktok_payments.amount)          ← số tiền TikTok thực chi
 *   Order Count  = SUM(pod_tiktok_statements.order_count)   ← chỉ statement thuộc payment đó
 *
 * Order Count đi qua `statement.payment_id` để LUÔN nằm trong cùng phạm vi lọc với số tiền:
 * không trộn hai trục thời gian khác nhau (create_time của payment vs create_time của đơn).
 */
@Injectable()
export class PodPayoutReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Điều kiện WHERE cho bảng payments (alias `p`) + join account (alias `a`). */
  private paymentWhere(filter: PayoutReportFilter): Prisma.Sql {
    const conds: Prisma.Sql[] = [
      Prisma.sql`p.organization_id = ${filter.organizationId}::uuid`,
      Prisma.sql`p.deleted_at IS NULL`,
      Prisma.sql`a.deleted_at IS NULL`,
    ];
    if (filter.from) conds.push(Prisma.sql`p.payment_created_at >= ${filter.from}`);
    if (filter.to) conds.push(Prisma.sql`p.payment_created_at <= ${filter.to}`);
    if (filter.status) {
      conds.push(Prisma.sql`p.status = ${filter.status}::"pod_payout_status"`);
    }
    if (filter.sellerScope) {
      // `sellerScope` là USER id của người đang đăng nhập; seller lưu theo EMPLOYEE id,
      // nên so khớp qua `employees.user_id` (đã join sẵn ở mọi truy vấn — không tốn thêm query).
      conds.push(Prisma.sql`e.user_id = ${filter.sellerScope}::uuid`);
    }
    return Prisma.join(conds, ' AND ');
  }

  /**
   * Join Seller phụ trách: account → employee → user.
   *
   * Seller là `Employee` (vai trò nghiệp vụ), còn họ tên/email nằm ở `User` (ADR-007)
   * nên phải qua hai bậc. LEFT JOIN vì "chưa phân công" là trạng thái hợp lệ và những
   * account đó VẪN phải xuất hiện trong báo cáo (gom vào nhóm `sellerId = null`).
   */
  private readonly sellerJoin = Prisma.sql`
    LEFT JOIN employees e ON e.id = a.seller_id AND e.deleted_at IS NULL
    LEFT JOIN users u ON u.id = e.user_id`;

  /**
   * Số đơn của từng payment, tính SẴN ở một subquery.
   * Một payment gộp nhiều statement (Finance API overview) nên phải cộng `order_count`
   * của mọi statement trỏ về payment đó.
   */
  private readonly orderCountPerPayment = Prisma.sql`
    LEFT JOIN (
      SELECT s.payment_id, SUM(s.order_count)::bigint AS order_count
        FROM pod_tiktok_statements s
       WHERE s.deleted_at IS NULL AND s.payment_id IS NOT NULL
       GROUP BY s.payment_id
    ) sc ON sc.payment_id = p.id`;

  /** Điều kiện tìm kiếm theo tên/email seller hoặc tên account. */
  private searchCond(search?: string): Prisma.Sql {
    if (!search) return Prisma.sql`TRUE`;
    const pattern = `%${search}%`;
    return Prisma.sql`(
      a.account_name ILIKE ${pattern}
      OR COALESCE(u.email, '') ILIKE ${pattern}
      OR COALESCE(u.full_name, '') ILIKE ${pattern}
    )`;
  }

  /**
   * Report Card — tổng payout toàn bộ account trong khoảng lọc.
   * Trả kèm số account/seller/đơn để màn hình hiển thị ngữ cảnh mà không cần query thêm.
   */
  async summary(filter: PayoutReportFilter): Promise<PayoutSummaryRow> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        total_payout: Prisma.Decimal | null;
        currency: string | null;
        payment_count: bigint;
        account_count: bigint;
        seller_count: bigint;
        order_count: bigint | null;
      }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(p.amount), 0)                    AS total_payout,
             MIN(p.currency)                               AS currency,
             COUNT(*)::bigint                              AS payment_count,
             COUNT(DISTINCT p.account_id)::bigint          AS account_count,
             COUNT(DISTINCT a.seller_id)::bigint           AS seller_count,
             COALESCE(SUM(sc.order_count), 0)::bigint      AS order_count
        FROM pod_tiktok_payments p
        JOIN pod_tiktok_accounts a ON a.id = p.account_id
        ${this.sellerJoin}
        ${this.orderCountPerPayment}
       WHERE ${this.paymentWhere(filter)}
         AND ${this.searchCond(filter.search)}`);

    const row = rows[0];
    return {
      totalPayout: (row?.total_payout ?? new Prisma.Decimal(0)).toString(),
      currency: row?.currency ?? null,
      paymentCount: Number(row?.payment_count ?? 0),
      accountCount: Number(row?.account_count ?? 0),
      sellerCount: Number(row?.seller_count ?? 0),
      orderCount: Number(row?.order_count ?? 0),
    };
  }

  /**
   * Cảnh báo trộn tiền tệ: báo cáo cộng dồn `amount` nên chỉ đúng khi mọi payment cùng
   * đơn vị. Trả về danh sách currency xuất hiện để service cảnh báo thay vì âm thầm cộng sai.
   */
  async distinctCurrencies(filter: PayoutReportFilter): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ currency: string }>>(Prisma.sql`
      SELECT DISTINCT p.currency
        FROM pod_tiktok_payments p
        JOIN pod_tiktok_accounts a ON a.id = p.account_id
        ${this.sellerJoin}
       WHERE ${this.paymentWhere(filter)}
         AND ${this.searchCond(filter.search)}
       ORDER BY p.currency`);
    return rows.map((row) => row.currency);
  }

  /** Bảng Seller — gom theo `account.seller_id` (Employee phụ trách). */
  async sellerBreakdown(
    filter: PayoutReportFilter,
    page: number,
    limit: number,
    sortField: PayoutSortField,
    sortOrder: PayoutSortOrder,
  ): Promise<{ items: PayoutSellerRow[]; total: number }> {
    const orderBy = this.orderByClause(sortField, sortOrder, 'COALESCE(u.full_name, u.email)');

    const rows = await this.prisma.$queryRaw<
      Array<{
        seller_id: string | null;
        seller_email: string | null;
        seller_name: string | null;
        account_count: bigint;
        order_count: bigint | null;
        total_payout: Prisma.Decimal | null;
        currency: string | null;
      }>
    >(Prisma.sql`
      SELECT a.seller_id                                   AS seller_id,
             MIN(u.email)                                  AS seller_email,
             MIN(u.full_name)                              AS seller_name,
             COUNT(DISTINCT p.account_id)::bigint          AS account_count,
             COALESCE(SUM(sc.order_count), 0)::bigint      AS order_count,
             COALESCE(SUM(p.amount), 0)                    AS total_payout,
             MIN(p.currency)                               AS currency
        FROM pod_tiktok_payments p
        JOIN pod_tiktok_accounts a ON a.id = p.account_id
        ${this.sellerJoin}
        ${this.orderCountPerPayment}
       WHERE ${this.paymentWhere(filter)}
         AND ${this.searchCond(filter.search)}
       GROUP BY a.seller_id
       ${orderBy}
       LIMIT ${limit} OFFSET ${(page - 1) * limit}`);

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
        FROM (
          SELECT a.seller_id
            FROM pod_tiktok_payments p
            JOIN pod_tiktok_accounts a ON a.id = p.account_id
            ${this.sellerJoin}
           WHERE ${this.paymentWhere(filter)}
             AND ${this.searchCond(filter.search)}
           GROUP BY a.seller_id
        ) grouped`);

    return {
      items: rows.map((row) => ({
        sellerId: row.seller_id,
        sellerEmail: row.seller_email,
        sellerName: row.seller_name,
        accountCount: Number(row.account_count),
        orderCount: Number(row.order_count ?? 0),
        totalPayout: (row.total_payout ?? new Prisma.Decimal(0)).toString(),
        currency: row.currency,
      })),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /** Bảng Account — gom theo account, kèm tên shop và seller quản lý. */
  async accountBreakdown(
    filter: PayoutReportFilter,
    page: number,
    limit: number,
    sortField: PayoutSortField,
    sortOrder: PayoutSortOrder,
  ): Promise<{ items: PayoutAccountRow[]; total: number }> {
    const orderBy = this.orderByClause(sortField, sortOrder, 'MIN(a.account_name)');

    const rows = await this.prisma.$queryRaw<
      Array<{
        account_id: string;
        account_name: string;
        shop_name: string | null;
        seller_id: string | null;
        seller_email: string | null;
        seller_name: string | null;
        order_count: bigint | null;
        total_payout: Prisma.Decimal | null;
        currency: string | null;
      }>
    >(Prisma.sql`
      SELECT p.account_id                                  AS account_id,
             MIN(a.account_name)                           AS account_name,
             MIN(sh.name)                                  AS shop_name,
             MIN(a.seller_id::text)::uuid                  AS seller_id,
             MIN(u.email)                                  AS seller_email,
             MIN(u.full_name)                              AS seller_name,
             COALESCE(SUM(sc.order_count), 0)::bigint      AS order_count,
             COALESCE(SUM(p.amount), 0)                    AS total_payout,
             MIN(p.currency)                               AS currency
        FROM pod_tiktok_payments p
        JOIN pod_tiktok_accounts a ON a.id = p.account_id
        LEFT JOIN pod_tiktok_shops sh ON sh.id = p.shop_id AND sh.deleted_at IS NULL
        ${this.sellerJoin}
        ${this.orderCountPerPayment}
       WHERE ${this.paymentWhere(filter)}
         AND ${this.searchCond(filter.search)}
       GROUP BY p.account_id
       ${orderBy}
       LIMIT ${limit} OFFSET ${(page - 1) * limit}`);

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT p.account_id)::bigint AS total
        FROM pod_tiktok_payments p
        JOIN pod_tiktok_accounts a ON a.id = p.account_id
        ${this.sellerJoin}
       WHERE ${this.paymentWhere(filter)}
         AND ${this.searchCond(filter.search)}`);

    return {
      items: rows.map((row) => ({
        accountId: row.account_id,
        accountName: row.account_name,
        shopName: row.shop_name,
        sellerId: row.seller_id,
        sellerEmail: row.seller_email,
        sellerName: row.seller_name,
        orderCount: Number(row.order_count ?? 0),
        totalPayout: (row.total_payout ?? new Prisma.Decimal(0)).toString(),
        currency: row.currency,
      })),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /**
   * Dựng mệnh đề ORDER BY từ whitelist.
   * `Prisma.raw` chỉ nhận chuỗi hằng do chính hàm này sinh ra — KHÔNG bao giờ nhận
   * giá trị người dùng, nên không có đường SQL injection.
   */
  private orderByClause(
    field: PayoutSortField,
    order: PayoutSortOrder,
    nameExpression: string,
  ): Prisma.Sql {
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const column =
      field === 'orderCount'
        ? 'COALESCE(SUM(sc.order_count), 0)'
        : field === 'accountCount'
          ? 'COUNT(DISTINCT p.account_id)'
          : field === 'name'
            ? nameExpression
            : 'COALESCE(SUM(p.amount), 0)';
    // NULLS LAST để nhóm "chưa gán seller" không chiếm đầu bảng khi sắp theo tên.
    return Prisma.raw(`ORDER BY ${column} ${direction} NULLS LAST`);
  }
}
