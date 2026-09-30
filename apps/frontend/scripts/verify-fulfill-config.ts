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
  assignPlacement,
  canSubmitFulfillment,
  configBlockers,
  defaultPlacementMap,
  effectiveProductionLine,
  isBusinessSku,
  isFulfillmentConfigValid,
  mergeProductOptions,
  productionLineName,
  providerProductLabel,
  providerVariantLabel,
  sanitizePlacementMap,
  submitBlockers,
  variantsForProductionLine,
} from '../features/fulfillment/product-config.ts';
import { baseCostSaveWarning } from '../features/fulfillment/base-cost.ts';
import {
  shippingServiceLabel,
  tiktokLabelErrorView,
  tiktokLabelRequired,
} from '../features/fulfillment/shipping-label.ts';
import {
  isNoResponseError,
  providerErrorText,
  providerFieldErrors,
} from '../features/fulfillment/provider-error.ts';
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
  productionLine: null,
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
console.log('Sellerwix: SKU sản phẩm & vùng in theo biến thể');

check(
  'SKU sản phẩm Sellerwix TRÙNG id nhà cung cấp vẫn là mã nghiệp vụ (không phải uuid)',
  isBusinessSku('SW-MD-MPTG', 'SW-MD-MPTG'),
  true,
);
check(
  'nhãn sản phẩm Sellerwix: Tên · SKU',
  providerProductLabel({ name: 'Most Popular Tee', sku: 'SW-MD-MPTG', externalProductId: 'SW-MD-MPTG' }),
  'Most Popular Tee · SW-MD-MPTG',
);

const AREAS = [
  { key: 'CF', displayName: 'Front', required: false },
  { key: 'FB', displayName: 'Back', required: false },
  { key: 'LS', displayName: 'Left Sleeve', required: false },
];
const PLACEMENTS = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'SLEEVE'] as const;

check(
  'mặc định chỉ ghép Front/Back theo tên hiển thị, KHÔNG đoán Left Sleeve',
  defaultPlacementMap(AREAS),
  { FRONT: 'CF', BACK: 'FB' },
);
check(
  'gán LEFT cho vùng LS',
  assignPlacement({ FRONT: 'CF', BACK: 'FB' }, 'LS', 'LEFT'),
  { FRONT: 'CF', BACK: 'FB', LEFT: 'LS' },
);
check(
  'gán lại một vùng ⇒ vị trí cũ của vùng đó bị gỡ (một vùng một vị trí)',
  assignPlacement({ FRONT: 'CF', BACK: 'FB' }, 'CF', 'BACK'),
  { BACK: 'CF' },
);
check(
  'bỏ gán một vùng',
  assignPlacement({ FRONT: 'CF', BACK: 'FB' }, 'FB', ''),
  { FRONT: 'CF' },
);
check(
  'ánh xạ đã lưu trỏ tới vùng không còn trong biến thể ⇒ bỏ',
  sanitizePlacementMap({ FRONT: 'CF', LEFT: 'XX', LABEL: 'CF' }, AREAS, PLACEMENTS),
  { FRONT: 'CF' },
);

// ---------------------------------------------------------------------------
// Lấy nhãn TikTok — lỗi có ích, không "System error"
// ---------------------------------------------------------------------------
check(
  'lỗi TikTok kèm details ⇒ câu hiển thị có bước lỗi · mã TikTok · request id',
  providerErrorText(
    providerError({
      code: 'TIKTOK_SHIPPING_LABEL_UNAVAILABLE',
      message: "TikTok từ chối yêu cầu lấy nhãn (mã 21042102): Documents couldn't be printed",
      details: { provider: 'TIKTOK', operation: 'SHIPPING_DOCUMENT', providerCode: '21042102', requestId: 'req-1' },
    }),
    'System error',
  ),
  "TikTok từ chối yêu cầu lấy nhãn (mã 21042102): Documents couldn't be printed [TIKTOK · SHIPPING_DOCUMENT · 21042102 · req-1]",
);
check(
  'details rỗng/null ⇒ không thêm ngoặc thừa',
  providerErrorText(providerError({ message: 'x', details: null }), 'y'),
  'x',
);
check('timeout/mất mạng (axios, không có response) ⇒ nhận ra', isNoResponseError({ isAxiosError: true }), true);
check(
  'server trả lỗi (có response) ⇒ KHÔNG coi là mất phản hồi',
  isNoResponseError({ isAxiosError: true, response: { status: 422 } }),
  false,
);
check('lỗi không phải axios ⇒ false', isNoResponseError(new Error('x')), false);

// ---------------------------------------------------------------------------
// Mango — Line sản xuất quyết định SKU (Mango xếp đơn theo SKU, không có trường production line)
// ---------------------------------------------------------------------------
console.log('line sản xuất ⇒ chỉ SKU của đúng xưởng');

const LINES = [
  { value: 'line-tiktok', label: 'TIKTOK' },
  { value: 'line-fastus', label: 'FASTUS' },
];
// Cùng BLACK / 3XL: mỗi xưởng một SKU (đúng như danh mục Mango thật).
const lineVariants = [
  variant({ id: 'v-fu', sku: '12129', color: 'BLACK', size: '3XL', productionLine: 'FASTUS' }),
  variant({ id: 'v-tt', sku: 'TT-BLACK-3XL', color: 'BLACK', size: '3XL', productionLine: 'TIKTOK' }),
  variant({ id: 'v-none', sku: 'NOLINE', color: 'BLACK', size: '3XL', productionLine: null }),
];
const pickBlack3xl = (lineId: string) =>
  variantsForProductionLine(lineVariants, productionLineName(LINES, lineId)).find(
    (entry) => entry.color === 'BLACK' && entry.size === '3XL',
  )?.sku ?? null;

check('CASE 1 — chọn TIKTOK ⇒ BLACK/3XL ra SKU của TIKTOK', pickBlack3xl('line-tiktok'), 'TT-BLACK-3XL');
check('CASE 2 — chọn FASTUS ⇒ BLACK/3XL ra SKU của FASTUS', pickBlack3xl('line-fastus'), '12129');
check(
  'CASE 4/5 — đổi line ⇒ cùng Color/Size ra SKU của line mới',
  [pickBlack3xl('line-fastus'), pickBlack3xl('line-tiktok'), pickBlack3xl('line-fastus')],
  ['12129', 'TT-BLACK-3XL', '12129'],
);
check(
  'người dùng chọn THẮNG mặc định tài khoản',
  effectiveProductionLine('line-tiktok', 'line-fastus'),
  'line-tiktok',
);
check('CASE 3 — không chọn ⇒ dùng mặc định tài khoản', effectiveProductionLine('', 'line-fastus'), 'line-fastus');
check('không chọn, không mặc định ⇒ rỗng', effectiveProductionLine(null, null), '');
check('không có line ⇒ mọi biến thể', variantsForProductionLine(lineVariants, null).length, 3);
check(
  'đã chọn line ⇒ biến thể KHÔNG rõ xưởng bị loại',
  variantsForProductionLine(lineVariants, 'TIKTOK').map((entry) => entry.sku),
  ['TT-BLACK-3XL'],
);
check('id line lạ ⇒ không có tên (không đoán)', productionLineName(LINES, 'line-gone'), null);
check('tên line chuẩn hoá chữ HOA', productionLineName([{ value: 'x', label: ' tiktok ' }], 'x'), 'TIKTOK');
check(
  'nhãn SKU hiện xưởng của nó',
  providerVariantLabel(variant({ sku: '12129', name: 'Tee - BLACK - 3XL', productionLine: 'FASTUS' })),
  '12129 · Tee - BLACK - 3XL · FASTUS',
);

// ---------------------------------------------------------------------------
// Lấy nhãn từ TikTok — lỗi theo mã, chọn dịch vụ, "By TikTok" cần nhãn
// ---------------------------------------------------------------------------
console.log('nhãn TikTok');

const axiosError = (data: unknown) => ({ isAxiosError: true, response: { status: 422, data } });

const unreachable = tiktokLabelErrorView(
  axiosError({
    code: 'TIKTOK_UNREACHABLE',
    message: 'Không kết nối được TikTok…',
    details: { provider: 'TIKTOK', operation: 'CREATE_PACKAGE', providerCode: '0', requestId: null, providerMessage: 'TikTok không phản hồi trong 20 giây' },
  }),
);
check('mã đã biết ⇒ khoá dịch riêng (không phải "Internal server error")', unreachable.key, 'fulfill.label.error.TIKTOK_UNREACHABLE');
check('kèm vết đối soát an toàn', unreachable.trace, 'TIKTOK · CREATE_PACKAGE · 0');

const createFailed = tiktokLabelErrorView(
  axiosError({
    code: 'TIKTOK_PACKAGE_CREATE_FAILED',
    message: 'TikTok không tạo được gói hàng (mã 21011024): Shipping service is unavailable',
    details: { provider: 'TIKTOK', operation: 'CREATE_PACKAGE', providerCode: '21011024', requestId: 'req-cp', providerMessage: 'Shipping service is unavailable' },
  }),
);
check('tạo gói thất bại ⇒ chèn lý do NGUYÊN VĂN của TikTok', createFailed.params.message, 'Shipping service is unavailable');

const internal = tiktokLabelErrorView(
  axiosError({
    code: 'SHIPPING_LABEL_INTERNAL_ERROR',
    message: 'Lỗi hệ thống… (mã tham chiếu 3f0c…)',
    details: { provider: 'TIKTOK', operation: 'INTERNAL', providerCode: null, requestId: null, referenceId: '3f0c2d7e-0000-4000-8000-000000000000' },
  }),
);
check('lỗi hệ thống ⇒ chỉ mã tham chiếu, không vết kỹ thuật', [internal.key, internal.params.reference, internal.trace], [
  'fulfill.label.error.SHIPPING_LABEL_INTERNAL_ERROR',
  '3f0c2d7e-0000-4000-8000-000000000000',
  '',
]);

const choose = tiktokLabelErrorView(
  axiosError({
    code: 'TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED',
    message: 'TikTok trả về 2 dịch vụ…',
    details: {
      provider: 'TIKTOK',
      operation: 'SHIPPING_SERVICES',
      providerCode: null,
      requestId: 'req-svc',
      shippingServices: [
        { id: 'SVC-A', name: 'USPS Ground Advantage™', shippingProviderName: 'USPS' },
        { id: 'SVC-B', name: 'Ground', shippingProviderName: 'UPS' },
      ],
    },
  }),
);
check('nhiều dịch vụ không mặc định ⇒ trả danh sách để chọn', choose.services.map((entry) => entry.id), ['SVC-A', 'SVC-B']);
check('nhãn dịch vụ không lặp tên hãng đã có trong tên', shippingServiceLabel(choose.services[0]), 'USPS Ground Advantage™');
check('nhãn dịch vụ thêm hãng khi tên chưa có', shippingServiceLabel(choose.services[1]), 'Ground · UPS');

check('lỗi lạ (không có envelope) ⇒ key null (dùng thông điệp chung)', tiktokLabelErrorView(new Error('x')).key, null);

check(
  '"By TikTok" + chưa có nhãn ⇒ bắt buộc lấy nhãn',
  tiktokLabelRequired({ shippingMethod: 'by_tiktok', hasSavedLabel: false, labelInput: '' }),
  true,
);
check(
  '"By TikTok" + đã có nhãn (lấy từ TikTok) ⇒ không chặn',
  tiktokLabelRequired({ shippingMethod: 'by_tiktok', hasSavedLabel: true, labelInput: '' }),
  false,
);
check(
  '"By TikTok" + nhãn đang gõ (sẽ được lưu trước khi gửi) ⇒ không chặn',
  tiktokLabelRequired({ shippingMethod: 'by_tiktok', hasSavedLabel: false, labelInput: 'https://x.test/l.pdf' }),
  false,
);
check(
  'phương thức khác ⇒ không đòi nhãn',
  tiktokLabelRequired({ shippingMethod: 'standard', hasSavedLabel: false, labelInput: '' }),
  false,
);
const readyState = { canFulfill: true, issues: [] } as unknown as FulfillmentState;
check(
  'CASE 11 — chưa có nhãn ⇒ nút gửi bị chặn với lý do TIKTOK_LABEL_REQUIRED',
  submitBlockers({ state: readyState, status: 'DRAFT', tiktokLabelRequired: true }).map((b) => b.code),
  ['TIKTOK_LABEL_REQUIRED'],
);
check(
  'CASE 11 — có nhãn ⇒ gửi được',
  canSubmitFulfillment({ state: readyState, status: 'DRAFT', tiktokLabelRequired: false }),
  true,
);

// ---------------------------------------------------------------------------
// Base Cost — backend lấy giá nhà cung cấp; giao diện chỉ báo kết quả
// ---------------------------------------------------------------------------
console.log('base cost');

check('đã cập nhật theo giá nhà cung cấp ⇒ không cảnh báo', baseCostSaveWarning({ baseCostStatus: 'PROVIDER_PRICE', baseCostMessage: null }), null);
check(
  'không lấy được giá, giữ giá cũ ⇒ cảnh báo kèm lý do (không im lặng)',
  baseCostSaveWarning({ baseCostStatus: 'UNCHANGED', baseCostMessage: 'Không tìm thấy biến thể 10011' }),
  { key: 'fulfill.config.baseCostUnchanged', message: 'Không tìm thấy biến thể 10011' },
);
check(
  'biến thể mới không có giá ⇒ cảnh báo Base Cost để trống',
  baseCostSaveWarning({ baseCostStatus: 'PRICE_NOT_FOUND', baseCostMessage: 'x' })?.key,
  'fulfill.config.baseCostNotFound',
);
check('phản hồi cũ không có trạng thái ⇒ không cảnh báo', baseCostSaveWarning({}), null);

// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} pass · ${failed} fail`);
if (failed > 0) process.exit(1);
