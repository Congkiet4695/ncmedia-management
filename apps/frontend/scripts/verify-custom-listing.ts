/**
 * Kiểm chứng trạng thái form **Custom Listing** — `npm run test:custom-listing`.
 *
 * 🔴 Hai bất biến quan trọng nhất:
 *
 *  1. **Lưu rồi mở lại phải ra đúng form đã nhập.** `buildCustomListingPayload` và
 *     `restoreCustomListingForm` là nghịch đảo của nhau: danh mục, brand, thuộc tính, mô tả,
 *     ảnh (kèm thứ tự và ảnh chính), bảng size, video, biến thể, SKU, đóng gói, shop, mẫu —
 *     không trường nào được rơi rụng giữa đường.
 *  2. **Danh mục không phụ thuộc danh sách đang tải.** Form giữ mã + nhãn của danh mục đã
 *     chọn; payload đọc từ form, KHÔNG tra ngược danh sách tìm kiếm — nên chọn "Poster" từ kết
 *     quả tìm, dọn ô tìm kiếm, rồi lưu vẫn ra đúng Poster.
 *
 * Chạy: `npm run test:custom-listing`
 */

import {
  buildCustomListingPayload,
  buildManualData,
  buildUpdateCustomListingPayload,
  checkCustomListingForm,
  emptyCustomListingForm,
  hasUnsendableDescriptionImage,
  pruneAttributeValues,
  restoreCustomListingForm,
  type CustomListingForm,
} from '../features/pod-listing-session/custom-listing-state.ts';
import type {
  PodListingSessionDetail,
  PodSessionProduct,
} from '../features/pod-listing-session/types.ts';
import { currencyForMarket, type PodCategoryAttributeDef } from '../features/pod-listing/types.ts';

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

/** Form đã điền ĐẦY ĐỦ — mọi khu vực nhập tay, kèm hai mẫu đang chọn (chế độ kết hợp). */
function fullForm(): CustomListingForm {
  const form = emptyCustomListingForm();
  form.market = 'US';
  form.shopIds = ['shop-a', 'shop-b'];
  form.title = 'Vintage Sunset Poster';
  form.searchTerms = 'poster, wall art , ,gift';
  form.highlights = '250gsm matte\n\nPrinted to order';
  // Poster nằm ngoài 500 dòng đầu của cây danh mục — form giữ mã + nhãn, không tra lại.
  form.category = { id: '1237008', name: 'Posters', path: 'Home Supplies > Home Decor > Posters' };
  form.attributeValues = {
    '100001': { valueIds: ['v-paper'], customValues: [] },
    '100002': { valueIds: [], customValues: ['24x36'] },
  };
  form.brand = { id: 'brand-9', name: 'NCMedia' };
  form.description = '<p>Mô tả <img src="https://cdn.example/desc.jpg"></p>';
  form.pkg = { weight: '300', weightUnit: 'GRAM', length: '30', width: '20', height: '2', dimensionUnit: 'CENTIMETER' };
  form.images = [
    { imageUrl: 'https://cdn.example/main.jpg', fileId: 'f-main', imageType: 'MAIN' },
    { imageUrl: 'https://cdn.example/second.jpg', fileId: 'f-second', imageType: 'MAIN' },
  ];
  form.sizeChart = { imageUrl: 'https://cdn.example/size.jpg', fileId: 'f-size', imageType: 'SIZE_CHART' };
  form.video = { fileId: 'f-video', fileName: 'demo.mp4' };
  form.variations = [{ name: 'Size', values: ['S', 'M', ''] }];
  form.skus = [
    { sellerSku: 'POSTER-S', optionValues: [{ name: 'Size', value: 'S' }], salePrice: '9.99', retailPrice: '14.99', quantity: 5 },
    { sellerSku: 'POSTER-M', optionValues: [{ name: 'Size', value: 'M' }], salePrice: '12.99', retailPrice: '', quantity: 3 },
  ];
  form.warehouseId = 'wh-1';
  form.templates = { category: '', description: 'dt-1', sku: '', image: 'it-1' };
  return form;
}

const definitions: PodCategoryAttributeDef[] = [
  {
    id: 'a1',
    tiktokAttributeId: '100001',
    name: 'Material',
    type: 'PRODUCT_PROPERTY',
    isRequired: true,
    isMultipleSelection: false,
    isCustomizable: false,
    valueDataFormat: null,
    values: [{ id: 'v-paper', name: 'Paper' }, { id: 'v-canvas', name: 'Canvas' }],
  },
  {
    id: 'a2',
    tiktokAttributeId: '100002',
    name: 'Size',
    type: 'PRODUCT_PROPERTY',
    isRequired: false,
    isMultipleSelection: true,
    isCustomizable: true,
    valueDataFormat: null,
    values: [{ id: 'v-a4', name: 'A4' }],
  },
];

/** Giả lập những gì backend lưu rồi trả về từ payload — đúng hình dạng API. */
function persist(form: CustomListingForm): { session: PodListingSessionDetail; product: PodSessionProduct } {
  const payload = buildCustomListingPayload(form, { definitions });
  const templates = payload.templates ?? {};
  const rows = (
    [
      ['CATEGORY', 'categoryTemplateId'],
      ['SKU', 'skuTemplateId'],
      ['DESCRIPTION', 'descriptionTemplateId'],
      ['IMAGE', 'imageTemplateId'],
    ] as const
  )
    .filter(([, key]) => templates[key])
    .map(([type, key]) => ({
      id: `row-${type}`,
      templateType: type,
      templateName: type,
      categoryTemplateId: key === 'categoryTemplateId' ? (templates[key] as string) : null,
      skuTemplateId: key === 'skuTemplateId' ? (templates[key] as string) : null,
      descriptionTemplateId: key === 'descriptionTemplateId' ? (templates[key] as string) : null,
      imageTemplateId: key === 'imageTemplateId' ? (templates[key] as string) : null,
      pricingStrategyId: null,
    }));

  const session = {
    id: 's-1',
    name: payload.product.title,
    market: payload.market,
    status: 'DRAFT',
    source: 'CUSTOM',
    note: null,
    sourceFile: null,
    importedAt: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
    platform: { id: 'p', code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
    shops: payload.shopIds.map((shopId) => ({ shopId, shop: { id: shopId, name: shopId, region: 'US' } })),
    templates: rows,
    counts: { TOTAL: 1, DRAFT: 1, READY: 0, QUEUED: 0, UPLOADED: 0, PUBLISHED: 0, FAILED: 0, SKIPPED: 0 },
    lastJob: null,
  } as unknown as PodListingSessionDetail;

  // Ảnh trả về theo thứ tự NGẪU NHIÊN để chứng minh restore sắp lại theo `sortOrder`.
  const images = (payload.product.images ?? [])
    .map((image, index) => ({
      id: `img-${index}`,
      imageUrl: image.imageUrl,
      imageType: image.imageType ?? 'MAIN',
      sortOrder: image.sortOrder ?? index,
      fileId: image.fileId ?? null,
      remoteUri: null,
    }))
    .reverse();

  const product = {
    id: 'sp-1',
    sessionId: 's-1',
    title: payload.product.title,
    sourceRow: null,
    status: 'DRAFT',
    issues: null,
    errorCount: 0,
    uploadError: null,
    uploadedAt: null,
    importOrder: 0,
    createdAt: '',
    updatedAt: '',
    images,
    manualData: JSON.parse(JSON.stringify(payload.product.manualData ?? null)),
  } as unknown as PodSessionProduct;

  return { session, product };
}

// ---------------------------------------------------------------------------
console.log('Lưu nháp → mở lại');
{
  const original = fullForm();
  const { session, product } = persist(original);
  const restored = restoreCustomListingForm(session, product);

  check('market + shop', [restored.market, restored.shopIds], ['US', ['shop-a', 'shop-b']]);
  check('tiêu đề', restored.title, original.title);
  check('từ khoá chuẩn hoá (bỏ rỗng, cắt khoảng trắng)', restored.searchTerms, 'poster, wall art, gift');
  check('highlights bỏ dòng trống', restored.highlights, '250gsm matte\nPrinted to order');
  check('🔴 danh mục Poster giữ nguyên mã + tên + đường dẫn', restored.category, original.category);
  check('thuộc tính (chính thức + tự nhập)', restored.attributeValues, original.attributeValues);
  check('brand kèm tên', restored.brand, original.brand);
  check('mô tả HTML kèm ảnh chèn', restored.description, original.description);
  check('đóng gói', restored.pkg, original.pkg);
  check('ảnh đúng THỨ TỰ, ảnh chính đứng đầu, giữ fileId', restored.images, original.images);
  check('bảng size', restored.sizeChart, original.sizeChart);
  check('video', restored.video, original.video);
  check('trục biến thể (bỏ giá trị rỗng)', restored.variations, [{ name: 'Size', values: ['S', 'M'] }]);
  check('bảng SKU', restored.skus, original.skus);
  check('kho', restored.warehouseId, 'wh-1');
  check('mẫu đang chọn', restored.templates, original.templates);
}

// ---------------------------------------------------------------------------
console.log('Payload: form là nguồn sự thật, không tra ngược danh sách');
{
  const form = fullForm();
  const manual = buildManualData(form, { definitions });
  check('category từ form', manual.category, { tiktokCategoryId: '1237008', name: 'Posters', path: 'Home Supplies > Home Decor > Posters' });
  check('brand luôn đi kèm danh mục', manual.brand, { tiktokBrandId: 'brand-9', name: 'NCMedia' });
  check(
    'thuộc tính theo ĐỊNH NGHĨA danh mục, mang tên giá trị',
    manual.attributes?.map((a) => [a.tiktokAttributeId, a.isRequired, a.values, a.customValues]),
    [
      ['100001', true, [{ id: 'v-paper', name: 'Paper' }], []],
      ['100002', false, [], ['24x36']],
    ],
  );
  check('searchTerms cắt tối đa 15 + bỏ rỗng', manual.searchTerms, ['poster', 'wall art', 'gift']);
  check('warehouseId', manual.warehouseId, 'wh-1');

  const payload = buildCustomListingPayload(form, { definitions });
  check('mẫu chọn ⇒ templates của lượt (ô trống = null)', payload.templates, {
    categoryTemplateId: null,
    descriptionTemplateId: 'dt-1',
    skuTemplateId: null,
    imageTemplateId: 'it-1',
  });
  check(
    'bảng size đi chung mảng ảnh với imageType SIZE_CHART, kèm fileId, sortOrder liên tục',
    payload.product.images?.map((i) => [i.imageType, i.fileId, i.sortOrder]),
    [['MAIN', 'f-main', 0], ['MAIN', 'f-second', 1], ['SIZE_CHART', 'f-size', 2]],
  );

  const update = buildUpdateCustomListingPayload(form, { definitions });
  check('payload sửa: không có name (tên lượt theo tiêu đề), có product đầy đủ', Object.keys(update), ['market', 'shopIds', 'templates', 'product']);

  // Không chọn danh mục ⇒ không gửi category/brand/attributes ⇒ backend rơi về template.
  const empty = emptyCustomListingForm();
  empty.title = 'x';
  check('form trống ⇒ manualData không có trường thừa', buildManualData(empty, { definitions }), {});
  // Brand "No brand" chọn tay khi CÓ danh mục ⇒ gửi tường minh (thắng brand của mẫu).
  const noBrand = fullForm();
  noBrand.brand = { id: '', name: '' };
  check('No brand tường minh', buildManualData(noBrand, { definitions }).brand, { tiktokBrandId: null, name: null });
}

// ---------------------------------------------------------------------------
console.log('Thuộc tính khi định nghĩa chưa nạp / khi đổi danh mục');
{
  const form = fullForm();
  const saved = [
    { tiktokAttributeId: '100001', name: 'Material', isRequired: true, values: [{ id: 'v-paper', name: 'Paper' }], customValues: [] },
    { tiktokAttributeId: '999', name: 'Cũ', isRequired: false, values: [], customValues: ['x'] },
  ];
  check(
    '🔴 chưa nạp định nghĩa ⇒ giữ bộ đã lưu (chỉ những khoá còn trên form), KHÔNG gửi []',
    buildManualData(form, { fallback: saved }).attributes?.map((a) => a.tiktokAttributeId),
    ['100001'],
  );

  const pruned = pruneAttributeValues(
    {
      '100001': { valueIds: ['v-paper', 'v-gone'], customValues: ['bỏ vì không customizable'] },
      '100002': { valueIds: [], customValues: ['24x36'] },
      '777': { valueIds: ['v-x'], customValues: [] },
    },
    definitions,
  );
  check('đổi danh mục: giữ giá trị còn hợp lệ, bỏ value_id lạ, bỏ thuộc tính không thuộc danh mục mới', pruned, {
    '100001': { valueIds: ['v-paper'], customValues: [] },
    '100002': { valueIds: [], customValues: ['24x36'] },
  });
}

// ---------------------------------------------------------------------------
console.log('Kiểm nhanh trước khi gửi — theo DỮ LIỆU, không theo "đã chọn mẫu chưa"');
{
  const form = fullForm();
  check('đủ dữ liệu ⇒ không lỗi', checkCustomListingForm(form, 'SUBMIT', 'USD'), []);

  const noCategory = fullForm();
  noCategory.category = { id: '', name: '', path: '' };
  check('thiếu danh mục và không có Category Template ⇒ CATEGORY_REQUIRED', checkCustomListingForm(noCategory, 'SUBMIT', 'USD'), ['CATEGORY_REQUIRED']);
  noCategory.templates.category = 'ct-1';
  check('thiếu danh mục nhưng có Category Template ⇒ qua', checkCustomListingForm(noCategory, 'SUBMIT', 'USD'), []);

  const noSku = fullForm();
  noSku.skus = [];
  check('không SKU và không SKU Template ⇒ SKU_REQUIRED', checkCustomListingForm(noSku, 'SUBMIT', 'USD'), ['SKU_REQUIRED']);
  noSku.templates.sku = 'st-1';
  check('không SKU nhưng có SKU Template ⇒ qua', checkCustomListingForm(noSku, 'SUBMIT', 'USD'), []);

  const badSku = fullForm();
  badSku.skus[0] = { ...badSku.skus[0], salePrice: '0' };
  check('SKU giá 0 ⇒ SKU_INVALID', checkCustomListingForm(badSku, 'SUBMIT', 'USD'), ['SKU_INVALID']);

  const draft = fullForm();
  draft.category = { id: '', name: '', path: '' };
  draft.skus = [];
  check('lưu nháp chỉ cần tiêu đề + shop', checkCustomListingForm(draft, 'DRAFT', 'USD'), []);
  draft.shopIds = [];
  draft.title = '';
  check('nháp thiếu tiêu đề + shop', checkCustomListingForm(draft, 'DRAFT', 'USD'), ['TITLE_REQUIRED', 'SHOP_REQUIRED']);
}


// ---------------------------------------------------------------------------
console.log('Tiền tệ theo thị trường — hiện trước, chặn sớm (backend tra lại theo shop)');
{
  check('US ⇒ USD', currencyForMarket('US'), 'USD');
  check('UK ⇒ GBP', currencyForMarket('UK'), 'GBP');
  check('EU/DE/IE ⇒ EUR', [currencyForMarket('EU'), currencyForMarket('DE'), currencyForMarket('IE')], ['EUR', 'EUR', 'EUR']);
  check('thị trường lạ ⇒ null', currencyForMarket('ZZ'), null);

  const form = fullForm();
  check('có giá nhưng không tra được tiền tệ ⇒ CURRENCY_REQUIRED', checkCustomListingForm(form, 'SUBMIT', currencyForMarket('ZZ')), ['CURRENCY_REQUIRED']);
  check('đổi Market sang UK ⇒ hết lỗi (GBP)', checkCustomListingForm(form, 'SUBMIT', currencyForMarket('UK')), []);
  const noPrice = fullForm();
  noPrice.skus = noPrice.skus.map((sku) => ({ ...sku, salePrice: '', retailPrice: '' }));
  check('không có giá ⇒ không đòi tiền tệ (SKU_INVALID vì thiếu giá bán)', checkCustomListingForm(noPrice, 'SUBMIT', null), ['SKU_INVALID']);
}

// ---------------------------------------------------------------------------
console.log('Ảnh trong mô tả — chỉ ảnh đã tải lên (http) mới đi được lên TikTok');
{
  check('http ⇒ hợp lệ', hasUnsendableDescriptionImage('<p>x</p><img src="https://cdn.ncmedia.test/a.jpg" width="1">'), false);
  check('data: ⇒ chặn', hasUnsendableDescriptionImage('<img src="data:image/png;base64,AAA">'), true);
  check('blob: ⇒ chặn', hasUnsendableDescriptionImage("<img src='blob:https://app/x'>"), true);
  check('src rỗng ⇒ chặn', hasUnsendableDescriptionImage('<img src="" alt="x">'), true);
  const form = fullForm();
  form.description = '<p>ok</p><img src="data:image/png;base64,AAA">';
  check('precheck SUBMIT ⇒ DESCRIPTION_IMAGE_INVALID', checkCustomListingForm(form, 'SUBMIT', 'USD'), ['DESCRIPTION_IMAGE_INVALID']);
}

console.log(`\n${passed} đạt · ${failed} lỗi`);
if (failed > 0) process.exit(1);
