import { Injectable } from '@nestjs/common';
import { PodListingJobItemStatus, PodListingJobType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { LabelCostConfig } from '../shared/order-financials';
import { orderProfitCtes } from '../shared/order-profit.sql';

/**
 * Loại lượt chạy ĐƯA SẢN PHẨM LÊN SÀN (`save_mode = LISTING`). `CREATE_DRAFT` chỉ tạo Draft trên TikTok
 * (chưa đăng bán) ⇒ KHÔNG phải một lần listing.
 */
export const LISTING_JOB_TYPES: readonly PodListingJobType[] = [
  PodListingJobType.PUBLISH,
  PodListingJobType.CLONE,
  PodListingJobType.LIVE_LISTING,
];

export interface EmployeeWorkFilter {
  organizationId: string;
  /** Mọi số tiền chỉ cộng trong MỘT đơn vị tiền (không quy đổi) — như Dashboard. */
  currency: string;
  from: Date;
  to: Date;
  shopId?: string;
  /** Chi phí label mỗi đơn — trừ vào lợi nhuận (cùng nguồn với màn Order). */
  label: LabelCostConfig;
}

/** Một cặp (người dùng × shop): đã listing trên shop đó trong khoảng, và/hoặc phụ trách shop đó. */
export interface EmployeeWorkPairRow {
  userId: string;
  shopId: string;
  shopName: string;
  accountName: string;
  /** Số sản phẩm NGƯỜI NÀY đã đưa lên shop trong khoảng (đã chống đếm trùng). */
  listings: number;
  /** Shop thuộc TikTok Account được gán cho người này (seller). */
  assigned: boolean;
  /** Số đơn của SHOP trong khoảng. */
  orders: number;
  /** Số đơn tính được lợi nhuận (đủ dữ kiện như màn Order). */
  profitOrders: number;
  /** Σ lợi nhuận các đơn tính được; `null` khi không đơn nào tính được. */
  profit: string | null;
}

export interface EmployeeWorkUserRow {
  userId: string;
  name: string;
  email: string;
  isEmployee: boolean;
  active: boolean;
}

/**
 * PodEmployeeWorkRepository — số liệu cho màn "Thống kê công việc nhân viên". MỌI phép đếm / cộng chạy ở DB
 * trong MỘT câu truy vấn (không N+1): kết quả là các cặp (người dùng × shop), số dòng ~ số cặp chứ không
 * phải số đơn / số listing.
 *
 * ```
 *   Listing  : pod_listing_job_items (SUCCESS, có remote_product_id) ⨝ pod_listing_jobs (PUBLISH/CLONE/
 *              LIVE_LISTING) — người thực hiện = jobs.created_by; ngày = items.finished_at. Mỗi
 *              (shop, sản phẩm TikTok) chỉ tính ở lần thành công ĐẦU TIÊN (retry / chạy lại / "đã publish
 *              trước đó" không đếm thêm).
 *   Phụ trách: pod_tiktok_accounts.seller_id → employees.user_id → mọi shop của account.
 *   Đơn      : pod_orders theo ordered_at, cùng đơn vị tiền; lợi nhuận = orderProfitCtes (= màn Order).
 * ```
 */
@Injectable()
export class PodEmployeeWorkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async pairs(filter: EmployeeWorkFilter): Promise<EmployeeWorkPairRow[]> {
    const org = filter.organizationId;
    const shopCond = (column: string) =>
      filter.shopId ? Prisma.sql`AND ${Prisma.raw(column)} = ${filter.shopId}::uuid` : Prisma.empty;
    const listingTypes = Prisma.join(LISTING_JOB_TYPES.map((type) => Prisma.sql`${type}::"pod_listing_job_type"`));
    const success = Prisma.sql`${PodListingJobItemStatus.SUCCESS}::"pod_listing_job_item_status"`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        shop_id: string;
        shop_name: string;
        account_name: string;
        listings: bigint;
        assigned: boolean;
        orders: bigint | null;
        profit_orders: bigint | null;
        profit: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      WITH listed AS (
        SELECT j.created_by AS user_id, i.shop_id, COUNT(*)::bigint AS listings
          FROM pod_listing_job_items i
          JOIN pod_listing_jobs j ON j.id = i.job_id
         WHERE i.organization_id = ${org}::uuid
           AND i.status = ${success}
           AND i.remote_product_id IS NOT NULL
           AND i.finished_at BETWEEN ${filter.from} AND ${filter.to}
           AND j.type IN (${listingTypes})
           AND j.created_by IS NOT NULL
           ${shopCond('i.shop_id')}
           -- 🔴 Chống đếm trùng: chỉ lần THÀNH CÔNG ĐẦU TIÊN của (shop, sản phẩm TikTok).
           AND NOT EXISTS (
             SELECT 1
               FROM pod_listing_job_items e
               JOIN pod_listing_jobs ej ON ej.id = e.job_id
              WHERE e.shop_id = i.shop_id
                AND e.remote_product_id = i.remote_product_id
                AND e.status = ${success}
                AND ej.type IN (${listingTypes})
                AND (e.finished_at < i.finished_at OR (e.finished_at = i.finished_at AND e.id < i.id))
           )
         GROUP BY j.created_by, i.shop_id
      ),
      assigned AS (
        SELECT e.user_id, s.id AS shop_id
          FROM pod_tiktok_accounts a
          JOIN employees e ON e.id = a.seller_id AND e.deleted_at IS NULL AND e.organization_id = ${org}::uuid
          JOIN pod_tiktok_shops s ON s.account_id = a.id AND s.deleted_at IS NULL
         WHERE a.organization_id = ${org}::uuid AND a.deleted_at IS NULL
           ${shopCond('s.id')}
      ),
      pairs AS (
        SELECT user_id, shop_id, SUM(listings)::bigint AS listings, BOOL_OR(assigned) AS assigned
          FROM (
            SELECT user_id, shop_id, listings, FALSE AS assigned FROM listed
            UNION ALL
            SELECT user_id, shop_id, 0::bigint, TRUE FROM assigned
          ) x
         GROUP BY user_id, shop_id
      ),
      o AS (
        SELECT po.id, po.tiktok_order_id, po.shop_id
          FROM pod_orders po
         WHERE po.organization_id = ${org}::uuid
           AND po.deleted_at IS NULL
           AND po.currency = ${filter.currency}
           AND po.ordered_at BETWEEN ${filter.from} AND ${filter.to}
           AND po.shop_id IN (SELECT shop_id FROM pairs)
      ),
      ${orderProfitCtes(org, filter.label)},
      shop_orders AS (
        SELECT shop_id, COUNT(*)::bigint AS orders, COUNT(profit)::bigint AS profit_orders, SUM(profit) AS profit
          FROM order_profit
         GROUP BY shop_id
      )
      SELECT p.user_id, p.shop_id, s.name AS shop_name, a.account_name,
             p.listings, p.assigned, so.orders, so.profit_orders, so.profit
        FROM pairs p
        JOIN pod_tiktok_shops s    ON s.id = p.shop_id AND s.organization_id = ${org}::uuid
        JOIN pod_tiktok_accounts a ON a.id = s.account_id
        LEFT JOIN shop_orders so   ON so.shop_id = p.shop_id`);

    return rows.map((row) => ({
      userId: row.user_id,
      shopId: row.shop_id,
      shopName: row.shop_name,
      accountName: row.account_name,
      listings: Number(row.listings),
      assigned: row.assigned,
      orders: Number(row.orders ?? 0),
      profitOrders: Number(row.profit_orders ?? 0),
      profit: row.profit === null ? null : row.profit.toString(),
    }));
  }

  /**
   * Người dùng hiển thị: nhân viên của tổ chức + người dùng xuất hiện trong `pairs` (vd Admin không có hồ sơ
   * Employee nhưng có listing). Một câu truy vấn cho cả danh sách.
   */
  users(organizationId: string, userIds: string[]): Promise<EmployeeWorkUserRow[]> {
    return this.prisma.user
      .findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [{ employee: { deletedAt: null } }, ...(userIds.length ? [{ id: { in: userIds } }] : [])],
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true,
          employee: { select: { id: true, status: true, deletedAt: true } },
        },
      })
      .then((users) =>
        users.map((user) => {
          const employee = user.employee && !user.employee.deletedAt ? user.employee : null;
          return {
            userId: user.id,
            name: user.fullName?.trim() || user.email,
            email: user.email,
            isEmployee: employee !== null,
            active: user.status === 'ACTIVE' && (!employee || employee.status === 'ACTIVE'),
          };
        }),
      );
  }

  /** Người dùng đã từng chạy một lượt listing của tổ chức — cho ô lọc "Nhân viên". */
  async listingActorIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.podListingJob.findMany({
      where: { organizationId, createdBy: { not: null }, type: { in: [...LISTING_JOB_TYPES] } },
      select: { createdBy: true },
      distinct: ['createdBy'],
    });
    return rows.map((row) => row.createdBy as string);
  }

  /** Shop của tổ chức (tên shop + tên account) — cho ô lọc. */
  shops(organizationId: string) {
    return this.prisma.podTiktokShop.findMany({
      where: { organizationId, deletedAt: null, account: { deletedAt: null } },
      select: { id: true, name: true, region: true, account: { select: { accountName: true } } },
      orderBy: { name: 'asc' },
    });
  }
}
