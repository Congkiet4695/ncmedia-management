/**
 * Kiểm chứng cách hiển thị dòng hàng và lỗi Fulfill — chạy bằng `npm run test:order-item-rows`.
 *
 * Chạy thẳng mã nguồn app bằng `--experimental-strip-types` (frontend chưa có test runner — xem
 * `verify-fulfill-config.ts`). Thoát mã 1 khi có case sai (dùng được trong CI).
 *
 * Fixture "cùng biến thể, khác host CDN" đại diện cho dữ liệu thật đã đối chiếu: TikTok trả mỗi đơn vị
 * thành một `line_items` riêng, và ảnh của hai dòng chỉ khác nhau ở tiền tố `p16-` / `p19-`.
 */

import { groupOrderProducts } from '../features/pod-tiktok/order-view-model';
import type { PodOrderItem } from '../features/pod-tiktok/order-types';
import {
  countIssueEntries,
  groupFulfillmentIssues,
  issuesOfLines,
} from '../features/fulfillment/issue-summary';
import { canSubmitFulfillment, submitBlockers } from '../features/fulfillment/product-config';
import type { FulfillmentIssue, FulfillmentState } from '../features/fulfillment/types';

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
  console.error(`  ✗ ${label}\n      nhận:  ${a}\n      mong:  ${e}`);
}

const IMAGE = (shard: string) => `https://${shard}-oec-general.ttcdn-us.com/tos/same-image.jpeg?from=1`;

const line = (over: Partial<PodOrderItem> = {}): PodOrderItem =>
  ({
    id: 'line-1',
    tiktokLineItemId: 'tt-line-1',
    productId: 'PRODUCT-A',
    productName: 'Product A',
    skuId: 'SKU-X',
    skuName: 'Variant X',
    sellerSku: 'SELLER-X',
    skuImage: IMAGE('p16'),
    productImage: null,
    productImageFull: null,
    salePrice: 20.49,
    originalPrice: 20.49,
    currency: 'USD',
    displayStatus: 'AWAITING_COLLECTION',
    packageStatus: null,
    packageId: 'PKG-1',
    trackingNumber: null,
    shippingProviderName: null,
    cancelReason: null,
    isPodCustomized: false,
    podInfoId: null,
    mappingId: null,
    mappingStatus: 'MISSING',
    mappingCandidates: [],
    isGift: false,
    quantity: 1,
    productCategory: null,
    designs: [],
    ...over,
  }) as PodOrderItem;

const summary = (items: PodOrderItem[]) =>
  groupOrderProducts(items).map((row) => [row.skuName, row.quantity, row.sources.map((s) => s.id)]);

// ---------------------------------------------------------------------------
console.log('dòng hiển thị của đơn hàng');

check(
  'Case 1 + 6: cùng biến thể, 2 line item, ảnh khác host CDN ⇒ 1 dòng × 2, giữ đủ line item gốc',
  summary([line({ id: 'a', skuImage: IMAGE('p19') }), line({ id: 'b', skuImage: IMAGE('p16') })]),
  [['Variant X', 2, ['a', 'b']]],
);
check(
  'Case 2: hai biến thể khác nhau ⇒ 2 dòng',
  summary([
    line({ id: 'a' }),
    line({ id: 'b', skuId: 'SKU-Y', skuName: 'Variant Y', sellerSku: 'SELLER-Y' }),
  ]),
  [
    ['Variant X', 1, ['a']],
    ['Variant Y', 1, ['b']],
  ],
);
check(
  'hai biến thể CHUNG Seller SKU, chung ảnh ⇒ vẫn 2 dòng (không mất size/màu)',
  summary([line({ id: 'a' }), line({ id: 'b', skuId: 'SKU-Y', skuName: 'Variant Y' })]),
  [
    ['Variant X', 1, ['a']],
    ['Variant Y', 1, ['b']],
  ],
);
check(
  'Case 3: cùng Product ID nhưng khác gói ⇒ 2 dòng',
  summary([line({ id: 'a' }), line({ id: 'b', packageId: 'PKG-2' })]).length,
  2,
);
check(
  'cùng biến thể nhưng khác trạng thái ⇒ 2 dòng',
  summary([line({ id: 'a' }), line({ id: 'b', displayStatus: 'CANCELLED' })]).length,
  2,
);
check(
  'quà tặng và hàng thường cùng biến thể ⇒ 2 dòng',
  summary([line({ id: 'a' }), line({ id: 'b', isGift: true })]).length,
  2,
);
check(
  'dữ liệu tuỳ biến POD khác nhau ⇒ 2 dòng',
  summary([line({ id: 'a', podInfoId: 'P1' }), line({ id: 'b', podInfoId: 'P2' })]).length,
  2,
);
check(
  'thiếu khoá sản phẩm ⇒ không gộp',
  summary([
    line({ id: 'a', productId: null, skuId: null, sellerSku: null }),
    line({ id: 'b', productId: null, skuId: null, sellerSku: null }),
  ]).length,
  2,
);
check(
  'khác giá theo đơn vị ⇒ vẫn một dòng, giữ đủ giá trong line item gốc',
  groupOrderProducts([line({ id: 'a' }), line({ id: 'b', salePrice: 15 })])[0].sources.map((s) => s.salePrice),
  [20.49, 15],
);
check(
  'không có Seller SKU, cùng SKU ID ⇒ 1 dòng × 2',
  summary([line({ id: 'a', sellerSku: null }), line({ id: 'b', sellerSku: null })]),
  [['Variant X', 2, ['a', 'b']]],
);
check(
  'Case 5: dòng gộp giữ ánh xạ / design của biến thể',
  groupOrderProducts([
    line({ id: 'a', mappingId: 'map-x', mappingStatus: 'MAPPED' }),
    line({ id: 'b', mappingId: 'map-x', mappingStatus: 'MAPPED' }),
    line({ id: 'c', skuId: 'SKU-Y', sellerSku: 'SELLER-Y', mappingId: 'map-y', mappingStatus: 'MAPPED' }),
  ]).map((row) => [row.mappingId, row.quantity]),
  [
    ['map-x', 2],
    ['map-y', 1],
  ],
);

// ---------------------------------------------------------------------------
console.log('gom lỗi Fulfill');

const issue = (over: Partial<FulfillmentIssue> = {}): FulfillmentIssue => ({
  section: 'MAPPING',
  code: 'MAPPING_MISSING',
  message: 'Chưa khai báo ánh xạ sản phẩm cho "Product A" (Product ID: PRODUCT-A · SKU ID: SKU-X).',
  podOrderItemId: 'a',
  tiktokProductId: 'PRODUCT-A',
  tiktokSkuId: 'SKU-X',
  sellerSku: 'SELLER-X',
  productName: 'Product A',
  skuName: 'Variant X',
  ...over,
});

const entriesOf = (issues: FulfillmentIssue[]) =>
  groupFulfillmentIssues(issues, [], 'error').flatMap((group) => group.entries);

check(
  '2 đơn vị cùng khoá ⇒ 1 mục, lineCount = 2',
  entriesOf([issue(), issue({ podOrderItemId: 'b' })]).map((entry) => entry.lineCount),
  [2],
);
check(
  'CÙNG câu chữ nhưng khác sản phẩm ⇒ KHÔNG gộp (không khử trùng theo text)',
  entriesOf([issue({ message: 'x' }), issue({ message: 'x', podOrderItemId: 'b', tiktokProductId: 'PRODUCT-B' })]).length,
  2,
);
check(
  '🔴 cùng Seller SKU, khác biến thể ⇒ 2 mục (mỗi biến thể một ánh xạ)',
  entriesOf([issue(), issue({ podOrderItemId: 'b', tiktokSkuId: 'SKU-Y', skuName: 'Variant Y' })]).length,
  2,
);
check(
  'không có Seller SKU ⇒ khoá vẫn theo SKU ID',
  entriesOf([issue({ sellerSku: null }), issue({ sellerSku: null, podOrderItemId: 'b' })]).map((entry) => entry.lineCount),
  [2],
);
check(
  'cùng sản phẩm, khác vị trí in ⇒ giữ riêng từng lý do',
  entriesOf([
    issue({ section: 'DESIGN', code: 'DESIGN_NOT_PUBLIC', message: 'vị trí FRONT' }),
    issue({ section: 'DESIGN', code: 'DESIGN_NOT_PUBLIC', message: 'vị trí BACK' }),
  ]).map((entry) => entry.message),
  ['vị trí FRONT', 'vị trí BACK'],
);
check(
  'thiếu khoá ⇒ mỗi line item một mục',
  entriesOf([
    issue({ code: 'MAPPING_KEY_MISSING', tiktokProductId: null, sellerSku: null, tiktokSkuId: null, message: 'm' }),
    issue({ code: 'MAPPING_KEY_MISSING', tiktokProductId: null, sellerSku: null, tiktokSkuId: null, message: 'm', podOrderItemId: 'b' }),
  ]).length,
  2,
);
check(
  'issue DESIGN không kèm ngữ cảnh ⇒ lấy tên / khoá từ dòng hàng',
  groupFulfillmentIssues(
    [
      {
        section: 'DESIGN',
        code: 'DESIGN_MISSING',
        message: 'Sản phẩm "Product A" chưa có file design.',
        podOrderItemId: 'a',
      },
    ],
    [{ id: 'a', productId: 'PRODUCT-A', productName: 'Product A', skuId: 'SKU-X', skuName: 'Variant X', sellerSku: 'SELLER-X' }],
    'error',
  )[0].entries.map((entry) => [entry.productName, entry.productId, entry.sellerSku, entry.structured]),
  [['Product A', 'PRODUCT-A', 'SELLER-X', true]],
);
check(
  'mã có dữ liệu riêng trong câu ⇒ phải hiện nguyên văn',
  entriesOf([issue({ code: 'PLACEMENT_UNSUPPORTED' })])[0].structured,
  false,
);
check(
  'mã rút gọn được nhưng không có sản phẩm ⇒ phải hiện nguyên văn',
  entriesOf([issue({ tiktokProductId: null, productName: null, podOrderItemId: null })])[0].structured,
  false,
);
check(
  'mỗi mã lỗi một nhóm, đếm theo mục',
  countIssueEntries(
    groupFulfillmentIssues(
      [
        issue(),
        issue({ podOrderItemId: 'b' }),
        issue({ podOrderItemId: 'c', tiktokProductId: 'PRODUCT-B' }),
        issue({ section: 'ADDRESS', code: 'ADDRESS_MISSING', message: 'm', podOrderItemId: null }),
      ],
      [],
      'error',
    ),
  ),
  3,
);
check(
  'lý do của dòng hiển thị: mỗi lý do một lần, không lẫn dòng khác',
  issuesOfLines(
    [issue(), issue({ podOrderItemId: 'b' }), issue({ podOrderItemId: 'c', message: 'khác' })],
    ['a', 'b'],
  ).map((entry) => entry.podOrderItemId),
  ['a'],
);

// ---------------------------------------------------------------------------
console.log('nút gửi vẫn đọc nguyên văn backend');

const state = (over: Partial<FulfillmentState>): FulfillmentState =>
  ({ canFulfill: false, issues: [], warnings: [], ...over }) as FulfillmentState;

check(
  'còn lỗi ⇒ vẫn chặn, blocker giữ đủ MỌI issue chưa khử trùng',
  (() => {
    const issues = [issue(), issue({ podOrderItemId: 'b' })];
    const params = { state: state({ issues }), status: 'DRAFT' as const };
    const blocker = submitBlockers(params)[0];
    return [canSubmitFulfillment(params), blocker.code === 'NOT_READY' ? blocker.issues.length : -1];
  })(),
  [false, 2],
);
check(
  'chỉ có cảnh báo, backend cho gửi ⇒ gửi được',
  canSubmitFulfillment({
    state: state({ canFulfill: true, warnings: [issue({ code: 'PROMOTION_GIFT_NOT_SENT' })] }),
    status: 'DRAFT',
  }),
  true,
);

console.log('');
console.log(`${passed} pass · ${failed} fail`);
if (failed > 0) process.exit(1);
