import {
  calculateOrderFinancials,
  type FinanceTransactionInput,
  type OrderFinancialsInput,
} from './order-financials';

/**
 * Tài chính cột "Giá": proceeds · base cost · phí ship Seller · label · profit · margin.
 *
 * Luật được khoá: settled THẮNG estimated; profit = proceeds − product cost − phí ship Seller CHƯA trong
 * proceeds − label (MỘT lần mỗi đơn); margin = profit ÷ proceeds; thiếu dữ kiện ⇒ null + lý do, không lấp 0.
 */

/** Breakdown phí ship đúng hình dạng TikTok (khoá snake_case, số tiền dạng chuỗi). */
function shippingBreakdown(actual: string, sellerDiscount: string, platformDiscount = '0') {
  return {
    actual_shipping_fee_amount: actual,
    customer_paid_shipping_fee_amount: '0',
    shipping_fee_discount_amount: platformDiscount,
    supplementary_component: {
      fbm_shipping_cost_amount: actual,
      seller_shipping_fee_discount_amount: sellerDiscount,
      platform_shipping_fee_discount_amount: platformDiscount,
    },
  };
}

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

/** Ước tính CHƯA có phí ship (TikTok chưa tính): est_shipping_cost = 0, actual = 0. */
function notChargedYet(amount: number, sellerDiscount: string, platformDiscount = '0'): FinanceTransactionInput {
  return tx(amount, {
    shippingCostAmount: 0,
    shippingCostBreakdown: shippingBreakdown('0', sellerDiscount, platformDiscount),
  });
}

const COST = { productCost: 4, productCostConfirmed: true, currency: 'USD', fulfilledBy: 'Mango US' };
const TIKTOK_SHIPPING = { shippingType: 'TIKTOK', sellerShippingDiscount: null };
const LABEL = { amount: 0.5, currency: 'USD' };

function input(over: Partial<OrderFinancialsInput>): OrderFinancialsInput {
  return { settled: [], unsettled: [], cost: COST, shipping: TIKTOK_SHIPPING, labelCost: LABEL, ...over };
}

describe('calculateOrderFinancials', () => {
  it('đơn ĐÃ quyết toán ⇒ proceeds = settlement_amount (đã trừ ship); profit = proceeds − base − label', () => {
    const result = calculateOrderFinancials(input({ settled: [tx(8.64)] }));

    expect(result.proceeds).toMatchObject({ source: 'SETTLED', amount: 8.64, currency: 'USD' });
    // Phí ship 4.99 ĐÃ nằm trong settlement_amount ⇒ hiển thị nhưng KHÔNG trừ lại.
    expect(result.sellerShipping).toEqual({ amount: 4.99, includedInProceeds: true, source: 'SETTLEMENT' });
    expect(result.profit).toBe(4.14);
    expect(result.margin).toBeCloseTo(4.14 / 8.64, 4);
    expect(result.status).toBe('OK');
    expect(result.fulfilledBy).toBe('Mango US');
  });

  it('🔴 có cả settled lẫn estimated ⇒ settled THẮNG (số thật thay số ước tính)', () => {
    const result = calculateOrderFinancials(input({ settled: [tx(8.64)], unsettled: [tx(9.5)] }));

    expect(result.proceeds?.source).toBe('SETTLED');
    expect(result.proceeds?.amount).toBe(8.64);
  });

  it('chưa quyết toán ⇒ dùng est_settlement_amount, đánh dấu ESTIMATED', () => {
    const result = calculateOrderFinancials(
      input({ unsettled: [tx(9.5, { estimatedSettlement: '7 days after delivery' })] }),
    );

    expect(result.proceeds).toMatchObject({
      source: 'ESTIMATED',
      amount: 9.5,
      estimatedSettlement: '7 days after delivery',
    });
    // est_shipping_cost −4.99 ⇒ TikTok đã tính, đã nằm trong ước tính.
    expect(result.sellerShipping).toMatchObject({ amount: 4.99, includedInProceeds: true, source: 'TIKTOK_CHARGED' });
    expect(result.profit).toBe(5);
  });

  it('breakdown nguyên văn chỉ khi đơn có ĐÚNG MỘT giao dịch (nhiều ⇒ không tự gộp)', () => {
    const one = calculateOrderFinancials(input({ settled: [tx(8)] }));
    const two = calculateOrderFinancials(input({ settled: [tx(8), tx(2)] }));

    expect(one.proceeds?.revenueBreakdown).toEqual({ subtotal_before_discount_amount: '19.99' });
    expect(two.proceeds?.amount).toBe(10);
    expect(two.proceeds?.revenueBreakdown).toBeNull();
    expect(two.proceeds?.transactionCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Bộ test bắt buộc của yêu cầu (TEST 1 – 10)
  // -------------------------------------------------------------------------

  it('TEST 1 — ship trước giảm $14.92, sau giảm $0, TikTok xác định Seller chịu $X ⇒ sellerShipping = X (KHÔNG phải 0)', () => {
    const result = calculateOrderFinancials(input({ unsettled: [notChargedYet(10, '-14.92')] }));

    expect(result.sellerShipping).toEqual({
      amount: 14.92,
      includedInProceeds: false,
      source: 'SELLER_SHIPPING_DISCOUNT',
    });
    expect(result.profit).toBe(-9.42); // 10 − 4 − 14.92 − 0.50
  });

  it('TEST 2 — Seller shipping $0 ⇒ 10 − 4 − 0 − 0.50 = 5.50', () => {
    const result = calculateOrderFinancials(input({ unsettled: [notChargedYet(10, '0')] }));

    expect(result.sellerShipping?.amount).toBe(0);
    expect(result.profit).toBe(5.5);
  });

  it('TEST 3 — Seller shipping $2.50 (chưa trừ trong ước tính) ⇒ 10 − 4 − 2.50 − 0.50 = 3.00', () => {
    const result = calculateOrderFinancials(input({ unsettled: [notChargedYet(10, '-2.50')] }));

    expect(result.profit).toBe(3);
    expect(result.margin).toBe(0.3);
  });

  it('TEST 4 — đơn 3 sản phẩm: base 12, ship 3, est 20 ⇒ 4.50; label CHỈ 0.50 cho cả đơn', () => {
    const result = calculateOrderFinancials(
      input({ unsettled: [notChargedYet(20, '-3')], cost: { ...COST, productCost: 12 } }),
    );

    expect(result.labelCost).toBe(0.5);
    expect(result.profit).toBe(4.5);
  });

  it('TEST 5 — TikTok chưa có dữ liệu phí ship ⇒ sellerShipping = null, profit = null (KHÔNG mặc định 0)', () => {
    const noBreakdown = tx(10, { shippingCostAmount: 0, shippingCostBreakdown: null });
    const result = calculateOrderFinancials(input({ unsettled: [noBreakdown] }));

    expect(result.sellerShipping).toBeNull();
    expect(result.profit).toBeNull();
    expect(result.status).toBe('SHIPPING_UNKNOWN');
  });

  it('TEST 5b — breakdown thiếu nhưng Get Order Detail có shipping_fee_seller_discount ⇒ dùng nguồn dự phòng', () => {
    const noBreakdown = tx(10, { shippingCostAmount: 0, shippingCostBreakdown: null });
    const result = calculateOrderFinancials(
      input({ unsettled: [noBreakdown], shipping: { shippingType: 'TIKTOK', sellerShippingDiscount: 5.97 } }),
    );

    expect(result.sellerShipping).toEqual({ amount: 5.97, includedInProceeds: false, source: 'ORDER_DETAIL' });
    expect(result.profit).toBe(-0.47);
  });

  it('TEST 9 — TikTok/platform chịu 100% ship ⇒ Seller shipping $0; profit chỉ trừ base + 0.50', () => {
    const result = calculateOrderFinancials(input({ unsettled: [notChargedYet(10, '0', '14.92')] }));

    expect(result.sellerShipping?.amount).toBe(0);
    expect(result.profit).toBe(5.5);
  });

  it('TEST 10 — Seller chịu MỘT PHẦN ship ⇒ chỉ trừ phần Seller chịu, không trừ toàn bộ phí ship của buyer', () => {
    // Phí ship 14.92: platform tài trợ 10, Seller tài trợ 4.92.
    const result = calculateOrderFinancials(input({ unsettled: [notChargedYet(10, '-4.92', '10')] }));

    expect(result.sellerShipping?.amount).toBe(4.92);
    expect(result.profit).toBe(0.58);
  });

  it('🔴 TikTok ĐÃ tính phí ship trong ước tính ⇒ KHÔNG trừ lần hai (dữ liệu thật: 0.69 = 7.44 − 0.78 − 5.97)', () => {
    const charged = tx(0.69, {
      revenueAmount: 7.44,
      feeTaxAmount: -0.78,
      shippingCostAmount: -5.97,
      shippingCostBreakdown: shippingBreakdown('-5.97', '-5.97'),
    });
    const result = calculateOrderFinancials(input({ unsettled: [charged] }));

    expect(result.sellerShipping).toEqual({ amount: 5.97, includedInProceeds: true, source: 'TIKTOK_CHARGED' });
    expect(result.profit).toBe(-3.81); // 0.69 − 4 − 0.50
  });

  it('đơn tự vận chuyển (SELLER) chưa có phí ship TikTok ⇒ không biết Seller trả bao nhiêu ⇒ SHIPPING_UNKNOWN', () => {
    const result = calculateOrderFinancials(
      input({
        unsettled: [notChargedYet(10, '-5')],
        shipping: { shippingType: 'SELLER', sellerShippingDiscount: 5 },
      }),
    );

    expect(result.status).toBe('SHIPPING_UNKNOWN');
    expect(result.profit).toBeNull();
  });

  it('label cấu hình đổi (ORDER_LABEL_COST = 0.75) ⇒ lợi nhuận đổi theo, không sửa code', () => {
    const result = calculateOrderFinancials(
      input({ unsettled: [notChargedYet(10, '0')], labelCost: { amount: 0.75, currency: 'USD' } }),
    );

    expect(result.profit).toBe(5.25);
  });

  it.each([
    ['NO_PROCEEDS', input({})],
    ['NO_COST', input({ settled: [tx(8)], cost: null })],
    ['COST_PENDING', input({ settled: [tx(8)], cost: { ...COST, productCostConfirmed: false } })],
    ['COST_CURRENCY_UNKNOWN', input({ settled: [tx(8)], cost: { ...COST, currency: null } })],
    ['CURRENCY_MISMATCH', input({ settled: [tx(8)], cost: { ...COST, currency: 'VND' } })],
    ['SHIPPING_UNKNOWN', input({ settled: [tx(8, { shippingCostAmount: null })] })],
    ['LABEL_CURRENCY_MISMATCH', input({ settled: [tx(8)], labelCost: { amount: 0.5, currency: 'GBP' } })],
  ] as Array<[string, OrderFinancialsInput]>)('🔴 %s ⇒ profit/margin = null (không lấp 0)', (status, value) => {
    const result = calculateOrderFinancials(value);

    expect(result.status).toBe(status);
    expect(result.profit).toBeNull();
    expect(result.margin).toBeNull();
  });

  it('proceeds ≤ 0 ⇒ vẫn có profit, margin = null (không chia cho 0 / số âm)', () => {
    const result = calculateOrderFinancials(input({ settled: [tx(0)] }));

    expect(result.profit).toBe(-4.5);
    expect(result.margin).toBeNull();
  });

  it('giao dịch thiếu settlement_amount không được coi là 0', () => {
    const result = calculateOrderFinancials(input({ settled: [tx(null)] }));

    expect(result.proceeds).toBeNull();
    expect(result.status).toBe('NO_PROCEEDS');
  });
});
