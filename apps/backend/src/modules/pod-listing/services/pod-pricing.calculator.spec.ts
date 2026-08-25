import { Prisma, PodPricingMarkupType } from '@prisma/client';
import { calculatePricing, type PricingInput } from './pod-pricing.calculator';

const D = (value: string | number) => new Prisma.Decimal(value);

function input(over: Partial<PricingInput> = {}): PricingInput {
  return {
    cost: D('5'),
    shippingCost: D('2'),
    markupType: PodPricingMarkupType.PERCENT,
    markupValue: D('100'),
    formula: null,
    retailPriceMultiplier: D('1'),
    discountPercent: D('0'),
    roundingIncrement: D('0'),
    currency: 'USD',
    ...over,
  };
}

describe('calculatePricing', () => {
  it('PERCENT: (cost + shipping) × (1 + markup%)', () => {
    const result = calculatePricing(input());
    // (5 + 2) × 2 = 14
    expect(result.salePrice.toString()).toBe('14');
    expect(result.currency).toBe('USD');
  });

  it('FIXED: cost + shipping + markup', () => {
    const result = calculatePricing(
      input({ markupType: PodPricingMarkupType.FIXED, markupValue: D('8.5') }),
    );
    expect(result.salePrice.toString()).toBe('15.5');
  });

  it('FORMULA: chạy biểu thức người dùng nhập trên các biến trong danh sách trắng', () => {
    const result = calculatePricing(
      input({
        markupType: PodPricingMarkupType.FORMULA,
        formula: '(cost + shipping) * 1.8 + 2',
      }),
    );
    // (5 + 2) × 1.8 + 2 = 14.6
    expect(result.salePrice.toString()).toBe('14.6');
  });

  it('FORMULA: biến `base` = cost + shipping, `markup` = markupValue', () => {
    const result = calculatePricing(
      input({
        markupType: PodPricingMarkupType.FORMULA,
        markupValue: D('3'),
        formula: 'base * 2 - markup',
      }),
    );
    // (5 + 2) × 2 − 3 = 11
    expect(result.salePrice.toString()).toBe('11');
  });

  it('FORMULA: công thức để trống ⇒ quay về giá vốn thay vì ném lỗi giữa lúc sinh listing', () => {
    const result = calculatePricing(
      input({ markupType: PodPricingMarkupType.FORMULA, formula: null }),
    );
    expect(result.salePrice.toString()).toBe('7');
  });

  it('giá gốc (gạch ngang) = giá bán × hệ số', () => {
    const result = calculatePricing(input({ retailPriceMultiplier: D('1.5') }));
    expect(result.salePrice.toString()).toBe('14');
    expect(result.retailPrice.toString()).toBe('21');
  });

  it('giá sau khuyến mãi = giá bán × (1 − discount%)', () => {
    const result = calculatePricing(input({ discountPercent: D('25') }));
    expect(result.finalPrice.toString()).toBe('10.5');
    // Giá bán KHÔNG bị giảm — khuyến mãi là giá hiển thị, không phải giá niêm yết.
    expect(result.salePrice.toString()).toBe('14');
  });

  it('🔴 làm tròn LÊN theo bước (không làm tròn xuống = không tự ăn vào lãi)', () => {
    const result = calculatePricing(
      input({
        cost: D('6.2'),
        shippingCost: D('0'),
        markupValue: D('0'),
        roundingIncrement: D('0.99'),
      }),
    );
    // 6.2 → bội số 0.99 gần nhất tính LÊN = 6.93
    expect(result.salePrice.toString()).toBe('6.93');
  });

  it('bước làm tròn = 0 ⇒ giữ nguyên giá tính được', () => {
    const result = calculatePricing(
      input({ cost: D('5.13'), shippingCost: D('0'), markupValue: D('0') }),
    );
    expect(result.salePrice.toString()).toBe('5.13');
  });

  it('giữ độ chính xác thập phân (không dùng số thực nhị phân)', () => {
    const result = calculatePricing(
      input({
        cost: D('0.1'),
        shippingCost: D('0.2'),
        markupType: PodPricingMarkupType.FIXED,
        markupValue: D('0'),
      }),
    );
    // 0.1 + 0.2 phải ra đúng 0.3 — với `number` của JS sẽ là 0.30000000000000004.
    expect(result.salePrice.toString()).toBe('0.3');
  });

  it('mọi giá đều làm tròn về 2 chữ số thập phân', () => {
    const result = calculatePricing(
      input({ cost: D('3.333'), shippingCost: D('0'), markupValue: D('0') }),
    );
    expect(result.salePrice.toString()).toBe('3.33');
  });
});
