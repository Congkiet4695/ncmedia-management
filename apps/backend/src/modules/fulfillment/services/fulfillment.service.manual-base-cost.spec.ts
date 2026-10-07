import 'reflect-metadata';
import { FulfillmentProvider, FulfillmentStatus, Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { EMPLOYEE_DEFAULT_PERMISSIONS } from '../../auth/constants/default-roles';
import { PodShopForbiddenException, type PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { FulfillmentController } from '../controllers/fulfillment.controller';
import type { UpdateManualBaseCostDto } from '../dto/fulfillment.dto';
import {
  FulfillmentManualBaseCostInvalidException,
  FulfillmentOrderNotFoundException,
} from '../exceptions/fulfillment.exceptions';
import { calculateOrderFinancials } from '../../pod-tiktok/shared/order-financials';
import { productCostOf } from '../shared/product-cost';
import { FulfillmentService } from './fulfillment.service';

/**
 * **Cập nhật Base Cost thủ công** — đơn đã fulfill mà hệ thống chưa có giá vốn (đơn cũ).
 * Repository giả lập DB; mọi luật nghiệp vụ là code thật.
 */
const ORG = 'org-1';
const ADMIN_ID = 'admin-1';
const POD_ORDER = 'pod-order-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'ful-1',
    organizationId: ORG,
    provider: FulfillmentProvider.SELLERWIX,
    providerOrderId: 'swx-1',
    status: FulfillmentStatus.SHIPPED,
    submittedAt: new Date('2026-10-02T03:57:00Z'),
    currency: 'USD',
    items: [
      {
        id: 'fi-1',
        providerSku: 'SW-PF-PLPPP-WH-24X36',
        quantity: 1,
        baseCost: null as Prisma.Decimal | null,
        baseCostConfirmedAt: null as Date | null,
      },
    ],
    ...over,
  };
}

function build(options: { record?: ReturnType<typeof record> | null; shopOfOrder?: string } = {}) {
  let current = options.record === undefined ? record() : options.record;
  const repo = {
    findCurrentByPodOrder: jest.fn(() => Promise.resolve(current)),
    applyManualItemCosts: jest.fn(
      (params: { costs: Array<{ id: string; baseCost: number }>; currency: string | null }) => {
        if (current) {
          current = {
            ...current,
            currency: params.currency ?? current.currency,
            items: current.items.map((item) => {
              const cost = params.costs.find((entry) => entry.id === item.id);
              return cost
                ? { ...item, baseCost: new Prisma.Decimal(cost.baseCost), baseCostConfirmedAt: new Date() }
                : item;
            }),
          };
        }
        return Promise.resolve();
      },
    ),
  };
  const podOrderRepo = {
    findById: jest.fn().mockResolvedValue({ id: POD_ORDER, shopId: options.shopOfOrder ?? 'shop-1' }),
  };
  const accessScope = {
    assertShopAllowed: (scope: PodAccessScope, shopId: string) => {
      if (!scope.allShops && !scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    },
  };
  const service = new FulfillmentService(
    { get: () => undefined } as never,
    {} as never,
    repo as never,
    podOrderRepo as never,
    {} as never,
    {} as never,
    {} as never,
    accessScope as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(service, 'toOrderDto').mockImplementation((value) => value as never);
  return { service, repo, current: () => current };
}

const dto = (over: Partial<UpdateManualBaseCostDto> = {}): UpdateManualBaseCostDto => ({
  items: [{ itemId: 'fi-1', baseCost: 9.12 }],
  ...over,
});

describe('FulfillmentService.updateBaseCostManually', () => {
  it('đơn đã fulfill chưa có giá ⇒ ghi giá MỌI dòng + nhật ký BASE_COST_MANUAL_UPDATED (cũ/mới/lý do/người làm)', async () => {
    const h = build();

    await h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto({ reason: 'Hoá đơn Sellerwix #123' }), ADMIN);

    const call = h.repo.applyManualItemCosts.mock.calls[0][0] as unknown as {
      fulfillmentOrderId: string;
      costs: unknown;
      currency: string | null;
      history: { eventType: string; performedBy: string; payload: Record<string, unknown>; message: string };
    };
    expect(call.fulfillmentOrderId).toBe('ful-1');
    expect(call.costs).toEqual([{ id: 'fi-1', baseCost: 9.12 }]);
    // Bản ghi đã có USD ⇒ không ghi đè đơn vị tiền.
    expect(call.currency).toBeNull();
    expect(call.history).toMatchObject({ eventType: 'BASE_COST_MANUAL_UPDATED', performedBy: ADMIN_ID });
    expect(call.history.payload).toMatchObject({
      before: [{ itemId: 'fi-1', baseCost: null, confirmed: false }],
      after: [{ itemId: 'fi-1', baseCost: 9.12 }],
      currencyAfter: 'USD',
      reason: 'Hoá đơn Sellerwix #123',
    });
    expect(call.history.message).toContain('9.12 USD');
  });

  it('🔴 Lợi nhuận / Margin tính lại NGAY từ giá vừa nhập (cùng công thức của cột Lợi nhuận)', async () => {
    const h = build();
    await h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto(), ADMIN);

    const fresh = h.current()!;
    const cost = productCostOf(true, fresh.items);
    const financials = calculateOrderFinancials({
      settled: [],
      unsettled: [
        {
          currency: 'USD',
          settlementAmount: 18.17,
          revenueAmount: null,
          feeTaxAmount: null,
          shippingCostAmount: null,
          adjustmentAmount: null,
          revenueBreakdown: null,
          feeTaxBreakdown: null,
          shippingCostBreakdown: null,
        },
      ],
      cost: { productCost: cost.productCost, productCostConfirmed: cost.productCostConfirmed, currency: fresh.currency, fulfilledBy: 'Sellerwix' },
      // Free ship do Seller tài trợ 0 (Get Order Detail) ⇒ phí ship Seller 0; label 0.50 / đơn.
      shipping: { shippingType: 'TIKTOK', sellerShippingDiscount: 0 },
      labelCost: { amount: 0.5, currency: 'USD' },
    });
    // TEST 8: đổi base cost sau fulfill ⇒ lợi nhuận tính lại ngay: 18.17 − 9.12 − 0 − 0.50.
    expect(financials).toMatchObject({ status: 'OK', productCost: 9.12, profit: 8.55 });
    expect(financials.margin).toBeCloseTo(8.55 / 18.17, 4);
  });

  it('bản ghi CHƯA có đơn vị tiền ⇒ phải gửi currency; có thì ghi kèm', async () => {
    const missing = build({ record: record({ currency: null }) });
    await expect(missing.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto(), ADMIN)).rejects.toMatchObject({
      response: { code: 'FULFILLMENT_BASE_COST_INVALID', details: { reason: 'CURRENCY_REQUIRED' } },
    });

    const provided = build({ record: record({ currency: null }) });
    await provided.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto({ currency: 'USD' }), ADMIN);
    expect((provided.repo.applyManualItemCosts.mock.calls[0][0] as unknown as { currency: string }).currency).toBe('USD');
  });

  it.each([
    ['đổi đơn vị tiền đã có', dto({ currency: 'EUR' }), 'CURRENCY_MISMATCH'],
    ['quá số lẻ của USD (9.123)', dto({ items: [{ itemId: 'fi-1', baseCost: 9.123 }] }), 'TOO_MANY_DECIMALS'],
    ['dòng không thuộc lần fulfill', dto({ items: [{ itemId: 'fi-1', baseCost: 1 }, { itemId: 'fi-x', baseCost: 1 }] }), 'UNKNOWN_ITEM'],
    ['một dòng hai lần', dto({ items: [{ itemId: 'fi-1', baseCost: 1 }, { itemId: 'fi-1', baseCost: 2 }] }), 'DUPLICATE_ITEM'],
  ])('🔴 %s ⇒ 400, KHÔNG ghi gì', async (_label, body, reason) => {
    const h = build();
    const error = await h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, body, ADMIN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FulfillmentManualBaseCostInvalidException);
    expect((error as FulfillmentManualBaseCostInvalidException).getResponse()).toMatchObject({ details: { reason } });
    expect(h.repo.applyManualItemCosts).not.toHaveBeenCalled();
  });

  it('🔴 thiếu dòng (đơn 2 dòng, nhập 1) ⇒ 400 MISSING_ITEM — không có đơn "nửa giá vốn"', async () => {
    const base = record();
    const h = build({
      record: { ...base, items: [...base.items, { ...base.items[0], id: 'fi-2' }] },
    });
    await expect(h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto(), ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'MISSING_ITEM' } },
    });
  });

  it.each([FulfillmentStatus.DRAFT, FulfillmentStatus.FAILED, FulfillmentStatus.CANCELLED])(
    '🔴 bản ghi %s (nhà cung cấp chưa / không giữ đơn) ⇒ 400 NOT_SUBMITTED',
    async (status) => {
      const h = build({ record: record({ status }) });
      await expect(h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto(), ADMIN)).rejects.toMatchObject({
        response: { details: { reason: 'NOT_SUBMITTED' } },
      });
    },
  );

  it('🔴 tổ chức lấy từ JWT: đơn không thuộc tổ chức ⇒ 404, không ghi', async () => {
    const h = build({ record: null });
    await expect(h.service.updateBaseCostManually(ORG, ADMIN_ID, POD_ORDER, dto(), ADMIN)).rejects.toBeInstanceOf(
      FulfillmentOrderNotFoundException,
    );
    expect(h.repo.findCurrentByPodOrder).toHaveBeenCalledWith(ORG, POD_ORDER);
    expect(h.repo.applyManualItemCosts).not.toHaveBeenCalled();
  });

  it('🔴 người không có pod.shop.all ⇒ đơn của shop không được gán ⇒ 403', async () => {
    const h = build({ shopOfOrder: 'shop-other' });
    const seller: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };
    await expect(h.service.updateBaseCostManually(ORG, 'seller-1', POD_ORDER, dto(), seller)).rejects.toBeInstanceOf(
      PodShopForbiddenException,
    );
    expect(h.repo.applyManualItemCosts).not.toHaveBeenCalled();
  });
});

describe('Cập nhật Base Cost thủ công — phân quyền', () => {
  it('endpoint đòi quyền RIÊNG fulfillment.basecost.update', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ đọc metadata, không gọi
    const handler = FulfillmentController.prototype.updateBaseCost as unknown as object;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['fulfillment.basecost.update']);
  });

  it('🔴 Seller (EMPLOYEE mặc định) KHÔNG có quyền này dù có fulfillment.create', () => {
    const permissions: readonly string[] = EMPLOYEE_DEFAULT_PERMISSIONS;
    expect(permissions).toContain('fulfillment.create');
    expect(permissions).not.toContain('fulfillment.basecost.update');
  });
});
