/**
 * Kiểm chứng luật của màn hình **Cấu hình sản phẩm / Fulfill** — chạy bằng
 * `npm run test:fulfill-config`.
 *
 * 🔴 Vì sao là script chứ không phải jest: frontend chưa có test runner, còn Node 22 chạy
 * thẳng TypeScript qua `--experimental-strip-types`, nên file này kiểm ĐÚNG mã nguồn đang
 * chạy trong app (`features/fulfillment/product-config.ts`), không phải một bản chép lại.
 *
 * Thoát mã 1 khi có case sai (dùng được trong CI).
 */

import {
  canSubmitFulfillment,
  configBlockers,
  isBusinessSku,
  isFulfillmentConfigValid,
  mergeProductOptions,
  providerProductLabel,
  providerVariantLabel,
  submitBlockers,
} from '../features/fulfillment/product-config.ts';
import { providerErrorText, providerFieldErrors } from '../features/fulfillment/provider-error.ts';
import type {
  FulfillmentState,
  ProviderCatalogProduct,
  ProviderCatalogVariation,
} from '../features/fulfillment/types.ts';

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

const UUID = '6362ae37-519a-4562-a6e2-53eb00d909b5';

const product = (over: Partial<ProviderCatalogProduct> = {}): ProviderCatalogProduct => ({
  id: 'internal-1',
  externalProductId: UUID,
  sku: `PROD-${UUID}`,
  name: '0.75" Thickness Canvas',
  catalogueId: null,
  catalogName: null,
  basePrice: null,
  currency: null,
  imageUrl: null,
  isActive: true,
  variationsCount: 12,
  ...over,
});

const variant = (over: Partial<ProviderCatalogVariation> = {}): ProviderCatalogVariation => ({
  id: 'variant-1',
  externalVariantId: '8f0401ec-2462-4a93-b9ad-f901ab2c3d3a',
  sku: 'EMBUNGH1M00S',
  name: 'Embroidery Hoodie - DARK CHOCOLATE - S',
  color: 'DARK CHOCOLATE',
  size: 'S',
  price: null,
  isAvailable: true,
  ...over,
});

// ---------------------------------------------------------------------------
// BUG 1 — không bao giờ vẽ UUID ra ô chọn
// ---------------------------------------------------------------------------
console.log('nhãn hiển thị không chứa định danh kỹ thuật');

check('`PROD-<uuid>` không phải SKU nghiệp vụ', isBusinessSku(`PROD-${UUID}`, UUID), false);
check('uuid trần không phải SKU nghiệp vụ', isBusinessSku(UUID, UUID), false);
check('uuid lạ (không phải id của chính nó) cũng bị loại', isBusinessSku(UUID), false);
check('mã thật được giữ', isBusinessSku('G05000AIG000M', UUID), true);
check('rỗng ⇒ không có SKU', isBusinessSku('   ', UUID), false);

check(
  'nhãn sản phẩm: chỉ còn TÊN khi sku là id viết lại',
  providerProductLabel(product()),
  '0.75" Thickness Canvas',
);
check(
  'nhãn sản phẩm: có SKU nghiệp vụ thì hiện kèm',
  providerProductLabel(product({ sku: 'CANVAS-075' })),
  '0.75" Thickness Canvas · CANVAS-075',
);
check(
  'nhãn sản phẩm KHÔNG chứa uuid trong mọi trường hợp',
  providerProductLabel(product({ sku: UUID })).includes(UUID),
  false,
);
check(
  'nhãn biến thể: SKU nghiệp vụ + tên (SKU biến thể là mã gửi xưởng in)',
  providerVariantLabel(variant()),
  'EMBUNGH1M00S · Embroidery Hoodie - DARK CHOCOLATE - S',
);
check(
  'nhãn biến thể: sku là uuid ⇒ chỉ còn tên',
  providerVariantLabel(variant({ sku: '8f0401ec-2462-4a93-b9ad-f901ab2c3d3a' })),
  'Embroidery Hoodie - DARK CHOCOLATE - S',
);

// ---------------------------------------------------------------------------
// BUG 3/4 — lựa chọn đã lưu luôn có mặt trong danh sách option
// ---------------------------------------------------------------------------
console.log('option của ô chọn sản phẩm');

const page1 = [product({ id: 'p-1', name: 'A' }), product({ id: 'p-2', name: 'B' })];

check('chưa chọn gì ⇒ đúng các trang đã tải', mergeProductOptions(null, page1), [
  { value: 'p-1', label: 'A' },
  { value: 'p-2', label: 'B' },
]);
check(
  '🔴 sản phẩm đã lưu nằm NGOÀI trang đang tải ⇒ vẫn có option (đứng đầu)',
  mergeProductOptions(product({ id: 'p-999', name: 'Premium Canvas' }), page1),
  [
    { value: 'p-999', label: 'Premium Canvas' },
    { value: 'p-1', label: 'A' },
    { value: 'p-2', label: 'B' },
  ],
);
check(
  'sản phẩm đã lưu cũng nằm trong trang ⇒ KHÔNG nhân đôi',
  mergeProductOptions(product({ id: 'p-2', name: 'B' }), page1).map((option) => option.value),
  ['p-2', 'p-1'],
);
check(
  'nối nhiều trang ⇒ không trùng id',
  mergeProductOptions(null, [...page1, ...page1]).map((option) => option.value),
  ['p-1', 'p-2'],
);

// ---------------------------------------------------------------------------
// BUG 2 — "lưu được chưa" và "gửi được chưa" chỉ có MỘT định nghĩa
// ---------------------------------------------------------------------------
console.log('điều kiện lưu cấu hình');

const draft = {
  accountId: 'acc-1',
  tiktokProductId: 'TT-P1',
  sellerSku: 'SELLER-1',
  providerProductId: 'internal-1',
  variant: variant(),
};

check('đủ dữ liệu ⇒ lưu được', configBlockers(draft), []);
check('đủ dữ liệu ⇒ isFulfillmentConfigValid', isFulfillmentConfigValid(draft), true);
check('thiếu nhà cung cấp', configBlockers({ ...draft, accountId: null }), ['NO_PROVIDER']);
check('thiếu Seller SKU của dòng hàng', configBlockers({ ...draft, sellerSku: null }), [
  'MISSING_PRODUCT_KEY',
]);
check('chưa chọn sản phẩm', configBlockers({ ...draft, providerProductId: '' }), ['NO_PRODUCT']);
check('chưa chốt biến thể', configBlockers({ ...draft, variant: null }), ['NO_VARIANT']);
check(
  'sản phẩm đã lưu không còn trong danh mục',
  configBlockers({ ...draft, productUnavailable: true }),
  ['PRODUCT_UNAVAILABLE'],
);
check(
  '🔴 production line / giá vốn KHÔNG phải điều kiện bắt buộc (API không đòi)',
  isFulfillmentConfigValid(draft),
  true,
);

console.log('điều kiện gửi sang xưởng in');

const state = (over: Partial<FulfillmentState> = {}): FulfillmentState => ({
  fulfillment: null,
  ready: true,
  issues: [],
  canFulfill: true,
  canCancel: false,
  provider: { id: 'acc-1', name: 'Mango US', type: 'MANGO', isActive: true },
  items: [],
  shippingLabel: null,
  shippingMode: 'ADDRESS',
  recipientMasked: false,
  ...over,
});

check('sẵn sàng + DRAFT ⇒ gửi được', submitBlockers({ state: state(), status: 'DRAFT' }), []);
check('sẵn sàng + DRAFT ⇒ canSubmit', canSubmitFulfillment({ state: state(), status: 'DRAFT' }), true);
check('gửi hỏng (FAILED) vẫn cho gửi lại', submitBlockers({ state: state(), status: 'FAILED' }), []);
check('chưa đọc được trạng thái', submitBlockers({ state: null, status: 'DRAFT' }), [
  { code: 'LOADING' },
]);
check('đang gửi ⇒ khoá nút', submitBlockers({ state: state(), status: 'DRAFT', submitting: true }), [
  { code: 'BUSY' },
]);
check('đã gửi rồi ⇒ không còn gửi', submitBlockers({ state: state(), status: 'SUBMITTED' }), [
  { code: 'STATUS', status: 'SUBMITTED' },
]);
check(
  '🔴 backend bảo chưa sẵn sàng ⇒ nút tắt KÈM lý do (không để người dùng đoán)',
  submitBlockers({
    state: state({
      ready: false,
      canFulfill: false,
      issues: [
        {
          section: 'DESIGN',
          code: 'DESIGN_MISSING',
          message: 'Sản phẩm chưa có file design.',
          podOrderItemId: 'item-1',
        },
      ],
    }),
    status: 'DRAFT',
  }),
  [
    {
      code: 'NOT_READY',
      issues: [
        {
          section: 'DESIGN',
          code: 'DESIGN_MISSING',
          message: 'Sản phẩm chưa có file design.',
          podOrderItemId: 'item-1',
        },
      ],
    },
  ],
);
check(
  'chưa sẵn sàng ⇒ canSubmit = false',
  canSubmitFulfillment({ state: state({ canFulfill: false }), status: 'DRAFT' }),
  false,
);

// ---------------------------------------------------------------------------
// Lỗi nhà cung cấp: chi tiết theo field phải tới được người dùng
// ---------------------------------------------------------------------------
console.log('lỗi nhà cung cấp');

const providerError = (body: unknown): unknown => ({ response: { data: body } });

check(
  '🔴 VALIDATION_ERROR có `errors[]` ⇒ ghép đủ field vào câu hiển thị',
  providerErrorText(
    providerError({
      code: 'FULFILLMENT_PROVIDER_VALIDATION',
      message: 'Request validation failed',
      errors: [
        { field: 'items.0.item_id', message: 'String should have at most 26 characters' },
        { field: 'production_line_id', message: 'Invalid uuid' },
      ],
    }),
    'Lỗi hệ thống',
  ),
  'Request validation failed · items.0.item_id: String should have at most 26 characters · production_line_id: Invalid uuid',
);
check(
  'không có `errors[]` ⇒ giữ nguyên thông điệp, KHÔNG bịa thêm',
  providerErrorText(
    providerError({ code: 'FULFILLMENT_PROVIDER_VALIDATION', message: 'Request validation failed' }),
    'Lỗi hệ thống',
  ),
  'Request validation failed',
);
check(
  'lỗi không có envelope ⇒ dùng câu dự phòng',
  providerErrorText(new Error('socket hang up'), 'Lỗi hệ thống'),
  'Lỗi hệ thống',
);
check(
  'danh sách field bóc riêng được (để render từng dòng)',
  providerFieldErrors(
    providerError({ errors: [{ field: 'label_url', message: 'must be a public URL' }] }),
  ),
  ['label_url: must be a public URL'],
);

// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} pass · ${failed} fail`);
if (failed > 0) process.exit(1);
