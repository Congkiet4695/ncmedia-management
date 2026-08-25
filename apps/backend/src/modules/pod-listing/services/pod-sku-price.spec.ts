import { Prisma } from '@prisma/client';
import { resolveSkuItemPrice } from './pod-sku-price';

/**
 * Giá của một tổ hợp SKU — **nguồn sự thật duy nhất** dùng chung cho lưới SKU, cổng validate
 * và payload gửi TikTok.
 *
 * 🔴 Ca quan trọng nhất: "Retail 19.99 · Sale để trống · giảm 30%". Ô giá bỏ trống trên lưới
 * từng ghi xuống `0`, và `0` bị coi là một giá hợp lệ ⇒ SKU bị chặn với thông điệp "chưa có
 * giá bán hợp lệ" dù người dùng đã khai giá.
 */

const d = (value: string | number | null): Prisma.Decimal | null =>
  value === null ? null : new Prisma.Decimal(value);

const resolve = (retail: string | number | null, sale: string | number | null, discount: string | number | null = null) =>
  resolveSkuItemPrice({ retailPrice: d(retail), salePrice: d(sale), discount: d(discount) });

describe('resolveSkuItemPrice', () => {
  it('Case 1 — Retail 19.99 · Sale 0 · giảm 30% ⇒ bán 13.99, gạch ngang 19.99', () => {
    const result = resolve(19.99, 0, 30);

    expect(result.salePrice?.toString()).toBe('13.99');
    expect(result.retailPrice?.toString()).toBe('19.99');
    expect(result.source).toBe('RETAIL_WITH_DISCOUNT');
  });

  it('Case 2 — Sale khai tường minh thì THẮNG giá gốc', () => {
    const result = resolve(19.99, 15.99, 30);

    expect(result.salePrice?.toString()).toBe('15.99');
    expect(result.retailPrice?.toString()).toBe('19.99');
    expect(result.source).toBe('SALE_PRICE');
  });

  it('Case 3 — Retail 0 · Sale 0 ⇒ chưa có giá', () => {
    expect(resolve(0, 0).salePrice).toBeNull();
    expect(resolve(0, 0).source).toBe('NONE');
  });

  it('Case 4 — Retail null · Sale null ⇒ chưa có giá', () => {
    expect(resolve(null, null).salePrice).toBeNull();
    expect(resolve(null, null).source).toBe('NONE');
  });

  it('Chỉ có Retail, không giảm giá ⇒ bán đúng giá gốc, KHÔNG gạch ngang', () => {
    const result = resolve(19.99, null);

    expect(result.salePrice?.toString()).toBe('19.99');
    // Gạch ngang một con số bằng chính giá bán thì TikTok từ chối, mà hiển thị cũng vô nghĩa.
    expect(result.retailPrice).toBeNull();
    expect(result.source).toBe('RETAIL_PRICE');
  });

  it('Giảm 100% ⇒ coi như CHƯA khai giá, không gửi SKU giá 0 lên sàn', () => {
    expect(resolve(19.99, null, 100).salePrice).toBeNull();
  });

  it('Phần trăm giảm ngoài khoảng (0, 100] bị bỏ qua', () => {
    // `Decimal` bỏ số 0 vô nghĩa ở cuối nên "20.00" in ra là "20" — vẫn là 2 chữ số thập phân
    // khi cần (xem các ca ở trên).
    expect(resolve(20, null, 0).salePrice?.toString()).toBe('20');
    expect(resolve(20, null, -10).salePrice?.toString()).toBe('20');
    expect(resolve(20, null, 150).salePrice?.toString()).toBe('20');
  });

  it('Làm tròn về 2 chữ số thập phân — tiền tệ thật của mọi thị trường', () => {
    // 25.99 − 30% = 18.193
    expect(resolve(25.99, null, 30).salePrice?.toString()).toBe('18.19');
  });

  it('Bảng giá thật của template "Poster" ra đúng con số người dùng mong đợi', () => {
    const rows: Array<[number, string]> = [
      [19.99, '13.99'],
      [22.99, '16.09'],
      [25.99, '18.19'],
      [29.99, '20.99'],
      [34.99, '24.49'],
    ];

    for (const [retail, expected] of rows) {
      expect(resolve(retail, 0, 30).salePrice?.toString()).toBe(expected);
    }
  });
});
