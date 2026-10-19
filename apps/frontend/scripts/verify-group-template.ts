/**
 * Kiểm chứng **Group Template** — `npm run test:group-template`.
 *
 *  1. Quy tắc chung `planGroupApply`: khu vực nào bị thay / dọn / giữ khi chọn hoặc đổi group.
 *  2. Auto Listing: group → bộ ID template của lượt đăng (+ đổi thị trường theo Category).
 *  3. Custom Listing: group → nội dung form (danh mục + thuộc tính, bảng SKU, mô tả, bộ ảnh),
 *     đổi A → B, khu vực trống, dữ liệu nhập tay, trường ngoài phạm vi, lưu nháp ↔ mở lại.
 *  4. Form Group Template: validate + payload.
 */

import {
  applyGroupToSessionTemplates,
  planGroupApply,
} from '../features/pod-listing/group-template-apply.ts';
import {
  buildGroupTemplatePayload,
  groupTemplateFormFrom,
  validateGroupTemplateForm,
} from '../features/pod-listing/group-template-form.ts';
import {
  applyGroupToCustomForm,
  clearSlot,
  customSlotFingerprints,
} from '../features/pod-listing-session/custom-listing-group.ts';
import {
  buildCustomListingPayload,
  emptyCustomListingForm,
  restoreCustomListingForm,
  type CustomListingForm,
} from '../features/pod-listing-session/custom-listing-state.ts';
import type { PodGroupTemplate, PodGroupTemplateResolved } from '../features/pod-listing/types.ts';
import type { PodListingSessionDetail, PodSessionProduct } from '../features/pod-listing-session/types.ts';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Bản danh sách (tham chiếu) — dùng cho Auto Listing. */
function groupSummary(over: Partial<PodGroupTemplate> = {}): PodGroupTemplate {
  return {
    id: 'g-a',
    name: 'Group A',
    categoryTemplateId: 'cat-a',
    skuTemplateId: 'sku-a',
    descriptionTemplateId: 'desc-a',
    imageTemplateId: 'img-a',
    isActive: true,
    displayOrder: 0,
    note: null,
    createdAt: '',
    updatedAt: '',
    categoryTemplate: {
      id: 'cat-a',
      name: 'Tee US',
      market: 'US',
      tiktokCategoryId: '601226',
      categoryName: 'T-Shirts',
      categoryPath: 'Womenswear > T-Shirts',
      isActive: true,
    },
    skuTemplate: null,
    descriptionTemplate: null,
    imageTemplate: null,
    ...over,
  } as PodGroupTemplate;
}

const categoryTemplate = (id: string, tiktokCategoryId: string, market = 'US') =>
  ({
    id,
    name: `Cat ${id}`,
    market,
    tiktokCategoryId,
    categoryName: `Category ${tiktokCategoryId}`,
    categoryPath: `Root > Category ${tiktokCategoryId}`,
    brandMode: 'SPECIFIC',
    tiktokBrandId: 'brand-1',
    brandName: 'Gildan',
    warehouseId: null,
    packageWeight: null,
    weightUnit: null,
    packageLength: null,
    packageWidth: null,
    packageHeight: null,
    dimensionUnit: null,
    sizeChartFileId: null,
    videoFileId: null,
    attributes: [
      {
        tiktokAttributeId: 'attr-material',
        values: [{ tiktokValueId: 'v-cotton' }],
        customValues: [],
      },
    ],
  }) as never;

/** SKU Template bản CHI TIẾT: 2 trục Color × Size, 2 tổ hợp đã sinh với giá riêng. */
const skuTemplate = (id: string) =>
  ({
    id,
    name: `SKU ${id}`,
    skuPrefix: 'TEE',
    skuSuffix: null,
    currency: 'USD',
    defaultSalePrice: '19.99',
    defaultRetailPrice: null,
    defaultQuantity: 100,
    variants: [
      { name: 'Color', sortOrder: 0, values: [{ value: 'Black', sortOrder: 0, imageFileId: 'f-black', image: { publicUrl: 'https://cdn/black.png' } }] },
      { name: 'Size', sortOrder: 1, values: [{ value: 'S', sortOrder: 0 }, { value: 'M', sortOrder: 1 }] },
    ],
    items: [
      item('TEE-BLK-S', 'Black', 'S', '21.00', 5),
      item('TEE-BLK-M', 'Black', 'M', '22.00', 7),
    ],
  }) as never;

function item(skuCode: string, color: string, size: string, price: string, quantity: number) {
  return {
    skuCode,
    variantName: `${color} / ${size}`,
    isActive: true,
    quantity,
    barcode: null,
    salePrice: price,
    retailPrice: null,
    effectiveSalePrice: price,
    effectiveRetailPrice: null,
    imageFileId: null,
    values: [
      { variantValue: { value: color, variant: { name: 'Color' } } },
      { variantValue: { value: size, variant: { name: 'Size' } } },
    ],
  };
}

const descriptionTemplate = (id: string, html: string) => ({ id, name: `Desc ${id}`, contentHtml: html }) as never;

const imageTemplate = (id: string, urls: string[]) =>
  ({
    id,
    name: `Img ${id}`,
    items: urls.map((url, index) => ({
      id: `${id}-${index}`,
      title: `Ảnh ${index + 1}`,
      fileId: `${id}-file-${index}`,
      imageUrl: url,
      // Cố ý đảo thứ tự khai báo để chứng minh bộ ảnh đi theo `displayOrder`.
      displayOrder: urls.length - index,
      assetType: 'LIFESTYLE',
    })),
  }) as never;

function resolved(over: Partial<PodGroupTemplateResolved> = {}): PodGroupTemplateResolved {
  return {
    id: 'g-a',
    name: 'Group A',
    market: 'US',
    updatedAt: '',
    categoryTemplate: categoryTemplate('cat-a', '601226'),
    skuTemplate: skuTemplate('sku-a'),
    descriptionTemplate: descriptionTemplate('desc-a', '<p>Áo thun A</p>'),
    imageTemplate: imageTemplate('img-a', ['https://cdn/a1.png', 'https://cdn/a2.png']),
    ...over,
  };
}

/** Form đã có phần NGOÀI phạm vi group do người dùng nhập. */
function baseForm(): CustomListingForm {
  return {
    ...emptyCustomListingForm(),
    market: 'US',
    shopIds: ['shop-1', 'shop-2'],
    title: 'Vintage Sunset Tee',
    searchTerms: 'tee, sunset',
    highlights: 'Soft cotton',
    warehouseId: 'wh-user',
  };
}

// ---------------------------------------------------------------------------
console.log('1. Quy tắc chung planGroupApply');
{
  const all = { category: true, sku: true, description: true, image: true };
  const empty = { category: '', sku: '', description: '', image: '' };

  const fresh = planGroupApply({ provides: all, current: empty });
  check('form trống ⇒ set cả 4, không hỏi', [fresh.actions, fresh.overwritesManual], [
    { category: 'set', sku: 'set', description: 'set', image: 'set' },
    [],
  ]);

  const manual = planGroupApply({
    provides: all,
    current: { category: 'x', sku: '', description: 'tay', image: '' },
    next: { category: 'cat-b', sku: 'sku-b', description: 'desc-b', image: 'img-b' },
  });
  check('đè dữ liệu nhập tay ⇒ phải hỏi (đúng khu vực)', manual.overwritesManual, ['category', 'description']);

  const same = planGroupApply({
    provides: all,
    current: { category: 'cat-b', sku: '', description: '', image: '' },
    next: { category: 'cat-b', sku: 'sku-b', description: 'd', image: 'i' },
  });
  check('đè bằng CHÍNH giá trị đó ⇒ không hỏi', same.overwritesManual, []);

  const switched = planGroupApply({
    provides: { category: true, sku: true, description: false, image: false },
    current: { category: 'cat-a', sku: 'sku-a', description: 'desc-a', image: 'tay' },
    previous: { category: 'cat-a', sku: 'sku-a', description: 'desc-a', image: 'img-a' },
  });
  check('A → B: B thiếu Description (còn của A) ⇒ clear; B thiếu Image (đã sửa tay) ⇒ keep', switched.actions, {
    category: 'set',
    sku: 'set',
    description: 'clear',
    image: 'keep',
  });
  check('… báo dọn / giữ đúng khu vực', [switched.cleared, switched.keptManual], [['description'], ['image']]);
  check('… dữ liệu của group trước không tính là "nhập tay"', switched.overwritesManual, []);

  const reopened = planGroupApply({
    provides: { category: true, sku: false, description: false, image: false },
    current: { category: 'cat-a', sku: 'sku-a', description: '', image: '' },
    previous: null,
  });
  check('mở lại nháp (không biết group trước) ⇒ không dọn gì', reopened.actions.sku, 'keep');
}

// ---------------------------------------------------------------------------
console.log('2. Auto Listing — bộ ID template của lượt đăng');
{
  const groupA = groupSummary();
  const applied = applyGroupToSessionTemplates({
    templates: { pricingStrategyId: 'price-1' },
    market: 'US',
    group: groupA,
  });
  check('chọn group ⇒ đủ 4 ID + nhãn group, Pricing giữ nguyên', applied.templates, {
    pricingStrategyId: 'price-1',
    groupTemplateId: 'g-a',
    categoryTemplateId: 'cat-a',
    skuTemplateId: 'sku-a',
    descriptionTemplateId: 'desc-a',
    imageTemplateId: 'img-a',
  });
  check('cùng thị trường ⇒ không đổi market', applied.market, null);

  const groupB = groupSummary({
    id: 'g-b',
    name: 'Group B',
    categoryTemplateId: 'cat-b',
    skuTemplateId: 'sku-b',
    descriptionTemplateId: null,
    imageTemplateId: null,
    categoryTemplate: { ...groupA.categoryTemplate!, id: 'cat-b', market: 'UK' },
  });
  // Người dùng tự đổi Image sau khi áp A.
  const edited = { ...applied.templates, imageTemplateId: 'img-manual' };
  const switched = applyGroupToSessionTemplates({
    templates: edited,
    market: 'US',
    group: groupB,
    previousGroup: groupA,
  });
  check('A → B: Category/SKU theo B, Description của A bị dọn, Image tự chọn được giữ, Pricing giữ', switched.templates, {
    pricingStrategyId: 'price-1',
    groupTemplateId: 'g-b',
    categoryTemplateId: 'cat-b',
    skuTemplateId: 'sku-b',
    descriptionTemplateId: null,
    imageTemplateId: 'img-manual',
  });
  check('Category của B thuộc UK ⇒ lượt đăng chuyển sang UK', switched.market, 'UK');
  check('đổi A → B không phải hỏi (không đè dữ liệu tự chọn)', switched.plan.overwritesManual, []);

  const manual = applyGroupToSessionTemplates({
    templates: { skuTemplateId: 'sku-manual' },
    market: 'US',
    group: groupA,
  });
  check('chưa áp group nào mà đã tự chọn SKU ⇒ hỏi trước khi thay', manual.plan.overwritesManual, ['sku']);
}

// ---------------------------------------------------------------------------
console.log('3. Custom Listing — nội dung form');
{
  const start = baseForm();
  const a = applyGroupToCustomForm(start, resolved());
  const form = a.form;

  check('Category: mã TikTok + nhãn + mẫu đang chọn', [form.category, form.templates.category], [
    { id: '601226', name: 'Category 601226', path: 'Root > Category 601226' },
    'cat-a',
  ]);
  check('Category: giá trị thuộc tính đi kèm danh mục', form.attributeValues, {
    'attr-material': { valueIds: ['v-cotton'], customValues: [] },
  });
  check('Category: brand của template', form.brand, { id: 'brand-1', name: 'Gildan' });
  check('SKU: giữ nguyên cấu trúc trục', form.variations.map((v) => [v.name, v.values]), [
    ['Color', ['Black']],
    ['Size', ['S', 'M']],
  ]);
  check('SKU: đúng tổ hợp + Seller SKU + giá + tồn của TỪNG dòng', form.skus.map((s) => [s.sellerSku, s.salePrice, s.quantity]), [
    ['TEE-BLK-S', '21.00', 5],
    ['TEE-BLK-M', '22.00', 7],
  ]);
  check('SKU: ảnh trục đầu được giữ', form.variations[0].images?.map((image) => image.fileId), ['f-black']);
  check('Description: HTML của template', form.description, '<p>Áo thun A</p>');
  check('Image: đúng thứ tự displayOrder, giữ fileId', form.images.map((image) => image.fileId), ['img-a-file-1', 'img-a-file-0']);
  check('Ngoài phạm vi: tiêu đề / shop / từ khoá / highlights / kho KHÔNG đổi', [form.title, form.shopIds, form.searchTerms, form.highlights, form.warehouseId], [
    start.title,
    start.shopIds,
    start.searchTerms,
    start.highlights,
    start.warehouseId,
  ]);
  check('nhãn group được ghi', form.templates.group, 'g-a');
  check('form trống trong phạm vi ⇒ không phải hỏi', a.plan.overwritesManual, []);

  // Người dùng sửa tay MÔ TẢ sau khi áp A, rồi đổi sang B (không có Description, không có Image).
  const editedForm = { ...form, description: '<p>Mô tả tôi tự viết</p>' };
  const b = applyGroupToCustomForm(
    editedForm,
    resolved({
      id: 'g-b',
      name: 'Group B',
      categoryTemplate: categoryTemplate('cat-b', '700001'),
      skuTemplate: skuTemplate('sku-b'),
      descriptionTemplate: null,
      imageTemplate: null,
    }),
    a.applied,
  );
  check('A → B: Category theo B', [b.form.category.id, b.form.templates.category], ['700001', 'cat-b']);
  check('A → B: Image của A bị DỌN (B không có Image)', [b.form.images, b.form.templates.image], [[], '']);
  check('A → B: mô tả tự viết được GIỮ', b.form.description, '<p>Mô tả tôi tự viết</p>');
  check('A → B: báo dọn Image, giữ Description', [b.plan.cleared, b.plan.keptManual], [['image'], ['description']]);
  check('A → B: tiêu đề vẫn nguyên', b.form.title, start.title);

  // Chỉnh tay bảng SKU sau khi áp ⇒ lần áp group tiếp theo phải hỏi trước khi đè.
  const tweaked = {
    ...b.form,
    skus: b.form.skus.map((sku, index) => (index === 0 ? { ...sku, salePrice: '25.00' } : sku)),
  };
  const again = applyGroupToCustomForm(tweaked, resolved(), b.applied);
  check('sửa giá tay rồi áp lại group A ⇒ hỏi trước khi thay SKU (và mô tả tự viết còn giữ từ trước)', again.plan.overwritesManual, ['sku', 'description']);
  check('áp lại lấy dữ liệu MỚI của group (giá gốc của template)', again.form.skus[0].salePrice, '21.00');

  // Áp group lên form đã nhập tay SKU từ đầu (chưa áp group nào).
  const manualSku = {
    ...baseForm(),
    variations: [{ name: 'Size', values: ['L'] }],
    skus: [{ sellerSku: 'MY-L', optionValues: [{ name: 'Size', value: 'L' }], salePrice: '30', retailPrice: '', quantity: 1 }],
  };
  check('đã nhập tay SKU ⇒ hỏi', applyGroupToCustomForm(manualSku, resolved()).plan.overwritesManual, ['sku']);

  check('dấu vân tay ổn định giữa hai lần đọc', customSlotFingerprints(form), customSlotFingerprints({ ...form }));
}

// ---------------------------------------------------------------------------
console.log('3b. Custom Listing — lưu nháp ↔ mở lại / submit');
{
  const { form } = applyGroupToCustomForm(baseForm(), resolved());
  const payload = buildCustomListingPayload(form);
  check('payload mang đủ template + nhãn group', payload.templates, {
    categoryTemplateId: 'cat-a',
    descriptionTemplateId: 'desc-a',
    skuTemplateId: 'sku-a',
    imageTemplateId: 'img-a',
    groupTemplateId: 'g-a',
  });
  const manual = payload.product.manualData;
  check('payload: dữ liệu đã map nằm trong manualData (danh mục + SKU + mô tả)', [
    manual?.category?.tiktokCategoryId,
    manual?.skus?.map((sku) => sku.sellerSku),
    manual?.description,
  ], ['601226', ['TEE-BLK-S', 'TEE-BLK-M'], '<p>Áo thun A</p>']);
  check('payload: bộ ảnh đúng thứ tự', payload.product.images?.map((image) => image.fileId), ['img-a-file-1', 'img-a-file-0']);

  const row = (type: string, key: string, id: string) => ({
    id: `row-${type}`,
    templateType: type,
    templateName: type,
    categoryTemplateId: key === 'categoryTemplateId' ? id : null,
    skuTemplateId: key === 'skuTemplateId' ? id : null,
    descriptionTemplateId: key === 'descriptionTemplateId' ? id : null,
    imageTemplateId: key === 'imageTemplateId' ? id : null,
    pricingStrategyId: null,
  });
  const session = {
    id: 's-1',
    market: payload.market,
    shops: payload.shopIds.map((shopId) => ({ shopId, shop: { id: shopId, name: shopId, region: 'US' } })),
    templates: [
      row('CATEGORY', 'categoryTemplateId', 'cat-a'),
      row('SKU', 'skuTemplateId', 'sku-a'),
      row('DESCRIPTION', 'descriptionTemplateId', 'desc-a'),
      row('IMAGE', 'imageTemplateId', 'img-a'),
    ],
    groupTemplateId: 'g-a',
    groupTemplateName: 'Group A',
  } as unknown as PodListingSessionDetail;
  const product = {
    id: 'p-1',
    title: payload.product.title,
    images: (payload.product.images ?? []).map((image, index) => ({
      id: `i-${index}`,
      imageUrl: image.imageUrl,
      imageType: image.imageType ?? 'MAIN',
      sortOrder: image.sortOrder ?? index,
      fileId: image.fileId ?? null,
    })),
    manualData: JSON.parse(JSON.stringify(manual ?? null)),
  } as unknown as PodSessionProduct;

  const restored = restoreCustomListingForm(session, product);
  check('mở lại: nhãn group + 4 mẫu', restored.templates, form.templates);
  check('mở lại: danh mục, bảng SKU, mô tả, ảnh như lúc lưu', [
    restored.category.id,
    restored.skus.map((sku) => [sku.sellerSku, sku.salePrice]),
    restored.description,
    restored.images.map((image) => image.fileId),
  ], [
    form.category.id,
    form.skus.map((sku) => [sku.sellerSku, sku.salePrice]),
    form.description,
    form.images.map((image) => image.fileId),
  ]);
}

// ---------------------------------------------------------------------------
console.log('3c. Custom Listing MỞ LẠI TỪ NHÁP — đổi group giữ nguyên dữ liệu đang có');
{
  // Bản nháp đã lưu: có danh mục + mô tả, chưa có SKU / ảnh.
  const draft: CustomListingForm = {
    ...baseForm(),
    category: { id: '999', name: 'Draft cat', path: 'Draft > cat' },
    attributeValues: { 'attr-x': { valueIds: ['v1'], customValues: [] } },
    description: '<p>Mô tả của nháp</p>',
    templates: { category: 'cat-old', description: '', sku: '', image: '', group: 'g-old' },
  };
  const result = applyGroupToCustomForm(draft, resolved(), null, { keepManual: true });
  check('nháp: danh mục + thuộc tính + mẫu đang có GIỮ NGUYÊN (không ghi đè)', [
    result.form.category,
    result.form.attributeValues,
    result.form.templates.category,
  ], [draft.category, draft.attributeValues, 'cat-old']);
  check('nháp: mô tả đang có GIỮ NGUYÊN', result.form.description, draft.description);
  check('nháp: khu vực TRỐNG (SKU, ảnh) được group điền', [result.form.skus.length, result.form.images.length], [2, 2]);
  check('nháp: không hỏi xác nhận vì không ghi đè gì', result.plan.overwritesManual, []);
  check('nháp: báo đã giữ đúng khu vực', result.plan.keptManual, ['category', 'description']);
  check('nháp: có điền ⇒ nhãn group mới', [result.changed, result.form.templates.group], [true, 'g-a']);

  // Đổi tiếp sang group B ngay trong phiên: phần do A vừa điền tuân theo quy tắc thường (được thay / dọn),
  // phần có sẵn của nháp vẫn giữ.
  const b = applyGroupToCustomForm(
    result.form,
    resolved({ id: 'g-b', name: 'Group B', categoryTemplate: categoryTemplate('cat-b', '700001'), skuTemplate: null, descriptionTemplate: null }),
    result.applied,
    { keepManual: true },
  );
  check('nháp → A → B: SKU do A điền bị dọn (B không có SKU)', b.form.skus.length, 0);
  check('nháp → A → B: ảnh do A điền được thay bằng ảnh của B', b.form.images.length, 2);
  check('nháp → A → B: danh mục + mô tả gốc của nháp vẫn giữ', [b.form.category.id, b.form.description], ['999', draft.description]);

  // Group chỉ có những mảnh mà nháp đã có ⇒ không điền được gì ⇒ form + nhãn giữ nguyên.
  const nothing = applyGroupToCustomForm(
    draft,
    resolved({ skuTemplate: null, imageTemplate: null }),
    null,
    { keepManual: true },
  );
  check('nháp: group không điền thêm được gì ⇒ changed=false, form (cả nhãn group) y nguyên', [nothing.changed, nothing.form === draft], [false, true]);

  // Tạo mới (không keepManual) giữ hành vi cũ: thay dữ liệu nhập tay sau khi hỏi.
  const fresh = applyGroupToCustomForm(draft, resolved(), null);
  check('tạo mới: vẫn thay (có hỏi) như cũ', [fresh.plan.overwritesManual, fresh.form.category.id], [['category', 'description'], '601226']);
}

// ---------------------------------------------------------------------------
console.log('3d. Xoá danh mục — chỉ danh mục + thuộc tính + Category Template');
{
  const { form } = applyGroupToCustomForm(baseForm(), resolved());
  const full: CustomListingForm = {
    ...form,
    brand: { id: 'brand-1', name: 'Gildan' },
    warehouseId: 'wh-1',
    pkg: { ...form.pkg, weight: '300', length: '20', width: '15', height: '2' },
    sizeChart: { imageUrl: 'https://cdn/chart.png', fileId: 'file-chart', imageType: 'SIZE_CHART' },
    video: { fileId: 'file-video', fileName: 'demo.mp4' },
  };
  const reset = clearSlot(full, 'category');
  check('state: danh mục + thuộc tính + mẫu Category bị xoá', [reset.category, reset.attributeValues, reset.templates.category], [
    { id: '', name: '', path: '' },
    {},
    '',
  ]);
  check('state: brand / kho / kiện hàng / bảng size / video GIỮ NGUYÊN', [reset.brand, reset.warehouseId, reset.pkg, reset.sizeChart, reset.video], [
    full.brand,
    full.warehouseId,
    full.pkg,
    full.sizeChart,
    full.video,
  ]);
  check('state: các khu vực khác (SKU, mô tả, ảnh, tiêu đề) không đụng', [reset.skus.length, reset.description, reset.images.length, reset.title], [
    full.skus.length,
    full.description,
    full.images.length,
    full.title,
  ]);

  const payload = buildCustomListingPayload(reset);
  const manual = payload.product.manualData ?? {};
  check('payload: không còn danh mục / thuộc tính, Category Template = null', [
    'category' in manual,
    'attributes' in manual,
    payload.templates?.categoryTemplateId,
  ], [false, false, null]);
  check('🔴 payload: brand cụ thể vẫn được gửi sau khi xoá danh mục', manual.brand, { tiktokBrandId: 'brand-1', name: 'Gildan' });
  check('payload: kho + kiện hàng + video vẫn được gửi', [manual.warehouseId, manual.package?.weight, manual.video?.fileId], ['wh-1', '300', 'file-video']);
  check('payload: bảng size vẫn đi trong mảng ảnh', payload.product.images?.filter((image) => image.imageType === 'SIZE_CHART').map((image) => image.fileId), ['file-chart']);

  const noBrand = buildCustomListingPayload({ ...reset, brand: { id: '', name: '' } });
  check('payload: "No brand" + chưa có danh mục ⇒ không gửi brand (giữ hành vi cũ, template quyết)', 'brand' in (noBrand.product.manualData ?? {}), false);
}

// ---------------------------------------------------------------------------
console.log('3e. Sửa tay sau khi map — dữ liệu gửi đi là dữ liệu đã sửa');
{
  const { form } = applyGroupToCustomForm(baseForm(), resolved());
  const edited: CustomListingForm = {
    ...form,
    description: '<p>Đã sửa</p>',
    skus: form.skus.map((sku, index) => (index === 1 ? { ...sku, salePrice: '30.00', quantity: 9 } : sku)),
    images: form.images.slice(1),
  };
  const payload = buildCustomListingPayload(edited);
  check('payload mang mô tả đã sửa', payload.product.manualData?.description, '<p>Đã sửa</p>');
  check('payload mang giá / tồn đã sửa của đúng dòng SKU', payload.product.manualData?.skus?.map((sku) => [sku.sellerSku, sku.salePrice, sku.quantity]), [
    ['TEE-BLK-S', '21.00', 5],
    ['TEE-BLK-M', '30.00', 9],
  ]);
  check('payload mang bộ ảnh đã bớt', payload.product.images?.map((image) => image.fileId), ['img-a-file-0']);
}

// ---------------------------------------------------------------------------
console.log('4. Form Group Template');
{
  const empty = groupTemplateFormFrom(null);
  check('tên rỗng + không mảnh ⇒ 2 lỗi', validateGroupTemplateForm(empty), ['NAME_REQUIRED', 'PART_REQUIRED']);
  check('tên chỉ có khoảng trắng ⇒ lỗi tên', validateGroupTemplateForm({ ...empty, name: '   ', skuTemplateId: 's' }), ['NAME_REQUIRED']);
  check('tên > 255 ⇒ lỗi', validateGroupTemplateForm({ ...empty, name: 'a'.repeat(256), skuTemplateId: 's' }), ['NAME_TOO_LONG']);
  check('hợp lệ', validateGroupTemplateForm({ ...empty, name: 'Tee', imageTemplateId: 'i' }), []);

  const payload = buildGroupTemplatePayload({ ...empty, name: '  Tee US  ', categoryTemplateId: 'c' }, true);
  check('payload: tên cắt khoảng trắng, mảnh trống gửi null (= gỡ), có isActive khi sửa', payload, {
    name: 'Tee US',
    categoryTemplateId: 'c',
    skuTemplateId: null,
    descriptionTemplateId: null,
    imageTemplateId: null,
    note: null,
    isActive: true,
  });
  check('payload tạo mới không gửi isActive', 'isActive' in buildGroupTemplatePayload({ ...empty, name: 'A', skuTemplateId: 's' }, false), false);

  const loaded = groupTemplateFormFrom(groupSummary({ note: 'ghi chú' }));
  check('mở group để sửa ⇒ đúng 4 tham chiếu', [loaded.categoryTemplateId, loaded.skuTemplateId, loaded.descriptionTemplateId, loaded.imageTemplateId, loaded.note], [
    'cat-a',
    'sku-a',
    'desc-a',
    'img-a',
    'ghi chú',
  ]);
}

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case Group Template đúng`);
