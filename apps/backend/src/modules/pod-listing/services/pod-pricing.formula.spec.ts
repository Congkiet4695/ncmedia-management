import { Prisma } from '@prisma/client';
import {
  assertPricingFormulaValid,
  evaluatePricingFormula,
  PodPricingFormulaException,
  type PodPricingFormulaVariables,
} from './pod-pricing.formula';

const D = (value: string | number) => new Prisma.Decimal(value);

const VARS: PodPricingFormulaVariables = {
  cost: D('8'),
  shipping: D('4.5'),
  base: D('12.5'),
  markup: D('150'),
};

const evaluate = (formula: string) => evaluatePricingFormula(formula, VARS).toString();

describe('evaluatePricingFormula', () => {
  it('bốn phép tính cơ bản', () => {
    expect(evaluate('1 + 2')).toBe('3');
    expect(evaluate('10 - 4')).toBe('6');
    expect(evaluate('3 * 4')).toBe('12');
    expect(evaluate('9 / 2')).toBe('4.5');
  });

  it('tôn trọng độ ưu tiên toán tử và dấu ngoặc', () => {
    expect(evaluate('2 + 3 * 4')).toBe('14');
    expect(evaluate('(2 + 3) * 4')).toBe('20');
  });

  it('thay biến trong danh sách trắng', () => {
    expect(evaluate('cost + shipping')).toBe('12.5');
    expect(evaluate('base * 2')).toBe('25');
    expect(evaluate('markup / 100')).toBe('1.5');
  });

  it('hiểu dấu âm ở đầu biểu thức và sau dấu ngoặc', () => {
    expect(evaluate('-cost + 10')).toBe('2');
    expect(evaluate('2 * (-3 + 5)')).toBe('4');
  });

  it('giữ độ chính xác thập phân (Decimal, không phải số thực nhị phân)', () => {
    expect(evaluate('0.1 + 0.2')).toBe('0.3');
  });

  it('🔴 từ chối tên biến ngoài danh sách trắng', () => {
    expect(() => evaluate('profit * 2')).toThrow(PodPricingFormulaException);
  });

  it('🔴 từ chối mọi thứ trông giống lời gọi mã (không có eval ở đây)', () => {
    // Ký tự lạ bị chặn ngay ở bước tách token, trước khi tới bất kỳ phép tính nào.
    expect(() => evaluate('process.exit(1)')).toThrow(PodPricingFormulaException);
    expect(() => evaluate("require('fs')")).toThrow(PodPricingFormulaException);
    expect(() => evaluate('cost; DROP TABLE users')).toThrow(PodPricingFormulaException);
    expect(() => evaluate('cost ** 2')).toThrow(PodPricingFormulaException);
  });

  it('từ chối dấu ngoặc lệch và biểu thức thiếu toán hạng', () => {
    expect(() => evaluate('(cost + 1')).toThrow(PodPricingFormulaException);
    expect(() => evaluate('cost + 1)')).toThrow(PodPricingFormulaException);
    expect(() => evaluate('cost +')).toThrow(PodPricingFormulaException);
  });

  it('từ chối chia cho 0 thay vì trả về Infinity', () => {
    expect(() => evaluate('cost / 0')).toThrow(PodPricingFormulaException);
  });

  it('từ chối công thức rỗng', () => {
    expect(() => evaluate('   ')).toThrow(PodPricingFormulaException);
  });
});

describe('assertPricingFormulaValid', () => {
  it('chấp nhận công thức hợp lệ', () => {
    expect(() => assertPricingFormulaValid('(cost + shipping) * 1.8 + 2')).not.toThrow();
  });

  it('chặn lỗi NGAY LÚC LƯU chứ không đợi tới lúc sinh listing', () => {
    expect(() => assertPricingFormulaValid('cost * unknownVar')).toThrow(
      PodPricingFormulaException,
    );
  });
});
