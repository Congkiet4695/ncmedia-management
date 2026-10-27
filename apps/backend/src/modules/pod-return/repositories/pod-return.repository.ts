import { Injectable } from '@nestjs/common';
import { PodReturnStatusGroup, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { settledRefundAmountSql } from '../../pod-tiktok/shared/settled-refund.sql';
import type { PodReturnSortField } from '../constants/pod-return.constants';
import type { MappedReturn } from '../mappers/pod-return.mapper';

/** Bộ lọc đã chuẩn hoá — DÙNG CHUNG cho danh sách và tổng quan (một điều kiện WHERE duy nhất). */
export interface PodReturnFilterParams {
  /** Shop người dùng được xem. `undefined` = toàn tổ chức (Admin). */
  shopScope?: string[];
  shopId?: string;
  accountId?: string;
  search?: string;
  returnType?: string;
  statusGroup?: PodReturnStatusGroup;
  returnStatus?: string;
  reason?: string;
  dateField: 'requestedAt' | 'updatedAt';
  from?: Date;
  /** Mốc NỬA MỞ: `cột < before` (00:00 ngày sau ngày cuối, giờ nghiệp vụ). */
  before?: Date;
}

export interface ExistingReturnSnapshot {
  id: string;
  payloadHash: string;
  tiktokUpdateTime: bigint;
  orderId: string | null;
}

const DETAIL_INCLUDE = {
  shop: { select: { name: true } },
  account: { select: { accountName: true } },
  items: { where: { deletedAt: null }, orderBy: { returnLineItemId: 'asc' } },
} satisfies Prisma.PodReturnRequestInclude;
export type ReturnRow = Prisma.PodReturnRequestGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const SORT_COLUMN: Record<PodReturnSortField, string> = {
  requestedAt: 'r.requested_at',
  tiktokUpdatedAt: 'r.tiktok_updated_at',
  refundTotal: 'r.refund_total',
};

/** Nhóm trạng thái KHÔNG còn hiệu lực — không tính vào số tiền / số lượng "đang yêu cầu". */
const INACTIVE_GROUPS = [PodReturnStatusGroup.CANCELLED, PodReturnStatusGroup.REJECTED];

/**
 * PodReturnRepository — MỌI truy vấn bắt buộc `organizationId` (ADR-004) và giao với phạm vi shop
 * của người dùng (không bao giờ gán đè bằng bộ lọc).
 */
@Injectable()
export class PodReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  async findPage(
    organizationId: string,
    params: PodReturnFilterParams,
    page: { page: number; limit: number; sortBy: PodReturnSortField; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: ReturnRow[]; total: number }> {
    const where = this.whereSql(organizationId, params);
    const direction = page.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    // Khoá phụ `id` để phân trang ổn định khi nhiều yêu cầu trùng thời điểm.
    const ids = await this.prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
      SELECT r.id, COUNT(*) OVER ()::bigint AS total
        FROM pod_return_requests r
       WHERE ${where}
       ORDER BY ${Prisma.raw(SORT_COLUMN[page.sortBy])} ${direction} NULLS LAST, r.id ${direction}
       LIMIT ${page.limit} OFFSET ${(page.page - 1) * page.limit}`);
    if (ids.length === 0) {
      // Trang vượt quá cuối vẫn phải trả đúng tổng.
      const [{ count }] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM pod_return_requests r WHERE ${where}`);
      return { items: [], total: Number(count) };
    }
    const rows = await this.prisma.podReturnRequest.findMany({
      where: { organizationId, id: { in: ids.map((row) => row.id) } },
      include: DETAIL_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: ids.map((row) => byId.get(row.id)).filter((row): row is ReturnRow => row !== undefined),
      total: Number(ids[0].total),
    };
  }

  findById(organizationId: string, id: string): Promise<ReturnRow | null> {
    return this.prisma.podReturnRequest.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
  }

  /** Thẻ tổng quan — cùng WHERE với danh sách. */
  async summary(organizationId: string, params: PodReturnFilterParams) {
    const where = this.whereSql(organizationId, params);
    const inactive = Prisma.join(INACTIVE_GROUPS.map((group) => Prisma.sql`${group}::"pod_return_status_group"`));

    const groups = await this.prisma.$queryRaw<Array<{ grp: PodReturnStatusGroup; count: bigint }>>(Prisma.sql`
      SELECT r.status_group AS grp, COUNT(*)::bigint AS count
        FROM pod_return_requests r WHERE ${where} GROUP BY r.status_group`);

    const [totals] = await this.prisma.$queryRaw<
      Array<{ orders: bigint; refunded_orders: bigint; quantity: bigint | null }>
    >(Prisma.sql`
      SELECT COUNT(DISTINCT r.tiktok_order_id)::bigint                                AS orders,
             COUNT(DISTINCT r.tiktok_order_id) FILTER (WHERE r.refund_completed)::bigint AS refunded_orders,
             SUM(r.item_quantity) FILTER (WHERE r.status_group NOT IN (${inactive}))::bigint AS quantity
        FROM pod_return_requests r WHERE ${where}`);

    // Tiền theo TỪNG đơn vị tiền tệ. Tiền quyết toán tính MỖI ĐƠN MỘT LẦN (nhiều yêu cầu cùng một đơn
    // không nhân bản số tiền), chỉ trên các đơn thuộc tập yêu cầu đang lọc.
    const amounts = await this.prisma.$queryRaw<
      Array<{ currency: string; requested: Prisma.Decimal | null; refunded: Prisma.Decimal | null; settled: Prisma.Decimal | null }>
    >(Prisma.sql`
      WITH r AS (
        SELECT r.* FROM pod_return_requests r WHERE ${where}
      ),
      req AS (
        SELECT r.currency,
               SUM(r.refund_total) FILTER (WHERE r.status_group NOT IN (${inactive})) AS requested,
               SUM(r.refund_total) FILTER (WHERE r.refund_completed)                  AS refunded
          FROM r WHERE r.currency IS NOT NULL GROUP BY r.currency
      ),
      settled AS (
        SELECT t.currency, SUM(${settledRefundAmountSql('t')}) AS settled
          FROM pod_tiktok_statement_transactions t
         WHERE t.organization_id = ${organizationId}::uuid AND t.deleted_at IS NULL
           AND t.revenue_breakdown IS NOT NULL
           AND t.tiktok_order_id IN (SELECT DISTINCT tiktok_order_id FROM r)
         GROUP BY t.currency
      )
      SELECT COALESCE(req.currency, settled.currency) AS currency,
             req.requested, req.refunded, settled.settled
        FROM req FULL OUTER JOIN settled ON settled.currency = req.currency
       ORDER BY 1`);

    return {
      groups: groups.map((row) => ({ group: row.grp, count: Number(row.count) })),
      orders: Number(totals?.orders ?? 0),
      refundedOrders: Number(totals?.refunded_orders ?? 0),
      itemQuantity: Number(totals?.quantity ?? 0),
      amounts: amounts.map((row) => ({
        currency: row.currency,
        requested: row.requested ?? new Prisma.Decimal(0),
        refunded: row.refunded ?? new Prisma.Decimal(0),
        settled: row.settled ?? new Prisma.Decimal(0),
      })),
    };
  }

  /** Doanh thu bị trừ lại do hoàn tiền (statement đã quyết toán) theo ĐƠN. Đơn chưa quyết toán ⇒ không có khoá. */
  async settledRefundByOrder(organizationId: string, tiktokOrderIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (tiktokOrderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ tiktok_order_id: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT t.tiktok_order_id, SUM(${settledRefundAmountSql('t')}) AS amount
        FROM pod_tiktok_statement_transactions t
       WHERE t.organization_id = ${organizationId}::uuid AND t.deleted_at IS NULL
         AND t.revenue_breakdown IS NOT NULL
         AND t.tiktok_order_id IN (${Prisma.join([...new Set(tiktokOrderIds)])})
       GROUP BY t.tiktok_order_id`);
    return new Map(rows.map((row) => [row.tiktok_order_id, new Prisma.Decimal(row.amount)]));
  }

  async saveHistory(id: string, organizationId: string, history: Prisma.InputJsonValue, updateTime: bigint, at: Date) {
    await this.prisma.podReturnRequest.updateMany({
      where: { id, organizationId },
      data: { history, historySyncedAt: at, historyUpdateTime: updateTime },
    });
  }

  // ---------------------------------------------------------------------------
  // Ghi (đồng bộ)
  // ---------------------------------------------------------------------------

  async findSnapshots(organizationId: string, tiktokReturnIds: string[]): Promise<Map<string, ExistingReturnSnapshot>> {
    if (tiktokReturnIds.length === 0) return new Map();
    const rows = await this.prisma.podReturnRequest.findMany({
      where: { organizationId, tiktokReturnId: { in: tiktokReturnIds } },
      select: { id: true, tiktokReturnId: true, payloadHash: true, tiktokUpdateTime: true, orderId: true },
    });
    return new Map(rows.map((row) => [row.tiktokReturnId, row]));
  }

  /** `tiktok_order_id` ⇒ id đơn POD của CÙNG shop (không nối nhầm sang shop khác). */
  async findOrderIds(organizationId: string, shopId: string, tiktokOrderIds: string[]): Promise<Map<string, string>> {
    if (tiktokOrderIds.length === 0) return new Map();
    const rows = await this.prisma.podOrder.findMany({
      where: { organizationId, shopId, deletedAt: null, tiktokOrderId: { in: [...new Set(tiktokOrderIds)] } },
      select: { id: true, tiktokOrderId: true },
    });
    return new Map(rows.map((row) => [row.tiktokOrderId, row.id]));
  }

  /** `sale_price` theo order line item — chỉ của các đơn đã nối được. */
  async findLinePrices(
    organizationId: string,
    orderIds: string[],
    lineItemIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (orderIds.length === 0 || lineItemIds.length === 0) return new Map();
    const rows = await this.prisma.podOrderItem.findMany({
      where: {
        organizationId,
        orderId: { in: [...new Set(orderIds)] },
        tiktokLineItemId: { in: [...new Set(lineItemIds)] },
      },
      select: { tiktokLineItemId: true, salePrice: true },
    });
    const prices = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      if (row.salePrice !== null) prices.set(row.tiktokLineItemId, new Prisma.Decimal(row.salePrice));
    }
    return prices;
  }

  createRequest(
    tx: Prisma.TransactionClient,
    data: Prisma.PodReturnRequestUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return tx.podReturnRequest.create({ data, select: { id: true } });
  }

  async updateRequest(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.PodReturnRequestUncheckedUpdateInput,
  ): Promise<void> {
    await tx.podReturnRequest.update({ where: { id }, data });
  }

  /** Thay dòng hàng: upsert theo `return_line_item_id`, dòng không còn trong TikTok ⇒ xoá mềm. */
  async replaceItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    returnRequestId: string,
    items: Array<MappedReturn['items'][number] & { paidAmount: Prisma.Decimal | null }>,
  ): Promise<void> {
    for (const item of items) {
      const data = {
        orderLineItemId: item.orderLineItemId,
        productName: item.productName,
        skuId: item.skuId,
        skuName: item.skuName,
        sellerSku: item.sellerSku,
        productImageUrl: item.productImageUrl,
        currency: item.currency,
        refundTotal: item.refundTotal,
        refundSubtotal: item.refundSubtotal,
        paidAmount: item.paidAmount,
        deletedAt: null,
      };
      await tx.podReturnRequestItem.upsert({
        where: { returnRequestId_returnLineItemId: { returnRequestId, returnLineItemId: item.returnLineItemId } },
        create: { ...data, organizationId, returnRequestId, returnLineItemId: item.returnLineItemId },
        update: data,
      });
    }
    await tx.podReturnRequestItem.updateMany({
      where: {
        returnRequestId,
        deletedAt: null,
        returnLineItemId: { notIn: items.map((item) => item.returnLineItemId) },
      },
      data: { deletedAt: new Date() },
    });
  }

  /** Chạm `last_synced_at` của yêu cầu không đổi — một câu cho cả lô. */
  async touchSynced(organizationId: string, ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.podReturnRequest.updateMany({
      where: { organizationId, id: { in: ids } },
      data: { lastSyncedAt: at },
    });
  }

  /** Thông tin người / shop cho thông báo (Seller = Employee phụ trách kết nối). */
  async findNotificationParty(organizationId: string, accountId: string, shopId: string) {
    const account = await this.prisma.podTiktokAccount.findFirst({
      where: { id: accountId, organizationId },
      select: {
        accountName: true,
        shops: { where: { id: shopId, organizationId }, select: { name: true } },
        seller: { select: { deletedAt: true, user: { select: { fullName: true, email: true } } } },
      },
    });
    if (!account) return { sellerName: null, accountName: null, shopName: null };
    return {
      accountName: account.accountName,
      shopName: account.shops[0]?.name ?? null,
      sellerName:
        account.seller && !account.seller.deletedAt
          ? account.seller.user?.fullName?.trim() || account.seller.user?.email || null
          : null,
    };
  }

  // ---------------------------------------------------------------------------
  // WHERE dùng chung
  // ---------------------------------------------------------------------------

  /**
   * 🔴 Phạm vi shop là TRẦN CỨNG: bộ lọc shop chỉ thu hẹp thêm trong phạm vi (giao), không bao giờ nới.
   * Phạm vi rỗng ⇒ FALSE (không thấy gì).
   */
  whereSql(organizationId: string, params: PodReturnFilterParams): Prisma.Sql {
    const conds: Prisma.Sql[] = [
      Prisma.sql`r.organization_id = ${organizationId}::uuid`,
      Prisma.sql`r.deleted_at IS NULL`,
    ];
    if (params.shopScope !== undefined) {
      conds.push(
        params.shopScope.length === 0
          ? Prisma.sql`FALSE`
          : Prisma.sql`r.shop_id IN (${Prisma.join(params.shopScope.map((id) => Prisma.sql`${id}::uuid`))})`,
      );
    }
    if (params.shopId) conds.push(Prisma.sql`r.shop_id = ${params.shopId}::uuid`);
    if (params.accountId) conds.push(Prisma.sql`r.account_id = ${params.accountId}::uuid`);
    if (params.search) {
      const pattern = `%${params.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      conds.push(Prisma.sql`(r.tiktok_order_id ILIKE ${pattern} OR r.tiktok_return_id ILIKE ${pattern})`);
    }
    if (params.returnType) conds.push(Prisma.sql`r.return_type = ${params.returnType}`);
    if (params.statusGroup) conds.push(Prisma.sql`r.status_group = ${params.statusGroup}::"pod_return_status_group"`);
    if (params.returnStatus) conds.push(Prisma.sql`r.return_status = ${params.returnStatus}`);
    if (params.reason) conds.push(Prisma.sql`r.return_reason = ${params.reason}`);
    const column = Prisma.raw(params.dateField === 'updatedAt' ? 'r.tiktok_updated_at' : 'r.requested_at');
    if (params.from) conds.push(Prisma.sql`${column} >= ${params.from}`);
    if (params.before) conds.push(Prisma.sql`${column} < ${params.before}`);
    return Prisma.join(conds, ' AND ');
  }

  /** Giá trị đang có (cho các ô lọc) trong phạm vi người dùng. */
  async filterOptions(organizationId: string, shopScope: string[] | undefined) {
    const where = this.whereSql(organizationId, { shopScope, dateField: 'requestedAt' });
    const [types, statuses, reasons] = await Promise.all([
      this.prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        SELECT DISTINCT r.return_type AS value FROM pod_return_requests r WHERE ${where} ORDER BY 1`),
      this.prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        SELECT DISTINCT r.return_status AS value FROM pod_return_requests r WHERE ${where} ORDER BY 1`),
      this.prisma.$queryRaw<Array<{ value: string; label: string | null }>>(Prisma.sql`
        SELECT r.return_reason AS value, MAX(r.return_reason_text) AS label
          FROM pod_return_requests r WHERE ${where} AND r.return_reason IS NOT NULL
         GROUP BY r.return_reason ORDER BY 2 NULLS LAST, 1 LIMIT 200`),
    ]);
    return {
      returnTypes: types.map((row) => row.value),
      returnStatuses: statuses.map((row) => row.value),
      reasons: reasons.map((row) => ({ value: row.value, label: row.label })),
    };
  }
}
