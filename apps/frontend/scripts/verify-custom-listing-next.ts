/**
 * Kiểm chứng bước SAU KHI đăng từ Add Custom Listing, ảnh biến thể bằng URL và tồn kho 0.
 *
 * Chạy: `npm run test:custom-listing-next`
 */

import {
  LISTING_RUN_IDLE,
  carryOverCustomListingForm,
  clearCustomListingCarry,
  listingRunOutcome,
  listingRunReducer,
  peekCustomListingCarry,
  stashCustomListingCarry,
  type ListingRunJob,
  type ListingRunState,
} from '../features/pod-listing-session/custom-listing-next.ts';
import {
  buildCustomListingPayload,
  buildManualData,
  checkCustomListingForm,
  emptyCustomListingForm,
  isUsableSku,
  type CustomListingForm,
} from '../features/pod-listing-session/custom-listing-state.ts';
import { deriveVariantImages, reconcileSkus } from '../features/pod-listing-session/manual-sku.ts';
import {
  EMPTY_VARIATION_URL,
  checkSingleImageUrl,
  setVariationImage,
  variationUrlReducer,
  type VariationUrlState,
} from '../features/pod-listing-session/media-image-order.ts';
import { applySkuTemplate } from '../features/pod-listing-session/template-apply.ts';
import type { ManualVariation } from '../features/pod-listing-session/types.ts';
import type { PodSkuTemplate } from '../features/pod-listing/types.ts';

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

function job(over: Partial<ListingRunJob> = {}): ListingRunJob {
  return { id: 'job-2', status: 'PROCESSING', totalItems: 2, successItems: 0, failedItems: 0, lastError: null, ...over };
}

function fullForm(): CustomListingForm {
  const form = emptyCustomListingForm();
  form.market = 'UK';
  form.shopIds = ['shop-a', 'shop-b'];
  form.title = 'Old product';
  form.searchTerms = 'old, terms';
  form.highlights = 'old highlight';
  form.category = { id: '1237008', name: 'Posters', path: 'Home > Posters' };
  form.attributeValues = { a1: { valueIds: ['v1'], customValues: ['c1'] } };
  form.brand = { id: 'brand-9', name: 'NCMedia' };
  form.warehouseId = 'wh-1';
  form.description = '<p>Shared description</p>';
  form.pkg = { weight: '300', weightUnit: 'GRAM', length: '30', width: '20', height: '2', dimensionUnit: 'CENTIMETER' };
  form.images = [{ imageUrl: 'https://cdn/main.jpg', fileId: 'f-main', imageType: 'MAIN' }];
  form.sizeChart = { imageUrl: 'https://cdn/size.jpg', fileId: 'f-size', imageType: 'SIZE_CHART' };
  form.video = { fileId: 'f-video', fileName: 'demo.mp4' };
  form.variations = [
    { name: 'Color', values: ['Black', 'White'], images: [{ value: 'Black', fileId: 'f-black', url: 'https://cdn/black.jpg' }] },
    { name: 'Size', values: ['S'] },
  ];
  form.skus = [
    {
      sellerSku: 'OLD-PRODUCT-BLACK',
      optionValues: [{ name: 'Color', value: 'Black' }, { name: 'Size', value: 'S' }],
      salePrice: '19.99',
      retailPrice: '29.99',
      quantity: 0,
      imageFileId: 'f-black',
      barcode: 'OLD-BARCODE',
    },
    {
      sellerSku: 'OLD-PRODUCT-WHITE',
      optionValues: [{ name: 'Color', value: 'White' }, { name: 'Size', value: 'S' }],
      salePrice: '21.00',
      retailPrice: '',
      quantity: 7,
    },
  ];
  form.templates = { category: 'tpl-cat', description: 'tpl-desc', sku: 'tpl-sku', image: 'tpl-img', group: 'tpl-group' };
  return form;
}

// ---------------------------------------------------------------------------
// II. Thời điểm hiện popup
// ---------------------------------------------------------------------------
{
  check('job đang chạy ⇒ RUNNING', listingRunOutcome(job(), 'job-2'), 'RUNNING');
  check('job đang chờ ⇒ RUNNING', listingRunOutcome(job({ status: 'PENDING' }), 'job-2'), 'RUNNING');
  check('chưa có dữ liệu ⇒ RUNNING', listingRunOutcome(null, 'job-2'), 'RUNNING');
  check(
    '🔴 dữ liệu cache còn của job CŨ đã COMPLETED ⇒ chưa kết luận',
    listingRunOutcome(job({ id: 'job-1', status: 'COMPLETED', successItems: 2 }), 'job-2'),
    'RUNNING',
  );
  check('mọi shop thành công ⇒ SUCCESS', listingRunOutcome(job({ status: 'COMPLETED', successItems: 2 }), 'job-2'), 'SUCCESS');
  check(
    '🔴 một phần shop lỗi ⇒ không phải SUCCESS',
    listingRunOutcome(job({ status: 'COMPLETED_WITH_ERRORS', successItems: 1, failedItems: 1 }), 'job-2'),
    'PARTIAL',
  );
  check('job FAILED ⇒ FAILED', listingRunOutcome(job({ status: 'FAILED', failedItems: 2 }), 'job-2'), 'FAILED');
  check('job CANCELLED ⇒ FAILED', listingRunOutcome(job({ status: 'CANCELLED' }), 'job-2'), 'FAILED');

  const started = { type: 'STARTED', sessionId: 's-1', jobId: 'job-2', mode: 'LIVE' } as const;
  const running = listingRunReducer(LISTING_RUN_IDLE, started);
  check('bấm đăng ⇒ RUNNING, CHƯA có popup', running.phase, 'RUNNING');

  const done = listingRunReducer(running, { type: 'SETTLED', jobId: 'job-2', outcome: 'SUCCESS', job: job({ status: 'COMPLETED' }) });
  check('List/Publish Live thành công ⇒ DONE (popup)', [done.phase, done.phase === 'DONE' && done.mode], ['DONE', 'LIVE']);

  const failedRun = listingRunReducer(running, {
    type: 'SETTLED',
    jobId: 'job-2',
    outcome: 'FAILED',
    job: job({ status: 'FAILED', lastError: 'TikTok từ chối' }),
  });
  check('job thất bại ⇒ KHÔNG có popup thành công', failedRun.phase, 'FAILED');
  check('job thất bại giữ lỗi để hiện', failedRun.phase === 'FAILED' && failedRun.lastError, 'TikTok từ chối');
  const partial = listingRunReducer(running, {
    type: 'SETTLED',
    jobId: 'job-2',
    outcome: 'PARTIAL',
    job: job({ status: 'COMPLETED_WITH_ERRORS', successItems: 1, failedItems: 1 }),
  });
  check('xong một phần ⇒ KHÔNG có popup thành công', [partial.phase, partial.phase === 'FAILED' && partial.successItems], ['FAILED', 1]);

  const again = listingRunReducer(done, { type: 'SETTLED', jobId: 'job-2', outcome: 'SUCCESS', job: null });
  check('🔴 callback chạy lặp ⇒ không đổi trạng thái (một popup)', again === done, true);
  check('bấm đúp đăng khi đang chạy ⇒ không tạo lượt thứ hai', listingRunReducer(running, { ...started, jobId: 'job-3' }) === running, true);
  check(
    '🔴 kết quả của job khác ⇒ bỏ qua',
    listingRunReducer(running, { type: 'SETTLED', jobId: 'job-1', outcome: 'SUCCESS', job: null }) === running,
    true,
  );
  const closed = listingRunReducer(done, { type: 'DISMISS' });
  check('đóng popup / Ở lại ⇒ IDLE', closed.phase, 'IDLE');
  check(
    '🔴 đóng rồi kết quả về muộn ⇒ popup không tự mở lại',
    listingRunReducer(closed, { type: 'SETTLED', jobId: 'job-2', outcome: 'SUCCESS', job: null }).phase,
    'IDLE',
  );
  check('không đóng được khi đang chạy', listingRunReducer(running, { type: 'DISMISS' }) === running, true);
  const rerun: ListingRunState = listingRunReducer(closed, { ...started, jobId: 'job-3', mode: 'LIST' });
  check('Ở lại rồi đăng tiếp ⇒ lượt mới', [rerun.phase, rerun.phase === 'RUNNING' && rerun.jobId], ['RUNNING', 'job-3']);
}

// ---------------------------------------------------------------------------
// II. Giữ cấu hình sang sản phẩm mới
// ---------------------------------------------------------------------------
{
  const original = fullForm();
  const snapshot = JSON.stringify(original);
  const next = carryOverCustomListingForm(original, { skuPrefix: 'TEE' });

  check('Shops giữ', next.shopIds, ['shop-a', 'shop-b']);
  check('Market giữ (danh mục, shop phụ thuộc thị trường)', next.market, 'UK');
  check('Group Template giữ', next.templates.group, 'tpl-group');
  check('Category giữ', next.category, { id: '1237008', name: 'Posters', path: 'Home > Posters' });
  check('Attributes giữ', next.attributeValues, original.attributeValues);
  check('Brand + kho (cùng khu vực trên form) giữ', [next.brand.id, next.warehouseId], ['brand-9', 'wh-1']);
  check('Mô tả giữ', next.description, '<p>Shared description</p>');
  check('Package giữ', next.pkg, original.pkg);
  check('Mẫu Category/SKU/Description giữ', [next.templates.category, next.templates.sku, next.templates.description], ['tpl-cat', 'tpl-sku', 'tpl-desc']);
  check('SKU & Pricing: trục giữ', next.variations.map((v) => [v.name, v.values]), [['Color', ['Black', 'White']], ['Size', ['S']]]);
  check('SKU & Pricing: giá giữ theo tổ hợp', next.skus.map((s) => [s.salePrice, s.retailPrice]), [['19.99', '29.99'], ['21.00', '']]);
  check('🔴 tồn 0 giữ đúng 0, tồn dương giữ', next.skus.map((s) => s.quantity), [0, 7]);

  check('Tiêu đề reset', next.title, '');
  check('Từ khoá + highlights reset', [next.searchTerms, next.highlights], ['', '']);
  check('Ảnh sản phẩm reset', next.images, []);
  check('Image Template reset (không kéo ảnh cũ về lúc đăng)', next.templates.image, '');
  check('Bảng size + video reset', [next.sizeChart, next.video], [null, null]);
  check('🔴 không còn ảnh biến thể trên trục', next.variations.some((v) => 'images' in v), false);
  check('🔴 không còn ảnh trên dòng SKU', next.skus.some((s) => 'imageFileId' in s), false);
  check('🔴 không còn barcode cũ', next.skus.some((s) => 'barcode' in s), false);
  check('🔴 không chép Seller SKU cũ — sinh lại', next.skus.map((s) => s.sellerSku), ['TEE-BLACK-S', 'TEE-WHITE-S']);
  check('form cũ không bị sửa', JSON.stringify(original), snapshot);

  next.shopIds.push('shop-x');
  next.attributeValues.a1.valueIds.push('v2');
  next.variations[0].values.push('Red');
  check('🔴 form mới không dùng chung tham chiếu với form cũ', JSON.stringify(original), snapshot);

  const seeded = carryOverCustomListingForm(fullForm(), {
    seed: (options) => (options[0].value === 'Black' ? { sellerSku: 'TPL-BLACK-S', barcode: 'TPL-BC' } : null),
  });
  check('Seller SKU / barcode lấy từ mẫu nếu có', [seeded.skus[0].sellerSku, seeded.skus[0].barcode], ['TPL-BLACK-S', 'TPL-BC']);

  const renew = carryOverCustomListingForm(fullForm());
  renew.title = 'New product';
  renew.images = [{ imageUrl: 'https://cdn/new.jpg', fileId: 'f-new', imageType: 'MAIN' }];
  const payload = buildCustomListingPayload(renew);
  check('Payload mới mang shop + group đã giữ', [payload.shopIds, payload.templates?.groupTemplateId], [['shop-a', 'shop-b'], 'tpl-group']);
  check('Payload mới: danh mục, mô tả, package đã giữ', [
    payload.product.manualData?.category?.tiktokCategoryId,
    payload.product.manualData?.description,
    payload.product.manualData?.package?.weight,
  ], ['1237008', '<p>Shared description</p>', '300']);
  check('Payload mới: giá + tồn 0 đã giữ', payload.product.manualData?.skus?.map((s) => [s.salePrice, s.quantity]), [['19.99', 0], ['21.00', 7]]);
  check('🔴 Payload mới KHÔNG có ảnh / SKU cũ', [
    payload.product.images?.map((image) => image.fileId),
    JSON.stringify(payload).includes('f-black'),
    JSON.stringify(payload).includes('OLD-PRODUCT'),
  ], [['f-new'], false, false]);
  check('Payload mới không mang image template cũ', payload.templates?.imageTemplateId, null);
  check('Form mới đủ điều kiện đăng khi đã nhập tiêu đề', checkCustomListingForm(renew, 'SUBMIT', 'GBP'), []);
  check('Chưa nhập tiêu đề ⇒ vẫn bắt nhập', checkCustomListingForm(carryOverCustomListingForm(fullForm()), 'SUBMIT', 'GBP'), ['TITLE_REQUIRED']);

  const carry = { form: renew, attributes: [] };
  const token = stashCustomListingCarry('org-1:user-1', carry);
  check('đúng chủ + token ⇒ đọc được', peekCustomListingCarry(token, 'org-1:user-1') === carry, true);
  check('đọc lại nhiều lần được (StrictMode)', peekCustomListingCarry(token, 'org-1:user-1') === carry, true);
  check('🔴 người dùng khác ⇒ không đọc được', peekCustomListingCarry(token, 'org-1:user-2'), null);
  check('🔴 tổ chức khác ⇒ không đọc được', peekCustomListingCarry(token, 'org-2:user-1'), null);
  check('chưa biết chủ ⇒ không đọc được', peekCustomListingCarry(token, null), null);
  check('token sai ⇒ không đọc được', peekCustomListingCarry('khac', 'org-1:user-1'), null);
  check('không có token ⇒ form rỗng', peekCustomListingCarry(undefined, 'org-1:user-1'), null);
  clearCustomListingCarry('khac');
  check('xoá token khác không ảnh hưởng', peekCustomListingCarry(token, 'org-1:user-1') === carry, true);
  clearCustomListingCarry(token);
  check('🔴 dọn rồi ⇒ không dùng lại được', peekCustomListingCarry(token, 'org-1:user-1'), null);
}

// ---------------------------------------------------------------------------
// I. Ảnh biến thể bằng URL
// ---------------------------------------------------------------------------
{
  check('URL trống', checkSingleImageUrl('   ').problem, 'EMPTY');
  check('URL sai định dạng', checkSingleImageUrl('khong-phai-url').problem, 'INVALID');
  check('không phải http/https', checkSingleImageUrl('ftp://host/a.jpg').problem, 'NOT_HTTP');
  check('javascript: bị từ chối', checkSingleImageUrl('javascript:alert(1)').problem, 'NOT_HTTP');
  check('URL quá dài', checkSingleImageUrl(`https://a.co/${'x'.repeat(2100)}`).problem, 'TOO_LONG');
  check('nhiều URL trong một ô', checkSingleImageUrl('https://a.co/1.jpg https://a.co/2.jpg').problem, 'MULTIPLE');
  check('URL hợp lệ, đã trim', checkSingleImageUrl('  https://a.co/1.jpg ').url, 'https://a.co/1.jpg');

  const image = { fileId: 'f-1', url: 'https://storage/1.jpg' };
  const typed = variationUrlReducer(EMPTY_VARIATION_URL, { type: 'INPUT', input: 'https://a.co/1.jpg' });
  const loading = variationUrlReducer(typed, { type: 'START', requestId: 5 });
  check('đang tải ⇒ LOADING', loading.status, 'LOADING');
  const preview = variationUrlReducer(loading, { type: 'LOADED', requestId: 5, image });
  check('server tải xong ⇒ chờ trình duyệt hiển thị, CHƯA dùng được', [preview.status, preview.image?.fileId], ['PREVIEW', 'f-1']);
  const ready = variationUrlReducer(preview, { type: 'PREVIEW_OK', requestId: 5 });
  check('ảnh hiển thị được ⇒ READY', ready.status, 'READY');

  const broken = variationUrlReducer(preview, { type: 'PREVIEW_ERROR', requestId: 5 });
  check('🔴 ảnh lỗi khi hiển thị ⇒ không dùng được', [broken.status, broken.image, broken.previewFailed], ['ERROR', null, true]);

  const fetchFailed = variationUrlReducer(loading, { type: 'FAILED', requestId: 5, message: 'URL không trả về ảnh JPEG, PNG hoặc WEBP' });
  check('🔴 URL không phải ảnh / không truy cập được ⇒ hiện đúng lỗi server', [fetchFailed.status, fetchFailed.errorMessage, fetchFailed.image], ['ERROR', 'URL không trả về ảnh JPEG, PNG hoặc WEBP', null]);

  const changed = variationUrlReducer(ready, { type: 'INPUT', input: 'https://a.co/2.jpg' });
  check('🔴 đổi URL sau khi có preview ⇒ xoá preview', [changed.status, changed.image], ['IDLE', null]);

  const stale: VariationUrlState = variationUrlReducer(variationUrlReducer(loading, { type: 'INPUT', input: 'https://a.co/other.jpg' }), {
    type: 'LOADED',
    requestId: 5,
    image,
  });
  check('🔴 đổi URL lúc đang tải ⇒ kết quả URL cũ bị bỏ', [stale.status, stale.image, stale.input], ['IDLE', null, 'https://a.co/other.jpg']);
  const staleError = variationUrlReducer(variationUrlReducer(loading, { type: 'INPUT', input: 'x' }), { type: 'FAILED', requestId: 5, message: 'cũ' });
  check('🔴 lỗi của URL cũ không hiện cho URL mới', staleError.errorMessage, null);

  const images = { Black: { fileId: 'f-black', url: 'b' }, White: { fileId: 'f-white', url: 'w' } };
  const assigned = setVariationImage(images, 'Black', image);
  check('🔴 gắn đúng biến thể, biến thể khác giữ nguyên', [assigned.Black.fileId, assigned.White.fileId], ['f-1', 'f-white']);

  // Luồng thật của form: ảnh URL đi qua đúng `handleVariationsChange` (reconcile + derive) như ảnh tải từ máy.
  const form = emptyCustomListingForm();
  form.title = 'A';
  form.shopIds = ['s'];
  const before: ManualVariation[] = [{ name: 'Color', values: ['Black', 'White'] }, { name: 'Size', values: ['S', 'M'] }];
  const row = (color: string, size: string) => ({
    sellerSku: `${color}-${size}`,
    optionValues: [{ name: 'Color', value: color }, { name: 'Size', value: size }],
    salePrice: '10',
    retailPrice: '',
    quantity: 0,
  });
  const rows = [row('Black', 'S'), row('Black', 'M'), row('White', 'S'), row('White', 'M')];
  const after: ManualVariation[] = [
    { ...before[0], images: [{ value: 'Black', fileId: 'f-url', url: 'https://storage/url.jpg' }] },
    before[1],
  ];
  form.variations = after;
  form.skus = reconcileSkus(before, after, rows);
  check('🔴 ảnh URL chỉ gắn vào các dòng của Black', form.skus.map((s) => s.imageFileId ?? null), ['f-url', 'f-url', null, null]);

  const manual = buildManualData(form);
  check('🔴 submit gửi fileId Storage, không gửi URL nguồn vào trường id', manual.skus?.map((s) => s.imageFileId ?? null), ['f-url', 'f-url', null, null]);
  check('submit giữ ảnh ở trục đầu', manual.variations?.[0].images?.map((i) => [i.value, i.fileId]), [['Black', 'f-url']]);
  check('Đổi trục rồi quay lại: ảnh vẫn đúng giá trị', deriveVariantImages(form.skus, form.variations).map((s) => s.imageFileId ?? null), ['f-url', 'f-url', null, null]);

  const replaced: ManualVariation[] = [
    { ...before[0], images: [{ value: 'Black', fileId: 'f-url', url: 'u' }, { value: 'White', fileId: 'f-white', url: 'w' }] },
    before[1],
  ];
  const skus2 = reconcileSkus(after, replaced, form.skus);
  check('gắn ảnh cho White không đổi ảnh của Black', skus2.map((s) => s.imageFileId ?? null), ['f-url', 'f-url', 'f-white', 'f-white']);
}

// ---------------------------------------------------------------------------
// III. Tồn kho 0
// ---------------------------------------------------------------------------
{
  const sku = (quantity: unknown) => ({
    sellerSku: 'A',
    optionValues: [],
    salePrice: '10',
    quantity: quantity as number,
  });
  check('tồn 0 hợp lệ', isUsableSku(sku(0)), true);
  check('tồn dương hợp lệ', isUsableSku(sku(5)), true);
  check('tồn bỏ trống hợp lệ (undefined)', isUsableSku(sku(undefined)), true);
  check('tồn null hợp lệ', isUsableSku(sku(null)), true);
  check('tồn âm không hợp lệ', isUsableSku(sku(-1)), false);
  check('tồn lẻ không hợp lệ', isUsableSku(sku(1.5)), false);
  check('NaN không hợp lệ', isUsableSku(sku(Number.NaN)), false);
  check('chuỗi rỗng không hợp lệ', isUsableSku(sku('')), false);

  const form = fullForm();
  check('form có tồn 0 qua được kiểm tra trước khi đăng', checkCustomListingForm(form, 'SUBMIT', 'GBP'), []);
  check(
    '🔴 tồn 0 giữ nguyên trong payload',
    buildCustomListingPayload(form).product.manualData?.skus?.map((s) => s.quantity),
    [0, 7],
  );

  const template = {
    id: 't',
    name: 'T',
    defaultQuantity: 50,
    defaultSalePrice: '10.00',
    defaultRetailPrice: null,
    skuPrefix: null,
    skuSuffix: null,
    variants: [{ name: 'Size', sortOrder: 0, values: [{ value: 'S', sortOrder: 0 }, { value: 'M', sortOrder: 1 }] }],
    items: [
      { id: '1', variantName: 'S', skuCode: 'S1', quantity: 0, salePrice: '10.00', retailPrice: null, isActive: true, values: [] },
      { id: '2', variantName: 'M', skuCode: 'M1', quantity: 9, salePrice: '10.00', retailPrice: null, isActive: true, values: [] },
    ],
  } as unknown as PodSkuTemplate;
  check('🔴 SKU Template có tồn 0 ⇒ KHÔNG đổi thành tồn mặc định', applySkuTemplate(template).skus.map((s) => s.quantity), [0, 9]);
}

console.log(`${failed === 0 ? '✓' : '✗'} Custom Listing (bước sau đăng, ảnh URL, tồn 0): ${passed} đạt, ${failed} hỏng`);
if (failed > 0) process.exit(1);
