import { Injectable } from '@nestjs/common';
import { PodStatementTxType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NON_BLOCKING_FULFILLMENT_STATUSES } from '../../fulfillment/shared/fulfillment-lifecycle';
import { productCostOf } from '../../fulfillment/shared/product-cost';
import {
  calculateOrderFinancials,
  type FinanceTransactionInput,
  type OrderFinancials,
} from '../shared/order-financials';

/** Loại giao dịch "đơn hàng" của Get Unsettled Transactions (các loại khác là điều chỉnh). */
const UNSETTLED_ORDER_TYPE = 'ORDER';

/**
 * PodOrderFinanceService — nạp dữ liệu tài chính cho MỘT TRANG đơn và tính bằng
 * \`calculateOrderFinancials\`.
 *
 * 🔴 Ba truy vấn cho cả trang (settled · unsettled · fulfillment), ghép trong bộ nhớ — không N+1.
 * Mọi truy vấn khoá theo \`organizationId\` (ADR-004); tập đơn truyền vào đã được lọc theo phạm vi
 * shop của người gọi ở tầng trên.
 *
 * Đọc thẳng bảng fulfillment qua Prisma (không gọi service module Fulfillment): chiều phụ thuộc là
 * \`fulfillment → pod-tiktok\`; chỉ dùng hai hàm THUẦN của fulfillment (luật trạng thái + product cost)
 * để hai màn hình tính giá vốn đúng MỘT cách.
 */
@Injectable()
export class PodOrderFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(
    organizationId: string,
    orders: Array<{ id: string; tiktokOrderId: string }>,
  ): Promise<Map<string, OrderFinancials>> {
    if (orders.length === 0) return new Map();
    const tiktokIds = orders.map((order) => order.tiktokOrderId);
    const podOrderIds = orders.map((order) => order.id);

    const [settledRows, unsettledRows, fulfillmentRows] = await Promise.all([
      this.prisma.podTiktokStatementTransaction.findMany({
        where: {
          organizationId,
          deletedAt: null,
          type: PodStatementTxType.ORDER,
          tiktokOrderId: { in: tiktokIds },
        },
      }),
      this.prisma.podTiktokUnsettledTransaction.findMany({
        where: {
          organizationId,
          deletedAt: null,
          type: UNSETTLED_ORDER_TYPE,
          tiktokOrderId: { in: tiktokIds },
        },
      }),
      this.prisma.fulfillmentOrder.findMany({
        where: {
          organizationId,
          deletedAt: null,
          podOrderId: { in: podOrderIds },
          // Chỉ lần fulfill ĐANG giữ đơn ở xưởng mới có giá vốn thật (huỷ / hỏng / nháp thì không).
          status: { notIn: [...NON_BLOCKING_FULFILLMENT_STATUSES] },
        },
        include: {
          items: { where: { deletedAt: null } },
          account: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const settled = groupBy(settledRows, (row) => row.tiktokOrderId);
    const unsettled = groupBy(unsettledRows, (row) => row.tiktokOrderId);
    const fulfillment = new Map<string, (typeof fulfillmentRows)[number]>();
    for (const row of fulfillmentRows) {
      if (!fulfillment.has(row.podOrderId)) fulfillment.set(row.podOrderId, row);
    }

    const result = new Map<string, OrderFinancials>();
    for (const order of orders) {
      const record = fulfillment.get(order.id);
      const cost = record ? productCostOf(record.submittedAt !== null, record.items) : null;
      result.set(
        order.id,
        calculateOrderFinancials({
          settled: (settled.get(order.tiktokOrderId) ?? []).map((row) => ({
            currency: row.currency,
            settlementAmount: toNumber(row.settlementAmount),
            revenueAmount: toNumber(row.revenueAmount),
            feeTaxAmount: toNumber(row.feeTaxAmount),
            shippingCostAmount: toNumber(row.shippingCostAmount),
            adjustmentAmount: toNumber(row.adjustmentAmount),
            revenueBreakdown: row.revenueBreakdown,
            feeTaxBreakdown: row.feeTaxBreakdown,
            shippingCostBreakdown: row.shippingCostBreakdown,
          })),
          unsettled: (unsettled.get(order.tiktokOrderId) ?? []).map(
            (row): FinanceTransactionInput => ({
              currency: row.currency,
              settlementAmount: toNumber(row.estSettlementAmount),
              revenueAmount: toNumber(row.estRevenueAmount),
              feeTaxAmount: toNumber(row.estFeeTaxAmount),
              shippingCostAmount: toNumber(row.estShippingCostAmount),
              adjustmentAmount: toNumber(row.estAdjustmentAmount),
              revenueBreakdown: row.revenueBreakdown,
              feeTaxBreakdown: row.feeTaxBreakdown,
              shippingCostBreakdown: row.shippingCostBreakdown,
              estimatedSettlement: row.estimatedSettlement,
              unsettledReason: row.unsettledReason,
            }),
          ),
          cost:
            record && cost
              ? {
                  productCost: cost.productCost,
                  productCostConfirmed: cost.productCostConfirmed,
                  currency: record.currency,
                  fulfilledBy: record.account?.name ?? null,
                }
              : null,
        }),
      );
    }
    return result;
  }
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}
