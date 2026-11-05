import { ConfigService } from '@nestjs/config';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { FulfillmentService } from '../../fulfillment/services/fulfillment.service';
import { PodOrderFinanceService } from './pod-order-finance.service';

/** Base Cost tổng đã import (`pod_orders.base_cost`) đi tới cột Giá / Order detail qua đường đọc này. */
const ORDER = { id: 'pod-1', tiktokOrderId: 'TT-1' };

function summarize(params: {
  baseCost?: string | null;
  items?: Array<Record<string, unknown>> | null;
}) {
  const { baseCost = null, items = null } = params;
  const prisma = {
    podTiktokStatementTransaction: {
      findMany: jest.fn().mockResolvedValue([
        { tiktokOrderId: 'TT-1', currency: 'USD', settlementAmount: new Prisma.Decimal(100), shippingCostAmount: new Prisma.Decimal(0) },
      ]),
    },
    podTiktokUnsettledTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    fulfillmentOrder: {
      findMany: jest.fn().mockResolvedValue(
        items
          ? [{ podOrderId: 'pod-1', submittedAt: new Date(), currency: 'USD', account: { name: 'Mango' }, items }]
          : [],
      ),
    },
    podOrder: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'pod-1',
          shippingType: 'TIKTOK',
          shippingFeeSellerDiscount: new Prisma.Decimal(0),
          designAmount: new Prisma.Decimal(0),
          baseCost: baseCost === null ? null : new Prisma.Decimal(baseCost),
          baseCostCurrency: baseCost === null ? null : 'USD',
        },
      ]),
    },
  };
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  return new PodOrderFinanceService(prisma as never, config).summarize('org-1', [ORDER]);
}

const LINE = (cost: number) => ({ baseCost: new Prisma.Decimal(cost), baseCostConfirmedAt: new Date(), quantity: 1 });

describe('PodOrderFinanceService — giá vốn hiệu lực', () => {
  it('đơn đang giữ đơn, có Base Cost tổng ⇒ thay tổng các dòng, kể cả khi dòng chưa có giá', async () => {
    const result = await summarize({
      baseCost: '15.5',
      items: [{ baseCost: null, baseCostConfirmedAt: null, quantity: 1 }, LINE(3)],
    });
    expect(result.get('pod-1')).toMatchObject({ productCost: 15.5, productCostConfirmed: true, costCurrency: 'USD' });
  });

  it('giá vốn 0 được giữ, không rơi về tổng các dòng', async () => {
    const result = await summarize({ baseCost: '0', items: [LINE(3), LINE(4)] });
    expect(result.get('pod-1')?.productCost).toBe(0);
  });

  it('không có Base Cost tổng ⇒ tổng các dòng như trước', async () => {
    const result = await summarize({ items: [LINE(3), LINE(4)] });
    expect(result.get('pod-1')?.productCost).toBe(7);
  });

  it('đơn chưa fulfill có Base Cost đã lưu ⇒ hiển thị, không tính lợi nhuận', async () => {
    const result = await summarize({ baseCost: '20' });
    expect(result.get('pod-1')).toMatchObject({ productCost: 20, profit: null, status: 'NOT_FULFILLED' });
  });

  it('đơn chưa fulfill, không có giá ⇒ NO_COST như trước', async () => {
    const result = await summarize({});
    expect(result.get('pod-1')).toMatchObject({ productCost: null, profit: null, status: 'NO_COST' });
  });
});

describe('FulfillmentService.toOrderDto — cột Fulfillment đọc giá vốn hiệu lực', () => {
  const dtoOf = (status: FulfillmentStatus, baseCost: Prisma.Decimal | null) => {
    // toOrderDto không đọc `this`, không cần dựng cả service.
    return FulfillmentService.prototype.toOrderDto.call(
      {},
      {
        id: 'ful-1',
        podOrderId: 'pod-1',
        status,
        submittedAt: new Date(),
        currency: null,
        items: [],
        subtotal: null,
        shippingFee: null,
        tax: null,
        total: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        podOrder: { baseCost, baseCostCurrency: baseCost === null ? null : 'USD' },
      } as never,
    );
  };

  it('lần fulfill đang giữ đơn ⇒ dùng Base Cost tổng và đơn vị tiền của nó', () => {
    expect(dtoOf(FulfillmentStatus.SHIPPED, new Prisma.Decimal('15.5'))).toMatchObject({
      productCost: 15.5,
      productCostConfirmed: true,
      baseCostPending: false,
      currency: 'USD',
    });
  });

  it('lần fulfill đã huỷ ⇒ không áp giá tổng', () => {
    expect(dtoOf(FulfillmentStatus.CANCELLED, new Prisma.Decimal('15.5')).productCost).toBeNull();
  });
});
