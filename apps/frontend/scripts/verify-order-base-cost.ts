/**
 * Kiểm chứng luật nhập Base Cost cấp đơn (cột Giá) — `npm run test:base-cost`.
 * Phải trùng luật backend `resolveOrderLevelBaseCost` và cột Basecost của Import Excel.
 */

import { ORDER_BASE_COST_MAX, parseOrderBaseCost } from '../features/fulfillment/order-base-cost.ts';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`✗ ${label}\n    expected ${e}\n    actual   ${a}`);
}

check('số hợp lệ', parseOrderBaseCost('12.50', 'USD'), { ok: true, value: 12.5 });
check('khoảng trắng', parseOrderBaseCost('  7 ', 'USD'), { ok: true, value: 7 });
check('0 hợp lệ (khác trống)', parseOrderBaseCost('0', 'USD'), { ok: true, value: 0 });
check('trống ≠ 0', parseOrderBaseCost('   ', 'USD'), { ok: false, error: 'REQUIRED' });
check('âm', parseOrderBaseCost('-1', 'USD'), { ok: false, error: 'INVALID' });
check('chữ', parseOrderBaseCost('abc', 'USD'), { ok: false, error: 'INVALID' });
check('NaN', parseOrderBaseCost('NaN', 'USD'), { ok: false, error: 'INVALID' });
check('Infinity', parseOrderBaseCost('Infinity', 'USD'), { ok: false, error: 'INVALID' });
check('mũ', parseOrderBaseCost('1e3', 'USD'), { ok: false, error: 'INVALID' });
check('dấu phẩy', parseOrderBaseCost('12,5', 'USD'), { ok: false, error: 'INVALID' });
check('ký hiệu tiền', parseOrderBaseCost('$12', 'USD'), { ok: false, error: 'INVALID' });
check('vượt trần', parseOrderBaseCost(String(ORDER_BASE_COST_MAX + 1), 'USD'), { ok: false, error: 'OUT_OF_RANGE' });
check('trần', parseOrderBaseCost(String(ORDER_BASE_COST_MAX), 'USD'), { ok: true, value: ORDER_BASE_COST_MAX });
check('USD 3 chữ số lẻ', parseOrderBaseCost('1.234', 'USD'), { ok: false, error: 'TOO_MANY_DECIMALS' });
check('số 0 cuối không tính', parseOrderBaseCost('1.230', 'USD'), { ok: true, value: 1.23 });
check('JPY không số lẻ', parseOrderBaseCost('100.5', 'JPY'), { ok: false, error: 'TOO_MANY_DECIMALS' });

console.log(`verify-order-base-cost: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
