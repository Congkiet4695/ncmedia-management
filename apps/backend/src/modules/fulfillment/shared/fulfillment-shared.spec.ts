import { BadRequestException } from '@nestjs/common';
import { FulfillmentStatus } from '@prisma/client';
import {
  SUBMITTABLE_FULFILLMENT_STATUSES,
  attemptExternalId,
  isNewAttemptOnSubmit,
} from './fulfillment-lifecycle';
import { productCostOf } from './product-cost';
import { assertPublicHttpsUrl } from './public-url';

describe('fulfillment-lifecycle', () => {
  it('lần 1 giữ nguyên mã gốc; fulfill lại ⇒ hậu tố -R{n} tất định', () => {
    expect(attemptExternalId('NC-5760001', 1, 40)).toBe('NC-5760001');
    expect(attemptExternalId('NC-5760001', 2, 40)).toBe('NC-5760001-R2');
    expect(attemptExternalId('NC-5760001', 3, 40)).toBe('NC-5760001-R3');
  });

  it('🔴 quá độ dài ⇒ cắt phần GỐC, luôn giữ hậu tố (không quay về mã đã bị tiêu thụ)', () => {
    const id = attemptExternalId('X'.repeat(40), 2, 40);
    expect(id).toHaveLength(40);
    expect(id.endsWith('-R2')).toBe(true);
  });

  it('CANCELLED ⇒ gửi được, và là một LẦN THỬ MỚI', () => {
    expect(SUBMITTABLE_FULFILLMENT_STATUSES).toContain(FulfillmentStatus.CANCELLED);
    expect(isNewAttemptOnSubmit(FulfillmentStatus.CANCELLED)).toBe(true);
    expect(isNewAttemptOnSubmit(FulfillmentStatus.FAILED)).toBe(false);
    expect(SUBMITTABLE_FULFILLMENT_STATUSES).not.toContain(FulfillmentStatus.SHIPPED);
    expect(SUBMITTABLE_FULFILLMENT_STATUSES).not.toContain(FulfillmentStatus.SUBMITTED);
  });
});

describe('productCostOf — base cost = Σ product cost của MỌI dòng', () => {
  const confirmedAt = new Date();

  it('🔴 nhiều dòng / nhiều quantity ⇒ cộng đủ, không chỉ dòng đầu', () => {
    const result = productCostOf(true, [
      { baseCost: 8.25, baseCostConfirmedAt: confirmedAt, quantity: 1 },
      { baseCost: 10, baseCostConfirmedAt: confirmedAt, quantity: 2 },
    ]);

    expect(result).toEqual({ productCost: 28.25, productCostConfirmed: true, baseCostPending: false });
  });

  it('🔴 còn dòng mới là ảnh chụp giá catalog ⇒ chưa xác nhận, "chờ báo giá"', () => {
    const result = productCostOf(true, [
      { baseCost: 8.25, baseCostConfirmedAt: confirmedAt, quantity: 1 },
      { baseCost: 9, baseCostConfirmedAt: null, quantity: 1 },
    ]);

    expect(result.productCostConfirmed).toBe(false);
    expect(result.baseCostPending).toBe(true);
  });

  it('dòng không có giá nào ⇒ tổng null (không coi là 0)', () => {
    expect(productCostOf(true, [{ baseCost: null, baseCostConfirmedAt: null, quantity: 1 }]).productCost).toBeNull();
  });

  it('chưa gửi ⇒ không "chờ báo giá"', () => {
    expect(productCostOf(false, [{ baseCost: 5, baseCostConfirmedAt: null, quantity: 1 }]).baseCostPending).toBe(false);
  });
});

describe('assertPublicHttpsUrl — design nguồn URL', () => {
  it('HTTPS công khai ⇒ nhận (cắt khoảng trắng)', () => {
    expect(assertPublicHttpsUrl('  https://cdn.example.com/a/front.png ')).toBe(
      'https://cdn.example.com/a/front.png',
    );
  });

  it.each([
    ['http://cdn.example.com/a.png', 'NOT_HTTPS'],
    ['https://localhost/a.png', 'NOT_PUBLIC'],
    ['https://127.0.0.1/a.png', 'NOT_PUBLIC'],
    ['https://192.168.1.10/a.png', 'NOT_PUBLIC'],
    ['https://10.0.0.5/a.png', 'NOT_PUBLIC'],
    ['https://printer.local/a.png', 'NOT_PUBLIC'],
    ['https://user:pass@cdn.example.com/a.png', 'CREDENTIALS_IN_URL'],
    ['khong-phai-url', 'MALFORMED'],
  ])('🔴 %s ⇒ 400 (%s)', (url, reason) => {
    try {
      assertPublicHttpsUrl(url);
      throw new Error('phải ném lỗi');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_DESIGN_URL_INVALID',
        details: { reason },
      });
    }
  });
});
