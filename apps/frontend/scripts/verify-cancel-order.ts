/**
 * Kiểm chứng thao tác **Cancel Order** — chạy bằng `npm run test:cancel-order`.
 *
 * Frontend chưa có test runner / DOM ⇒ hai lớp kiểm:
 *  1. LOGIC: chạy thẳng mã nguồn đang dùng trong app (`features/fulfillment/cancel-order.ts`,
 *     `product-config.ts`) — luật hiện nút, kết cục huỷ, nút Fulfill sau khi huỷ.
 *  2. NỐI DÂY (tĩnh): đọc source của hai entry point để chắc chắn cả hai dùng CÙNG dialog / luật,
 *     nút đóng drawer chỉ đóng, và chỉ MỘT nơi gọi API huỷ. Không thay được thao tác trình duyệt thật.
 *
 * Thoát mã 1 khi có case sai.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANCEL_ORDER_PERMISSION,
  canShowCancelOrder,
  cancelOrderOutcome,
  classifyCancelOrderError,
  isCancelOrderPending,
} from '../features/fulfillment/cancel-order.ts';
import { SUBMITTABLE_STATUSES, submitBlockers } from '../features/fulfillment/product-config.ts';
import type { FulfillmentState, FulfillmentStatus } from '../features/fulfillment/types.ts';

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     expected ${JSON.stringify(expected)}\n     actual   ${JSON.stringify(actual)}`}`);
}

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Trạng thái tối thiểu mà các hàm cần đọc (phần còn lại không tham gia luật). */
function stateOf(partial: { canCancel: boolean; canFulfill?: boolean; cancelPending?: boolean }): FulfillmentState {
  return { canFulfill: false, cancelPending: false, issues: [], ...partial } as unknown as FulfillmentState;
}

// ---------------------------------------------------------------------------
console.log('\n— 1. Hiện / ẩn Cancel Order (luật dùng chung của hai entry point)');
check('Case 1: SUBMITTED ("Accepted") + canCancel + có quyền ⇒ HIỆN', canShowCancelOrder({ allowed: true, state: stateOf({ canCancel: true }) }), true);
check('Case 2: KHÔNG có quyền ⇒ ẨN (dù canCancel = true)', canShowCancelOrder({ allowed: false, state: stateOf({ canCancel: true }) }), false);
check('Case 3: canCancel = false ⇒ ẨN (dù có quyền)', canShowCancelOrder({ allowed: true, state: stateOf({ canCancel: false }) }), false);
check('State chưa tải (undefined) ⇒ ẨN', canShowCancelOrder({ allowed: true, state: undefined }), false);
check('State null ⇒ ẨN', canShowCancelOrder({ allowed: true, state: null }), false);
check('Quyền đúng mã backend', CANCEL_ORDER_PERMISSION, 'fulfillment.cancel');

// ---------------------------------------------------------------------------
console.log('\n— 2. Kết cục huỷ (Case 7 / Sellerwix "cancel processing")');
check('Nhà cung cấp xác nhận ⇒ CANCELLED', cancelOrderOutcome({ status: 'CANCELLED' }), 'CANCELLED');
check('Sellerwix cancel processing (status giữ SUBMITTED) ⇒ PENDING, không báo "đã huỷ"', cancelOrderOutcome({ status: 'SUBMITTED' }), 'PENDING');
check('ON_HOLD chưa xác nhận ⇒ PENDING', cancelOrderOutcome({ status: 'ON_HOLD' }), 'PENDING');

// ---------------------------------------------------------------------------
console.log('\n— 3. Sau khi huỷ: nút Cancel Order ẩn, nút Fulfill hiện lại (Case 7 / 9)');
const afterCancel = stateOf({ canCancel: false, canFulfill: true });
check('CANCELLED + canCancel=false ⇒ Cancel Order ẨN', canShowCancelOrder({ allowed: true, state: afterCancel }), false);
check('CANCELLED nằm trong SUBMITTABLE ⇒ được Fulfill lại', SUBMITTABLE_STATUSES.includes('CANCELLED'), true);
check(
  'CANCELLED + canFulfill ⇒ không còn blocker nào (nút Fulfill bật)',
  submitBlockers({ state: afterCancel, status: 'CANCELLED', submitting: false, tiktokLabelRequired: false }),
  [],
);
const accepted = stateOf({ canCancel: true, canFulfill: false });
check(
  'SUBMITTED ("Accepted") ⇒ nút Fulfill bị chặn bởi STATUS (không gửi trùng)',
  submitBlockers({ state: accepted, status: 'SUBMITTED' as FulfillmentStatus, submitting: false, tiktokLabelRequired: false }).map((b) => b.code),
  ['STATUS'],
);
// Case 8: huỷ lỗi ⇒ backend giữ trạng thái cũ ⇒ state làm mới vẫn canCancel=true ⇒ nút còn để thử lại.
check('Case 8: huỷ lỗi, state vẫn SUBMITTED + canCancel ⇒ nút còn (thử lại được)', canShowCancelOrder({ allowed: true, state: accepted }), true);

// ---------------------------------------------------------------------------
console.log('\n— 4. Nối dây: hai entry point dùng CHUNG dialog / luật / mutation');
const menu = read('features/pod-tiktok/components/orders/order-action-menu.tsx');
const drawer = read('features/fulfillment/components/fulfill-order-drawer.tsx');
const dialog = read('features/fulfillment/components/cancel-order-dialog.tsx');

check('Order Action dùng <CancelOrderDialog>', /<CancelOrderDialog\b/.test(menu), true);
check('Fulfill Drawer dùng <CancelOrderDialog>', /<CancelOrderDialog\b/.test(drawer), true);
check('Order Action hiện nút theo canShowCancelOrder', /canShowCancelOrder\(/.test(menu), true);
check('Fulfill Drawer hiện nút theo canShowCancelOrder', /canShowCancelOrder\(/.test(drawer), true);
check('Fulfill Drawer kiểm quyền bằng CANCEL_ORDER_PERMISSION', /hasPermission\(CANCEL_ORDER_PERMISSION\)/.test(drawer), true);
check('Order Action KHÔNG còn modal/mutation huỷ riêng', /cancel\.mutateAsync|<Modal\b/.test(menu), false);
check('Fulfill Drawer KHÔNG gọi API huỷ trực tiếp', /cancel\.mutateAsync/.test(drawer), false);
check('Dialog là nơi DUY NHẤT gọi cancel.mutateAsync', /cancel\.mutateAsync\(/.test(dialog), true);
check('Dialog chống bấm hai lần (ref + isPending)', /submittingRef\.current/.test(dialog) && /disabled=\{pending\}/.test(dialog), true);
// Nhánh "bị từ chối thật" là phần CUỐI của catch: toast.error, không có onClose sau đó ⇒ dialog giữ để thử lại.
const catchStart = dialog.indexOf('} catch (error) {');
const catchBlock = dialog.slice(catchStart, dialog.indexOf('return (', catchStart));
const rejectedTail = catchBlock.slice(catchBlock.lastIndexOf("if (failure === 'ALREADY_PENDING')"));
const afterLastReturn = rejectedTail.slice(rejectedTail.lastIndexOf('return;'));
check('Bị từ chối thật ⇒ toast lỗi, dialog GIỮ NGUYÊN (không onClose sau toast.error)', /toast\.error\(/.test(afterLastReturn) && !/onClose\(\)/.test(afterLastReturn), true);
const unknownBranch = catchBlock.slice(catchBlock.indexOf("if (failure === 'UNKNOWN_OUTCOME')"), catchBlock.indexOf("if (failure === 'ALREADY_PENDING')"));
check('Case 5: timeout ⇒ thông báo "có thể vẫn đang xử lý", KHÔNG dùng thông điệp "failed"', /timeoutTitle/.test(unknownBranch) && !/cancelDialog\.failed|toast\.error/.test(unknownBranch), true);

// ---------------------------------------------------------------------------
console.log('\n— 5. Case 6: nút đóng drawer chỉ ĐÓNG, nhãn "Close"');
// Footer = đoạn từ `footer={` tới phần thân drawer (`{stateQuery.isLoading`).
const footer = drawer.slice(drawer.indexOf('footer={'), drawer.indexOf('{stateQuery.isLoading'));
check('Tách được footer để kiểm', footer.length > 100, true);
check('Footer không còn dùng nhãn common:action.cancel', /common:action\.cancel/.test(footer), false);
check('Nút đóng: onClick={onClose} + nhãn common:action.close', /onClick=\{onClose\}[^>]*>\s*\{t\('common:action\.close'\)\}/s.test(drawer), true);
check('Mở dialog huỷ ⇒ Escape/nền không đóng luôn drawer', /submitting \|\| cancelOpen \? \(\) => undefined : onClose/.test(drawer), true);
check('Huỷ xong ⇒ bỏ kết quả gửi cũ để đọc lại state thật', /onCancelled=\{\(\) => setResult\(null\)\}/.test(drawer), true);

// ---------------------------------------------------------------------------
console.log('\n— 6. Case 4 / 5: chặn huỷ trùng, timeout không báo thất bại giả');
const axiosTimeout = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const http409 = (code: string) => ({ isAxiosError: true, response: { status: 409, data: { code, message: 'x' } } });
const http400 = {
  isAxiosError: true,
  response: { status: 400, data: { code: 'FULFILLMENT_PROVIDER_VALIDATION', message: 'Bad Request' } },
};
check('Timeout (không có response) ⇒ UNKNOWN_OUTCOME, không phải REJECTED', classifyCancelOrderError(axiosTimeout), 'UNKNOWN_OUTCOME');
check('409 FULFILLMENT_CANCEL_PENDING ⇒ ALREADY_PENDING', classifyCancelOrderError(http409('FULFILLMENT_CANCEL_PENDING')), 'ALREADY_PENDING');
check('409 FULFILLMENT_OPERATION_IN_PROGRESS (lượt trước còn chạy) ⇒ ALREADY_PENDING', classifyCancelOrderError(http409('FULFILLMENT_OPERATION_IN_PROGRESS')), 'ALREADY_PENDING');
check('409 FULFILLMENT_CANNOT_CANCEL (đã vào sản xuất) ⇒ REJECTED', classifyCancelOrderError(http409('FULFILLMENT_CANNOT_CANCEL')), 'REJECTED');
check('400 từ nhà cung cấp ⇒ REJECTED', classifyCancelOrderError(http400), 'REJECTED');
const pendingState = stateOf({ canCancel: false, cancelPending: true });
check('Case 4: cancelPending ⇒ nút Cancel Order ẨN', canShowCancelOrder({ allowed: true, state: pendingState }), false);
check('Case 4: cancelPending ⇒ hiện trạng thái "đang chờ huỷ"', isCancelOrderPending({ allowed: true, state: pendingState }), true);
check('cancelPending nhưng KHÔNG có quyền ⇒ không hiện gì', isCancelOrderPending({ allowed: false, state: pendingState }), false);
const serviceSrc = read('features/fulfillment/services/fulfillment.service.ts');
const hooksSrc = read('features/fulfillment/hooks/use-fulfillment.ts');
check('API huỷ có thời gian chờ riêng (không dùng 15 s mặc định)', /\{ timeout: CANCEL_TIMEOUT_MS \}/.test(serviceSrc), true);
check('Timeout ⇒ mutation tự đọc lại trạng thái nhiều lần', /isNoResponseError\(error\)[\s\S]*CANCEL_RECONCILE_DELAYS_MS/.test(hooksSrc), true);
check('Order Action hiện trạng thái đang chờ huỷ', /isCancelOrderPending\(/.test(menu) && /cancelDialog\.pendingBadge/.test(menu), true);
check('Fulfill Drawer hiện trạng thái đang chờ huỷ', /isCancelOrderPending\(/.test(drawer) && /cancelDialog\.pendingBadge/.test(drawer), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
