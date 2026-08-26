import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  POD_PRICING_FORMULA_MAX_LENGTH,
  POD_PRICING_FORMULA_VARIABLES,
} from '../constants/pod-listing.constants';

/** Biến được phép xuất hiện trong công thức giá. */
export type PodPricingFormulaVariables = Record<
  (typeof POD_PRICING_FORMULA_VARIABLES)[number],
  Prisma.Decimal
>;

/** Công thức sai cú pháp / dùng biến lạ / chia cho 0. */
export class PodPricingFormulaException extends BadRequestException {
  constructor(message: string) {
    super({ code: 'POD_PRICING_FORMULA_INVALID', message });
  }
}

type Token =
  | { kind: 'number'; value: Prisma.Decimal }
  | { kind: 'variable'; name: string }
  | { kind: 'operator'; value: '+' | '-' | '*' | '/' }
  | { kind: 'paren'; value: '(' | ')' };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/**
 * Đánh giá công thức giá do người dùng nhập.
 *
 * 🔴 KHÔNG dùng `eval`, `new Function` hay bất kỳ cách chạy mã nào khác. Đây là chuỗi do
 * người dùng của MỘT tenant nhập và được chạy trên server dùng chung cho mọi tenant — cho
 * phép chạy mã tuỳ ý ở đó là mở cửa hậu vào toàn hệ thống.
 *
 * Ngôn ngữ được chấp nhận, cố tình làm nghèo:
 *   - số thập phân        `12`, `0.85`
 *   - biến trong danh sách trắng (`cost`, `shipping`, `base`, `markup`)
 *   - bốn phép tính `+ - * /`, dấu ngoặc, dấu âm đứng đầu
 *
 * Mọi thứ khác — tên hàm, dấu chấm phẩy, ký tự lạ — bị từ chối NGAY LÚC LƯU template,
 * không đợi tới lúc sinh listing mới báo lỗi.
 *
 * Tính bằng `Prisma.Decimal`: công thức giá nhân chia số thập phân, dùng `number` của JS
 * là sai số chảy thẳng vào giá bán thật.
 */
export function evaluatePricingFormula(
  formula: string,
  variables: PodPricingFormulaVariables,
): Prisma.Decimal {
  const tokens = tokenize(formula);
  const rpn = toReversePolish(tokens);
  return evaluate(rpn, variables);
}

/**
 * Kiểm tra công thức có hợp lệ không (dùng khi lưu Pricing Strategy).
 * Ném `PodPricingFormulaException` với thông điệp nói rõ chỗ sai.
 */
export function assertPricingFormulaValid(formula: string): void {
  // Chạy thử với bộ biến trung tính: bắt được cả lỗi cú pháp lẫn lỗi chia cho hằng số 0.
  const probe = Object.fromEntries(
    POD_PRICING_FORMULA_VARIABLES.map((name) => [name, new Prisma.Decimal(1)]),
  ) as PodPricingFormulaVariables;
  evaluatePricingFormula(formula, probe);
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function tokenize(formula: string): Token[] {
  const raw = formula.trim();
  if (!raw) throw new PodPricingFormulaException('Công thức đang để trống.');
  if (raw.length > POD_PRICING_FORMULA_MAX_LENGTH) {
    throw new PodPricingFormulaException(
      `Công thức dài quá ${POD_PRICING_FORMULA_MAX_LENGTH} ký tự.`,
    );
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char });
      index++;
      continue;
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ kind: 'operator', value: char });
      index++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+/.exec(raw.slice(index));
      if (!match) throw new PodPricingFormulaException(`Số không hợp lệ tại vị trí ${index + 1}.`);
      tokens.push({ kind: 'number', value: new Prisma.Decimal(match[0]) });
      index += match[0].length;
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(raw.slice(index))![0];
      if (!(POD_PRICING_FORMULA_VARIABLES as readonly string[]).includes(name)) {
        throw new PodPricingFormulaException(
          `Không có biến "${name}". Chỉ dùng được: ${POD_PRICING_FORMULA_VARIABLES.join(', ')}.`,
        );
      }
      tokens.push({ kind: 'variable', name });
      index += name.length;
      continue;
    }

    throw new PodPricingFormulaException(`Ký tự "${char}" không được phép trong công thức.`);
  }

  return tokens;
}

/**
 * Shunting-yard: trung tố → hậu tố (RPN).
 *
 * Dấu `-` đứng đầu biểu thức hoặc ngay sau `(` / một toán tử được hiểu là **dấu âm**:
 * chèn số 0 vào trước để `-cost` thành `0 - cost`, tránh phải xử lý toán tử một ngôi.
 */
function toReversePolish(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];
  let previous: Token | undefined;

  for (const token of tokens) {
    const isUnarySign =
      token.kind === 'operator' &&
      (token.value === '-' || token.value === '+') &&
      (previous === undefined ||
        previous.kind === 'operator' ||
        (previous.kind === 'paren' && previous.value === '('));

    if (isUnarySign) {
      output.push({ kind: 'number', value: new Prisma.Decimal(0) });
    }

    switch (token.kind) {
      case 'number':
      case 'variable':
        output.push(token);
        break;

      case 'operator': {
        while (operators.length > 0) {
          const top = operators[operators.length - 1];
          if (top.kind !== 'operator') break;
          if (PRECEDENCE[top.value] < PRECEDENCE[token.value]) break;
          output.push(operators.pop() as Token);
        }
        operators.push(token);
        break;
      }

      case 'paren': {
        if (token.value === '(') {
          operators.push(token);
          break;
        }
        let matched = false;
        while (operators.length > 0) {
          const top = operators.pop() as Token;
          if (top.kind === 'paren' && top.value === '(') {
            matched = true;
            break;
          }
          output.push(top);
        }
        if (!matched) throw new PodPricingFormulaException('Dấu ngoặc không cân đối.');
        break;
      }
    }

    previous = token;
  }

  while (operators.length > 0) {
    const top = operators.pop() as Token;
    if (top.kind === 'paren') throw new PodPricingFormulaException('Dấu ngoặc không cân đối.');
    output.push(top);
  }

  return output;
}

function evaluate(rpn: Token[], variables: PodPricingFormulaVariables): Prisma.Decimal {
  const stack: Prisma.Decimal[] = [];

  for (const token of rpn) {
    if (token.kind === 'number') {
      stack.push(token.value);
      continue;
    }
    if (token.kind === 'variable') {
      stack.push(variables[token.name as keyof PodPricingFormulaVariables]);
      continue;
    }
    if (token.kind !== 'operator') {
      throw new PodPricingFormulaException('Công thức không hợp lệ.');
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      throw new PodPricingFormulaException('Công thức thiếu toán hạng.');
    }

    switch (token.value) {
      case '+':
        stack.push(left.plus(right));
        break;
      case '-':
        stack.push(left.minus(right));
        break;
      case '*':
        stack.push(left.times(right));
        break;
      case '/':
        if (right.isZero()) throw new PodPricingFormulaException('Công thức chia cho 0.');
        stack.push(left.dividedBy(right));
        break;
    }
  }

  if (stack.length !== 1) throw new PodPricingFormulaException('Công thức không hợp lệ.');
  return stack[0];
}
