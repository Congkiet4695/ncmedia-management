import { Prisma } from '@prisma/client';
import {
  computeFlashSalePricing,
  formatPriceForProvider,
  percentOf,
  roundPrice,
  toDecimal,
  validatePricing,
  validateQuantityLimit,
} from './pod-flash-sale-pricing';
import {
  FLASH_SALE_ISSUE_CODES,
  FLASH_SALE_MAX_QUANTITY,
  FLASH_SALE_UNLIMITED,
} from '../constants/pod-flash-sale.constants';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('computeFlashSalePricing', () => {
  it('ví dụ của yêu cầu: Retail 29.99 giảm 30% ⇒ Deal 20.99', () => {
    const result = computeFlashSalePricing({ originalPrice: D('29.99'), discountPercent: 30 });
    expect(result?.flashSalePrice.toString()).toBe('20.99');
  });

  it('nhập thẳng giá deal ⇒ % giảm được tính ngược lại', () => {
    const result = computeFlashSalePricing({ originalPrice: D('29.99'), flashSalePrice: '20.99' });
    // (1 − 20.99/29.99) × 100 = 30.0100...
    expect(result?.discountPercent.toString()).toBe('30.01');
  });

  it('gửi cả hai thì GIÁ DEAL thắng — con số người dùng gõ là ý định rõ ràng nhất', () => {
    const result = computeFlashSalePricing({
      originalPrice: D('100'),
      flashSalePrice: '60',
      discountPercent: 10,
    });
    expect(result?.flashSalePrice.toString()).toBe('60');
    expect(result?.discountPercent.toString()).toBe('40');
  });

  it('% giảm được tính lại từ giá ĐÃ LÀM TRÒN, không giữ nguyên số người dùng nhập', () => {
    // 19.99 × (1 − 0.333) = 13.33333 ⇒ làm tròn 13.33 ⇒ % thật là 33.3167…
    const result = computeFlashSalePricing({ originalPrice: D('19.99'), discountPercent: '33.3' });
    expect(result?.flashSalePrice.toString()).toBe('13.33');
    expect(result?.discountPercent.toString()).toBe('33.3167');
  });

  it('làm tròn HALF_UP tới 2 chữ số — khớp phép nhẩm của người dùng', () => {
    expect(roundPrice(D('10.005')).toString()).toBe('10.01');
    expect(roundPrice(D('10.004')).toString()).toBe('10');
  });

  it('không nhập gì để tính ⇒ null (nơi gọi tự quyết định làm gì)', () => {
    expect(computeFlashSalePricing({ originalPrice: D('29.99') })).toBeNull();
  });

  it('giá gốc bằng 0 hoặc âm ⇒ null, không sinh ra phép chia cho 0', () => {
    expect(computeFlashSalePricing({ originalPrice: D('0'), discountPercent: 30 })).toBeNull();
    expect(computeFlashSalePricing({ originalPrice: D('-5'), discountPercent: 30 })).toBeNull();
  });

  it('giảm 0% được coi là ĐÃ NHẬP, không phải "bỏ trống"', () => {
    // `0` là falsy trong JS. Bộ tính dùng `||` thay vì kiểm null sẽ trả về `null` ở đây và
    // người dùng mất luôn thao tác "đặt lại về 0%" — test này khoá đúng hành vi đó.
    const result = computeFlashSalePricing({ originalPrice: D('29.99'), discountPercent: 0 });
    expect(result?.flashSalePrice.toString()).toBe('29.99');
    expect(result?.discountPercent.toString()).toBe('0');
    // Dòng như vậy ghi được xuống database nhưng KHÔNG qua được cổng publish.
    expect(validatePricing(result!).map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.DISCOUNT_OUT_OF_RANGE,
    );
  });

  it('không dùng số dấu phẩy động: 0.1 + 0.2 không được rò rỉ vào giá tiền', () => {
    const result = computeFlashSalePricing({ originalPrice: D('0.3'), flashSalePrice: '0.30000000000000004' });
    expect(result?.flashSalePrice.toString()).toBe('0.3');
  });
});

describe('toDecimal', () => {
  it('chuỗi rác trả null thay vì ném lỗi thô của thư viện', () => {
    expect(toDecimal('abc')).toBeNull();
    expect(toDecimal('1,5')).toBeNull();
    expect(toDecimal('')).toBeNull();
    expect(toDecimal(null)).toBeNull();
    expect(toDecimal(undefined)).toBeNull();
  });

  it('số 0 là giá trị HỢP LỆ, không bị nhầm thành "chưa nhập"', () => {
    expect(toDecimal(0)?.toString()).toBe('0');
  });
});

describe('percentOf', () => {
  it('giá deal bằng giá gốc ⇒ 0%', () => {
    expect(percentOf(D('29.99'), D('29.99')).toString()).toBe('0');
  });

  it('làm tròn 4 chữ số, khớp Decimal(7,4) của schema', () => {
    expect(percentOf(D('3'), D('1')).toString()).toBe('66.6667');
  });
});

describe('validatePricing', () => {
  const ok = { originalPrice: D('29.99'), flashSalePrice: D('20.99'), discountPercent: D('30') };

  it('bộ giá hợp lệ ⇒ không có lỗi', () => {
    expect(validatePricing(ok)).toEqual([]);
  });

  it('giá âm hoặc bằng 0 ⇒ MỘT lỗi duy nhất, không kéo theo lỗi phái sinh', () => {
    const issues = validatePricing({ ...ok, flashSalePrice: D('0'), discountPercent: D('100') });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(FLASH_SALE_ISSUE_CODES.PRICE_NOT_POSITIVE);
  });

  it('giá deal cao hơn giá niêm yết ⇒ bị chặn', () => {
    const issues = validatePricing({
      originalPrice: D('20'),
      flashSalePrice: D('25'),
      discountPercent: D('-25'),
    });
    expect(issues.map((issue) => issue.code)).toContain(FLASH_SALE_ISSUE_CODES.PRICE_ABOVE_RETAIL);
  });

  it('giá dưới ngưỡng tối thiểu ⇒ bị chặn trước khi gọi TikTok', () => {
    const issues = validatePricing({
      originalPrice: D('1'),
      flashSalePrice: D('0.005'),
      discountPercent: D('99.5'),
    });
    expect(issues.map((issue) => issue.code)).toContain(FLASH_SALE_ISSUE_CODES.PRICE_BELOW_MINIMUM);
  });

  it('giảm 0% ⇒ bị chặn (không phải khuyến mãi)', () => {
    const issues = validatePricing({
      originalPrice: D('29.99'),
      flashSalePrice: D('29.99'),
      discountPercent: D('0'),
    });
    expect(issues.map((issue) => issue.code)).toContain(
      FLASH_SALE_ISSUE_CODES.DISCOUNT_OUT_OF_RANGE,
    );
  });
});

describe('validateQuantityLimit', () => {
  it('-1 nghĩa là không giới hạn ⇒ hợp lệ', () => {
    expect(validateQuantityLimit(FLASH_SALE_UNLIMITED, 'totalPurchaseLimit')).toEqual([]);
  });

  it('biên [1, 99] đều hợp lệ', () => {
    expect(validateQuantityLimit(1, 'x')).toEqual([]);
    expect(validateQuantityLimit(FLASH_SALE_MAX_QUANTITY, 'x')).toEqual([]);
  });

  it('0 KHÔNG hợp lệ — nằm giữa "không giới hạn" (-1) và mức thấp nhất (1)', () => {
    expect(validateQuantityLimit(0, 'x')).toHaveLength(1);
  });

  it('vượt 99 hoặc không phải số nguyên ⇒ bị chặn', () => {
    expect(validateQuantityLimit(100, 'x')).toHaveLength(1);
    expect(validateQuantityLimit(1.5, 'x')).toHaveLength(1);
    expect(validateQuantityLimit(-2, 'x')).toHaveLength(1);
  });
});

describe('formatPriceForProvider', () => {
  it('luôn hai chữ số thập phân, dạng CHUỖI như TikTok yêu cầu', () => {
    expect(formatPriceForProvider(D('20'))).toBe('20.00');
    expect(formatPriceForProvider(D('20.9'))).toBe('20.90');
    expect(formatPriceForProvider(D('20.994'))).toBe('20.99');
  });
});
