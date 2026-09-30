import {
  calculateOrderFinancials,
  type FinanceTransactionInput,
  type OrderFinancialsInput,
} from './order-financials';

/**
 * Tài chính cột "Giá": proceeds · base cost · profit · margin.
 *
 * Luật được khoá: settled THẮNG estimated; profit = proceeds − product cost; margin = profit ÷
 * proceeds; thiếu dữ kiện ⇒ null + lý do, không bao giờ lấp bằng 0.
 */

function tx(amount: number | null, over: Partial<FinanceTransactionInput> = {}): FinanceTransactionInput {
  return {
    currency: 'USD',
    settlementAmount: amount,
    revenueAmount: 14.5,
    feeTaxAmount: -0.87,
    shippingCostAmount: -4.99,
    adjustmentAmount: 0,
    revenueBreakdown: { subtotal_before_discount_amount: '19.99' },
    feeTaxBreakdown: { fee: { referral_fee_amount: '-0.87' } },
    shippingCostBreakdown: null,
    ...over,
  };
}

const COST = { productCost: 5, productCostConfirmed: true, currency: 'USD', fulfilledBy: 'Mango US' };

describe('calculateOrderFinancials', () => {
  it('đơn ĐÃ quyết toán ⇒ proceeds = settlement_amount; profit = proceeds − product cost; margin = profit ÷ proceeds', () => {
    const result = calculateOrderFinancials({ settled: [tx(8.64)], unsettled: [], cost: COST });

    expect(result.proceeds).toMatchObject({ source: 'SETTLED', amount: 8.64, currency: 'USD' });
    expect(result.profit).toBe(3.64);
    expect(result.margin).toBeCloseTo(3.64 / 8.64, 4);
    expect(result.status).toBe('OK');
    expect(result.fulfilledBy).toBe('Mango US');
  });

  it('🔴 có cả settled lẫn estimated ⇒ settled THẮNG (số thật thay số ước tính)', () => {
    const result = calculateOrderFinancials({
      settled: [tx(8.64)],
      unsettled: [tx(9.5)],
      cost: COST,
    });

    expect(result.proceeds?.source).toBe('SETTLED');
    expect(result.proceeds?.amount).toBe(8.64);
  });

  it('chưa quyết toán ⇒ dùng est_settlement_amount, đánh dấu ESTIMATED', () => {
    const result = calculateOrderFinancials({
      settled: [],
      unsettled: [tx(9.5, { estimatedSettlement: '7 days after delivery' })],
      cost: COST,
    });

    expect(result.proceeds).toMatchObject({
      source: 'ESTIMATED',
      amount: 9.5,
      estimatedSettlement: '7 days after delivery',
    });
    expect(result.profit).toBe(4.5);
  });

  it('breakdown nguyên văn chỉ khi đơn có ĐÚNG MỘT giao dịch (nhiều ⇒ không tự gộp)', () => {
    const one = calculateOrderFinancials({ settled: [tx(8)], unsettled: [], cost: COST });
    const two = calculateOrderFinancials({ settled: [tx(8), tx(2)], unsettled: [], cost: COST });

    expect(one.proceeds?.revenueBreakdown).toEqual({ subtotal_before_discount_amount: '19.99' });
    expect(two.proceeds?.amount).toBe(10);
    expect(two.proceeds?.revenueBreakdown).toBeNull();
    expect(two.proceeds?.transactionCount).toBe(2);
  });

  it.each([
    ['NO_PROCEEDS', { settled: [], unsettled: [], cost: COST }],
    ['NO_COST', { settled: [tx(8)], unsettled: [], cost: null }],
    ['COST_PENDING', { settled: [tx(8)], unsettled: [], cost: { ...COST, productCostConfirmed: false } }],
    ['COST_CURRENCY_UNKNOWN', { settled: [tx(8)], unsettled: [], cost: { ...COST, currency: null } }],
    ['CURRENCY_MISMATCH', { settled: [tx(8)], unsettled: [], cost: { ...COST, currency: 'VND' } }],
  ] as Array<[string, OrderFinancialsInput]>)('🔴 %s ⇒ profit/margin = null (không lấp 0)', (status, input) => {
    const result = calculateOrderFinancials(input);

    expect(result.status).toBe(status);
    expect(result.profit).toBeNull();
    expect(result.margin).toBeNull();
  });

  it('proceeds ≤ 0 ⇒ vẫn có profit, margin = null (không chia cho 0 / số âm)', () => {
    const result = calculateOrderFinancials({ settled: [tx(0)], unsettled: [], cost: COST });

    expect(result.profit).toBe(-5);
    expect(result.margin).toBeNull();
  });

  it('giao dịch thiếu settlement_amount không được coi là 0', () => {
    const result = calculateOrderFinancials({ settled: [tx(null)], unsettled: [], cost: COST });

    expect(result.proceeds).toBeNull();
    expect(result.status).toBe('NO_PROCEEDS');
  });
});
