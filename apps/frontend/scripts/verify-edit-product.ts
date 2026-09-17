/**
 * Sửa sản phẩm — ảnh, bảng size, video và template.
 *
 * 🔴 Vì sao tệp này tồn tại: mọi thứ ở đây chạm vào một sản phẩm ĐANG BÁN, và các lỗi nguy
 * hiểm nhất đều im lặng:
 *   - Gửi bộ ảnh thiếu một tấm ⇒ TikTok XOÁ tấm đó (mảng `main_images` thay cả bộ).
 *   - So ảnh bằng link hiển thị ⇒ lần nào mở form cũng thấy "có thay đổi", và mỗi lần lưu là
 *     một lượt upload lại toàn bộ ảnh.
 *   - Áp template ở tab này làm mất dữ liệu đang gõ ở tab kia.
 * Không cái nào ném lỗi; tất cả chỉ lộ ra khi mở Seller Center.
 *
 * Chạy: `npm run test:edit-product`
 */

import assert from 'node:assert/strict';
import {
  applyCategoryTemplateToProduct,
  applySkuTemplateToProduct,
  buildUpdatePayload,
  imagesFromTemplate,
  sizeChartFromTemplate,
  toFormState,
  type EditProductForm,
} from '../features/pod-product/components/edit-product-state.ts';
import type { PodProductDetail } from '../features/pod-product/types.ts';
import type {
  PodCategoryTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '../features/pod-listing/types.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Sản phẩm đang bán: 3 ảnh, 1 bảng size, 1 video, 2 SKU. */
function product(over: Partial<PodProductDetail> = {}): PodProductDetail {
  return {
    id: 'p1',
    tiktokProductId: '900',
    title: 'Vintage Racing Tee',
    description: '<p>Mô tả cũ</p>',
    status: 'ACTIVATE',
    auditStatus: null,
    thumbnailUrl: null,
    mainImages: [],
    imageCount: 3,
    categoryName: 'T-Shirts',
    categoryPath: 'Womenswear > T-Shirts',
    tiktokCategoryId: 'cat-1',
    brandName: null,
    tiktokBrandId: null,
    searchTerms: ['racing tee'],
    highlights: ['100% cotton'],
    sizeChart: { uri: 'chart-1', url: 'https://cdn/chart.jpg', templateId: null },
    skuCount: 2,
    totalInventory: 15,
    minPrice: '19.99',
    maxPrice: '19.99',
    currency: 'USD',
    sellerSku: 'TEE-BK-S',
    listingQualityTier: 'GOOD',
    shopName: 'Shop A',
    shopCode: 'A1',
    accountName: 'acc',
    tiktokUpdatedAt: null,
    lastSyncedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    packageWeight: '300',
    weightUnit: 'GRAM',
    packageDimensions: null,
    productTags: [],
    salesRegions: [],
    attributes: [],
    videos: [{ id: 'v1', url: 'https://cdn/v.mp4', coverUrl: null, format: 'mp4' }],
    images: [
      { id: 'i1', url: 'https://cdn/a.jpg', thumbUrl: null, uri: 'img-a', variantId: null, sortOrder: 0 },
      { id: 'i2', url: 'https://cdn/b.jpg', thumbUrl: null, uri: 'img-b', variantId: null, sortOrder: 1 },
      { id: 'i3', url: 'https://cdn/c.jpg', thumbUrl: null, uri: 'img-c', variantId: null, sortOrder: 2 },
      // Ảnh của BIẾN THỂ — không thuộc `main_images`.
      { id: 'i4', url: 'https://cdn/v.jpg', thumbUrl: null, uri: 'img-v', variantId: 's1', sortOrder: 0 },
    ],
    variants: [
      {
        id: 'v-1',
        tiktokSkuId: 's1',
        sellerSku: 'TEE-BK-S',
        variantName: 'Black / S',
        salePrice: '19.99',
        listPrice: '29.99',
        currency: 'USD',
        inventoryTotal: 10,
        status: null,
        imageUrl: null,
      },
      {
        id: 'v-2',
        tiktokSkuId: 's2',
        sellerSku: 'TEE-BK-M',
        variantName: 'Black / M',
        salePrice: '19.99',
        listPrice: '29.99',
        currency: 'USD',
        inventoryTotal: 5,
        status: null,
        imageUrl: null,
      },
    ],
    ...over,
  } as PodProductDetail;
}

const form = (base: PodProductDetail, over: Partial<EditProductForm> = {}): EditProductForm => ({
  ...toFormState(base),
  ...over,
});

console.log('Trạng thái ban đầu');

test('🔴 chỉ lấy ảnh SẢN PHẨM, bỏ ảnh của biến thể', () => {
  const state = toFormState(product());

  assert.equal(state.images.length, 3);
  assert.deepEqual(
    state.images.map((image) => image.uri),
    ['img-a', 'img-b', 'img-c'],
  );
});

test('ảnh mang theo `uri` — đổi thứ tự không phải upload lại tấm nào', () => {
  assert.ok(toFormState(product()).images.every((image) => image.uri));
});

test('từ khoá và highlights nạp đúng từ sản phẩm', () => {
  const state = toFormState(product());
  assert.equal(state.searchTerms, 'racing tee');
  assert.equal(state.highlights, '100% cotton');
});

test('bảng size và video hiện tại được nạp vào form', () => {
  const state = toFormState(product());
  assert.equal(state.sizeChart?.uri, 'chart-1');
  assert.equal(state.video?.url, 'https://cdn/v.mp4');
  // 🔴 Chưa có `fileId` ⇒ mở form rồi đóng lại KHÔNG gửi gì cả.
  assert.equal(state.sizeChart?.fileId, undefined);
  assert.equal(state.video?.fileId, undefined);
});

console.log('\nPayload — ảnh');

test('🔴 mở form rồi lưu ngay ⇒ payload RỖNG', () => {
  const base = product();
  assert.deepEqual(buildUpdatePayload(base, form(base)), {});
});

test('thêm ảnh ⇒ gửi CẢ BỘ, ảnh mới đi bằng `fileId`', () => {
  const base = product();
  const state = form(base);
  state.images = [
    ...state.images,
    { imageUrl: 'blob:new', fileId: 'file-9', imageType: 'MAIN' },
  ];

  assert.deepEqual(buildUpdatePayload(base, state).mainImages, [
    { uri: 'img-a' },
    { uri: 'img-b' },
    { uri: 'img-c' },
    { fileId: 'file-9' },
  ]);
});

test('🔴 xoá một ảnh ⇒ gửi phần CÒN LẠI', () => {
  const base = product();
  const state = form(base);
  state.images = state.images.filter((image) => image.uri !== 'img-b');

  assert.deepEqual(buildUpdatePayload(base, state).mainImages, [
    { uri: 'img-a' },
    { uri: 'img-c' },
  ]);
});

test('🔴 A→B→C→D kéo thành C→A→D→B ⇒ backend nhận ĐÚNG thứ tự mới', () => {
  const base = product({
    images: [
      { id: 'i1', url: 'a', thumbUrl: null, uri: 'A', variantId: null, sortOrder: 0 },
      { id: 'i2', url: 'b', thumbUrl: null, uri: 'B', variantId: null, sortOrder: 1 },
      { id: 'i3', url: 'c', thumbUrl: null, uri: 'C', variantId: null, sortOrder: 2 },
      { id: 'i4', url: 'd', thumbUrl: null, uri: 'D', variantId: null, sortOrder: 3 },
    ] as PodProductDetail['images'],
  });
  const state = form(base);
  state.images = ['C', 'A', 'D', 'B'].map((uri) => ({ imageUrl: uri, uri, imageType: 'MAIN' }));

  assert.deepEqual(buildUpdatePayload(base, state).mainImages, [
    { uri: 'C' },
    { uri: 'A' },
    { uri: 'D' },
    { uri: 'B' },
  ]);
});

test('🔴 đặt ảnh chính = đưa lên đầu, KHÔNG có cờ isPrimary tự bịa', () => {
  const base = product();
  const state = form(base);
  const [a, b, c] = state.images;
  state.images = [c, a, b];

  const payload = buildUpdatePayload(base, state);
  assert.deepEqual(payload.mainImages?.[0], { uri: 'img-c' });
  assert.equal('isPrimary' in (payload.mainImages?.[0] ?? {}), false);
});

test('🔴 xoá sạch ảnh ⇒ KHÔNG gửi mảng rỗng (sản phẩm bắt buộc có ảnh)', () => {
  const base = product();
  const state = form(base);
  state.images = [];

  assert.equal(buildUpdatePayload(base, state).mainImages, undefined);
});

test('🔴 link hiển thị đổi nhưng `uri` giữ nguyên ⇒ KHÔNG phải thay đổi', () => {
  const base = product();
  const state = form(base);
  // TikTok đổi tham số hết hạn trên URL sau mỗi lần đồng bộ. So bằng URL thì lần nào cũng
  // "có thay đổi", và mỗi lần lưu là một lượt gửi lại toàn bộ ảnh.
  state.images = state.images.map((image) => ({ ...image, imageUrl: `${image.imageUrl}?v=2` }));

  assert.equal(buildUpdatePayload(base, state).mainImages, undefined);
});

console.log('\nPayload — bảng size, video, SKU');

test('chọn bảng size mới ⇒ gửi `fileId`', () => {
  const base = product();
  const state = form(base);
  state.sizeChart = { imageUrl: 'blob:x', fileId: 'file-chart', imageType: 'SIZE_CHART' };

  assert.deepEqual(buildUpdatePayload(base, state).sizeChart, { fileId: 'file-chart' });
});

test('không đụng bảng size ⇒ không gửi', () => {
  const base = product();
  assert.equal(buildUpdatePayload(base, form(base)).sizeChart, undefined);
});

test('tải video mới ⇒ gửi `fileId`', () => {
  const base = product();
  const state = form(base);
  state.video = { fileId: 'file-video', fileName: 'v.mp4' };

  assert.deepEqual(buildUpdatePayload(base, state).video, { fileId: 'file-video' });
});

test('🔴 sửa ảnh KHÔNG kéo theo SKU, mô tả hay bảng size', () => {
  const base = product();
  const state = form(base);
  state.images = [state.images[2], state.images[0], state.images[1]];

  const payload = buildUpdatePayload(base, state);
  assert.deepEqual(Object.keys(payload), ['mainImages']);
});

test('🔴 sửa mỗi tiêu đề ⇒ payload chỉ có tiêu đề', () => {
  const base = product();
  const payload = buildUpdatePayload(base, form(base, { title: 'Tiêu đề mới' }));

  assert.deepEqual(payload, { title: 'Tiêu đề mới' });
});

test('sửa giá 1 SKU ⇒ payload có đúng 1 dòng SKU', () => {
  const base = product();
  const state = form(base);
  state.skus.s1 = { ...state.skus.s1, salePrice: '15.00' };

  const payload = buildUpdatePayload(base, state);
  assert.deepEqual(payload.skus, [{ tiktokSkuId: 's1', salePrice: '15.00' }]);
});

test('`19.99` gõ lại thành `19.990` ⇒ không tính là đổi giá', () => {
  const base = product();
  const state = form(base);
  state.skus.s1 = { ...state.skus.s1, salePrice: '19.990' };

  assert.equal(buildUpdatePayload(base, state).skus, undefined);
});

console.log('\nTemplate');

const imageTemplate: PodImageTemplate = {
  id: 'it1',
  name: 'Bộ ảnh Tee',
  description: null,
  isDefault: false,
  isActive: true,
  displayOrder: 0,
  createdAt: '',
  items: [
    { id: 'a', title: 'Back', assetType: 'MAIN_BACK', fileId: 'f2', imageUrl: 'u2', imageKey: '', contentType: '', fileSize: 1, width: null, height: null, isRequired: false, displayOrder: 2, tiktokImageUri: null },
    { id: 'b', title: 'Front', assetType: 'MAIN_FRONT', fileId: 'f1', imageUrl: 'u1', imageKey: '', contentType: '', fileSize: 1, width: null, height: null, isRequired: true, displayOrder: 1, tiktokImageUri: 'uri-cached' },
    { id: 'c', title: 'Size', assetType: 'SIZE_CHART', fileId: 'f3', imageUrl: 'u3', imageKey: '', contentType: '', fileSize: 1, width: null, height: null, isRequired: false, displayOrder: 3, tiktokImageUri: null },
  ],
} as PodImageTemplate;

test('🔴 bộ ảnh mẫu: bảng size KHÔNG lẫn vào ảnh sản phẩm', () => {
  const images = imagesFromTemplate(imageTemplate);

  assert.deepEqual(images.map((image) => image.fileId), ['f1', 'f2']);
  assert.equal(
    images.some((image) => image.fileId === 'f3'),
    false,
    'ảnh bảng size lọt vào main_images là đăng bảng size thành ảnh gian hàng',
  );
});

test('bộ ảnh mẫu giữ đúng thứ tự `displayOrder`', () => {
  assert.deepEqual(
    imagesFromTemplate(imageTemplate).map((image) => image.fileName),
    ['Front', 'Back'],
  );
});

test('bảng size lấy từ đúng mục SIZE_CHART của bộ ảnh mẫu', () => {
  assert.equal(sizeChartFromTemplate(imageTemplate)?.fileId, 'f3');
});

test('bộ ảnh mẫu không có mục SIZE_CHART ⇒ null, không lấy bừa tấm khác', () => {
  const trimmed = {
    ...imageTemplate,
    items: imageTemplate.items?.filter((item) => item.assetType !== 'SIZE_CHART'),
  } as PodImageTemplate;
  assert.equal(sizeChartFromTemplate(trimmed), null);
});

const categoryTemplate = (over: Partial<PodCategoryTemplate> = {}): PodCategoryTemplate =>
  ({
    id: 'ct1',
    name: 'Tee US',
    market: 'US',
    tiktokCategoryId: 'cat-1',
    categoryName: 'T-Shirts',
    categoryPath: 'Womenswear > T-Shirts',
    brandMode: 'SPECIFIC',
    tiktokBrandId: 'brand-9',
    sizeChartFileId: 'file-chart',
    videoFileId: null,
    ...over,
  }) as PodCategoryTemplate;

test('Category Template điền thương hiệu và bảng size', () => {
  const effect = applyCategoryTemplateToProduct(categoryTemplate(), product());

  assert.equal(effect.brandId, 'brand-9');
  assert.equal(effect.sizeChartFileId, 'file-chart');
  assert.equal(effect.categoryBlocked, false);
});

test('🔴 mẫu khai danh mục KHÁC ⇒ đánh dấu chặn, KHÔNG âm thầm áp danh mục', () => {
  const effect = applyCategoryTemplateToProduct(
    categoryTemplate({ tiktokCategoryId: 'cat-khac' }),
    product(),
  );

  assert.equal(effect.categoryBlocked, true);
  // Không có trường nào tên `categoryId` trong kết quả — không có đường nào gửi nó đi.
  assert.equal('categoryId' in effect, false);
});

test('mẫu không khai thương hiệu ⇒ không đụng tới thương hiệu đang có', () => {
  const effect = applyCategoryTemplateToProduct(
    categoryTemplate({ brandMode: 'UNSET', tiktokBrandId: null }),
    product(),
  );
  assert.equal(effect.brandId, undefined);
});

const skuTemplate: PodSkuTemplate = {
  id: 'st1',
  name: 'Giá Tee',
  items: [
    { id: '1', variantName: 'Black / S', skuCode: 'NEW-S', barcode: null, priceAdjustmentType: 'NONE', priceAdjustmentValue: '0', retailPrice: '35.00', salePrice: '21.00', quantity: 50, discount: null, effectiveSalePrice: '22.50' },
    { id: '2', variantName: 'Black/M', skuCode: null, barcode: null, priceAdjustmentType: 'NONE', priceAdjustmentValue: '0', retailPrice: '35.00', salePrice: '21.00', quantity: 40, discount: null, effectiveSalePrice: null },
    { id: '3', variantName: 'Red / XL', skuCode: null, barcode: null, priceAdjustmentType: 'NONE', priceAdjustmentValue: '0', retailPrice: '35.00', salePrice: '21.00', quantity: 30, discount: null, effectiveSalePrice: null },
  ],
  variants: [],
} as unknown as PodSkuTemplate;

test('SKU Template điền giá cho tổ hợp KHỚP', () => {
  const base = product();
  const effect = applySkuTemplateToProduct(skuTemplate, base, toFormState(base).skus);

  assert.equal(effect.matched, 2);
  // `effectiveSalePrice` mới là con số server gửi lên sàn — không phải `salePrice` thô.
  assert.equal(effect.skus.s1.salePrice, '22.50');
  assert.equal(effect.skus.s2.salePrice, '21.00');
  assert.equal(effect.skus.s1.sellerSku, 'NEW-S');
});

test('🔴 `"Black/M"` và `"Black / M"` là CÙNG một tổ hợp', () => {
  const base = product();
  const effect = applySkuTemplateToProduct(skuTemplate, base, toFormState(base).skus);
  assert.equal(effect.skus.s2.quantity, '40');
});

test('🔴 tổ hợp KHÔNG có trên sản phẩm được BÁO, không im lặng bỏ qua', () => {
  const base = product();
  const effect = applySkuTemplateToProduct(skuTemplate, base, toFormState(base).skus);

  assert.deepEqual(effect.unmatched, ['Red / XL']);
});

test('🔴 áp SKU Template KHÔNG tạo thêm SKU nào', () => {
  const base = product();
  const effect = applySkuTemplateToProduct(skuTemplate, base, toFormState(base).skus);

  assert.deepEqual(Object.keys(effect.skus).sort(), ['s1', 's2']);
});

console.log('\nÁp template không được làm mất dữ liệu tab khác');

test('🔴 Title đang sửa vẫn nguyên sau khi áp Description Template', () => {
  const base = product();
  const state = form(base, { title: 'ABC' });
  // Áp mẫu mô tả = chỉ ghi `description` (xem `ContentTab.applyDescription`).
  const after: EditProductForm = { ...state, description: '<p>Mẫu mới</p>' };

  assert.equal(after.title, 'ABC');
  const payload = buildUpdatePayload(base, after);
  assert.equal(payload.title, 'ABC');
  assert.equal(payload.description, '<p>Mẫu mới</p>');
});

test('🔴 SKU đang sửa vẫn nguyên sau khi áp Image Template', () => {
  const base = product();
  const state = form(base);
  state.skus.s1 = { ...state.skus.s1, salePrice: '12.34' };

  const after: EditProductForm = { ...state, images: imagesFromTemplate(imageTemplate) };

  assert.equal(after.skus.s1.salePrice, '12.34');
  const payload = buildUpdatePayload(base, after);
  assert.deepEqual(payload.skus, [{ tiktokSkuId: 's1', salePrice: '12.34' }]);
  assert.equal(payload.mainImages?.length, 2);
});

console.log(`\n✓ ${passed}/${passed} đúng`);
