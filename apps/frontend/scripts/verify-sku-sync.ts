/**
 * Kiểm chứng **Apply SKU Template** và **đồng bộ Variation Values → bảng SKU** của Add Custom
 * Listing — `npm run test:sku-sync`.
 *
 * ```
 *   SKU Template ──Apply──▶ trục + dữ liệu TỪNG tổ hợp (SKU / giá / tồn / ảnh)
 *   Variation Values đổi ──reconcile──▶ bảng SKU luôn khớp trục, dữ liệu đã gõ KHÔNG mất
 * ```
 *
 * Mười case bắt buộc của sprint + các case biên (rơi về mặc định, tổ hợp tắt, đổi tên giá trị,
 * thêm / bỏ trục). Node 22 chạy thẳng TypeScript nên file này kiểm ĐÚNG mã nguồn app đang chạy.
 */

import {
  buildSkuCombinations,
  combinationKey,
  reconcileSkus,
} from '../features/pod-listing-session/manual-sku.ts';
import { applySkuTemplate, skuTemplateSeed } from '../features/pod-listing-session/template-apply.ts';
import {
  buildCustomListingPayload,
  buildManualData,
  emptyCustomListingForm,
  restoreCustomListingForm,
} from '../features/pod-listing-session/custom-listing-state.ts';
import type {
  ManualSku,
  ManualVariation,
  PodListingSessionDetail,
  PodSessionProduct,
} from '../features/pod-listing-session/types.ts';
import type { PodSkuTemplate, PodSkuTemplateItem } from '../features/pod-listing/types.ts';

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

const names = (skus: ManualSku[]) => skus.map((sku) => sku.optionValues.map((o) => o.value).join('/'));
const row = (skus: ManualSku[], value: string) =>
  skus.find((sku) => sku.optionValues.map((o) => o.value).join('/') === value);

// ---------------------------------------------------------------------------
// Fixture: dựng SKU Template ĐÚNG hình dạng API chi tiết (`GET /pod/templates/skus/:id`) —
// `items[].values[]` là bảng nối tổ hợp ↔ giá trị trục, `effective*` do server tính.
// ---------------------------------------------------------------------------

interface AxisSpec {
  name: string;
  values: string[];
}

function makeTemplate(
  axes: AxisSpec[],
  items: Array<{
    combo: Record<string, string>;
    skuCode?: string | null;
    sale?: string | null;
    retail?: string | null;
    quantity?: number;
    imageFileId?: string | null;
    isActive?: boolean;
    /** Bản ghi cũ không có bảng nối — chỉ có `variantName`. */
    legacy?: boolean;
  }>,
  over: Partial<PodSkuTemplate> = {},
): PodSkuTemplate {
  const variants = axes.map((axis, axisIndex) => ({
    id: `var-${axis.name}`,
    name: axis.name,
    sortOrder: axisIndex,
    values: axis.values.map((value, index) => ({ id: `val-${axis.name}-${value}`, value, sortOrder: index })),
  }));

  const rows: PodSkuTemplateItem[] = items.map((item, index) => {
    const sale = item.sale ?? null;
    const retail = item.retail ?? null;
    // Giá hiệu lực theo đúng luật server: bán tường minh thắng; chỉ có giá gốc ⇒ bán = gốc,
    // không gạch ngang; không có gì ⇒ null.
    const effectiveSalePrice = sale ?? retail ?? null;
    const effectiveRetailPrice = sale ? retail : null;
    return {
      id: `item-${index}`,
      variantName: axes.map((axis) => item.combo[axis.name]).join(' / '),
      skuCode: item.skuCode ?? null,
      barcode: null,
      priceAdjustmentType: 'NONE',
      priceAdjustmentValue: '0',
      retailPrice: retail,
      salePrice: sale,
      quantity: item.quantity ?? 0,
      discount: null,
      effectiveSalePrice,
      effectiveRetailPrice,
      priceSource: sale ? 'SALE_PRICE' : retail ? 'RETAIL_PRICE' : 'NONE',
      imageFileId: item.imageFileId ?? null,
      isActive: item.isActive ?? true,
      sortOrder: index,
      values: item.legacy
        ? undefined
        : axes.map((axis) => ({
            variantValue: {
              id: `val-${axis.name}-${item.combo[axis.name]}`,
              value: item.combo[axis.name],
              variant: { id: `var-${axis.name}`, name: axis.name },
            },
          })),
    } as PodSkuTemplateItem;
  });

  return {
    id: 'st-poster',
    name: 'Poster',
    variants,
    items: rows,
    skuPrefix: null,
    skuSuffix: null,
    defaultRetailPrice: null,
    defaultSalePrice: null,
    defaultQuantity: 0,
    defaultDiscount: null,
    currency: 'USD',
    isDefault: false,
    isActive: true,
    displayOrder: 0,
    note: null,
    createdAt: '',
    axesUpdatedAt: '',
    itemsGeneratedAt: '',
    expectedItemCount: rows.length,
    isStale: false,
    ...over,
  };
}

const POSTER_SIZES = ['8"x12"', '8"x20"', '12"x18"', '16"x24"', '24"x36"', '27"x40"'];
const POSTER_PRICES: Record<string, string> = {
  '8"x12"': '19.99',
  '8"x20"': '22.99',
  '12"x18"': '25.99',
  '16"x24"': '29.99',
  '24"x36"': '39.99',
  '27"x40"': '44.99',
};
const posterCode = (size: string) => size.replace(/"/g, '').toUpperCase();

const posterTemplate = () =>
  makeTemplate(
    [{ name: 'Size', values: POSTER_SIZES }],
    POSTER_SIZES.map((size) => ({
      combo: { Size: size },
      skuCode: posterCode(size),
      sale: POSTER_PRICES[size],
      retail: POSTER_PRICES[size],
      quantity: 500,
    })),
  );

const COLORS = ['Black', 'White'];
const SIZES = ['S', 'M', 'L'];
const teeTemplate = (extra: Partial<PodSkuTemplate> = {}) =>
  makeTemplate(
    [
      { name: 'Color', values: COLORS },
      { name: 'Size', values: SIZES },
    ],
    // 🔴 Cố ý XÁO thứ tự tổ hợp so với tích Descartes — mapping phải theo giá trị, không theo index.
    [
      { combo: { Color: 'White', Size: 'L' }, skuCode: 'TEE-WH-L', sale: '21.99', quantity: 10 },
      { combo: { Color: 'Black', Size: 'S' }, skuCode: 'TEE-BK-S', sale: '19.99', retail: '24.99', quantity: 30 },
      { combo: { Color: 'White', Size: 'S' }, skuCode: 'TEE-WH-S', sale: '19.99', quantity: 25 },
      { combo: { Color: 'Black', Size: 'L' }, skuCode: 'TEE-BK-L', sale: '21.99', quantity: 12 },
      { combo: { Color: 'Black', Size: 'M' }, skuCode: 'TEE-BK-M', sale: '20.99', quantity: 20 },
      { combo: { Color: 'White', Size: 'M' }, skuCode: 'TEE-WH-M', sale: '20.99', quantity: 15 },
    ],
    extra,
  );

const teeVariations: ManualVariation[] = [
  { name: 'Color', values: COLORS },
  { name: 'Size', values: SIZES },
];

// ---------------------------------------------------------------------------
console.log('Test 1 — Apply SKU Template 1 trục / 6 giá trị');
{
  const { variations, skus } = applySkuTemplate(posterTemplate());
  check('trục đúng', variations, [{ name: 'Size', values: POSTER_SIZES }]);
  check('6 dòng SKU', skus.length, 6);
  check(
    '🔴 Seller SKU / giá bán / giá gạch / tồn lấy từ TỪNG tổ hợp của template',
    skus.map((sku) => [sku.optionValues[0].value, sku.sellerSku, sku.salePrice, sku.retailPrice, sku.quantity]),
    // Ô List = giá gốc template trả về (server giữ nguyên; publisher tự bỏ gạch ngang khi ≤ giá bán).
    POSTER_SIZES.map((size) => [size, posterCode(size), POSTER_PRICES[size], POSTER_PRICES[size], 500]),
  );
  check('không dòng nào chỉ chép tên giá trị (giá rỗng)', skus.every((sku) => sku.salePrice !== ''), true);
}

// ---------------------------------------------------------------------------
console.log('Test 2 — Nhiều trục: đúng tích Descartes, mapping theo tổ hợp (không theo index)');
{
  const { variations, skus } = applySkuTemplate(teeTemplate());
  check('2 trục', variations.map((v) => v.name), ['Color', 'Size']);
  check('6 tổ hợp', skus.length, 6);
  check('🔴 Black/S nhận đúng dữ liệu của tổ hợp Black/S dù template xếp nó ở dòng 2', row(skus, 'Black/S'), {
    sellerSku: 'TEE-BK-S',
    optionValues: [
      { name: 'Color', value: 'Black' },
      { name: 'Size', value: 'S' },
    ],
    salePrice: '19.99',
    retailPrice: '24.99',
    quantity: 30,
  });
  check('White/L đúng dữ liệu', [row(skus, 'White/L')?.sellerSku, row(skus, 'White/L')?.quantity], ['TEE-WH-L', 10]);
  check('không trùng tổ hợp', new Set(skus.map((sku) => combinationKey(sku.optionValues))).size, 6);
}

// ---------------------------------------------------------------------------
console.log('Test 3 — Sửa giá / tồn / SKU rồi đổi trục: dữ liệu đã sửa KHÔNG bị reset');
{
  const template = posterTemplate();
  const seed = skuTemplateSeed(template);
  const applied = applySkuTemplate(template);
  const edited = applied.skus.map((sku) =>
    sku.optionValues[0].value === '8"x12"'
      ? { ...sku, salePrice: '25.00', quantity: 1000, sellerSku: 'MY-8X12' }
      : sku,
  );

  const withNew = reconcileSkus(applied.variations, [{ name: 'Size', values: [...POSTER_SIZES, '30"x40"'] }], edited, seed);
  check('thêm giá trị ⇒ 7 dòng', withNew.length, 7);
  check('🔴 dòng đã sửa giữ nguyên 25.00 / 1000 / MY-8X12', [row(withNew, '8"x12"')?.salePrice, row(withNew, '8"x12"')?.quantity, row(withNew, '8"x12"')?.sellerSku], ['25.00', 1000, 'MY-8X12']);
  check('dòng khác giữ giá template', row(withNew, '12"x18"')?.salePrice, '25.99');

  const withoutOne = reconcileSkus([{ name: 'Size', values: [...POSTER_SIZES, '30"x40"'] }], [{ name: 'Size', values: POSTER_SIZES.filter((s) => s !== '8"x20"') }], withNew, seed);
  check('xoá giá trị khác ⇒ dòng đã sửa vẫn nguyên', row(withoutOne, '8"x12"')?.salePrice, '25.00');
  check('render lại (cùng trục) ⇒ trả về CHÍNH mảng cũ, không đụng gì', reconcileSkus(applied.variations, applied.variations, edited, seed) === edited, true);
}

// ---------------------------------------------------------------------------
console.log('Test 4 — Xoá một giá trị ⇒ dòng SKU tương ứng biến mất');
{
  const template = posterTemplate();
  const applied = applySkuTemplate(template);
  const next = [{ name: 'Size', values: POSTER_SIZES.filter((s) => s !== '12"x18"') }];
  const skus = reconcileSkus(applied.variations, next, applied.skus, skuTemplateSeed(template));
  check('còn 5 dòng, không còn 12"x18"', names(skus), POSTER_SIZES.filter((s) => s !== '12"x18"'));
  check('không dòng mồ côi', skus.every((sku) => next[0].values.includes(sku.optionValues[0].value)), true);
}

// ---------------------------------------------------------------------------
console.log('Test 5 — Xoá nhiều giá trị ⇒ mọi tổ hợp liên quan bị bỏ');
{
  const template = teeTemplate();
  const applied = applySkuTemplate(template);
  const next: ManualVariation[] = [
    { name: 'Color', values: ['Black'] },
    { name: 'Size', values: ['S'] },
  ];
  const skus = reconcileSkus(teeVariations, next, applied.skus, skuTemplateSeed(template));
  check('chỉ còn Black/S', names(skus), ['Black/S']);
  check('giữ đúng dữ liệu của Black/S', skus[0].sellerSku, 'TEE-BK-S');
}

// ---------------------------------------------------------------------------
console.log('Test 6 — Thêm giá trị mới ⇒ sinh đúng tổ hợp mới (lấy dữ liệu template nếu có)');
{
  const template = teeTemplate({ defaultSalePrice: '18.00', defaultQuantity: 7 });
  const seed = skuTemplateSeed(template);
  const applied = applySkuTemplate(template);
  const next: ManualVariation[] = [
    { name: 'Color', values: [...COLORS, 'Navy'] },
    { name: 'Size', values: SIZES },
  ];
  const skus = reconcileSkus(teeVariations, next, applied.skus, seed);
  check('6 + 3 = 9 dòng', skus.length, 9);
  check('tổ hợp mới đúng 3 cái với Navy', names(skus).filter((n) => n.startsWith('Navy')), ['Navy/S', 'Navy/M', 'Navy/L']);
  check('🔴 tổ hợp mới KHÔNG có trong template ⇒ rơi về mặc định template (giá 18.00, tồn 7), sửa được', [row(skus, 'Navy/M')?.salePrice, row(skus, 'Navy/M')?.quantity], ['18.00', 7]);
  check('Seller SKU gợi ý cho tổ hợp mới', row(skus, 'Navy/M')?.sellerSku, 'NAVY-M');
  check('6 dòng cũ giữ nguyên tham chiếu', applied.skus.every((sku) => skus.includes(sku)), true);
}

// ---------------------------------------------------------------------------
console.log('Test 7 — Xoá rồi thêm lại giá trị ⇒ không trùng, mapping tính lại đúng');
{
  const template = posterTemplate();
  const seed = skuTemplateSeed(template);
  const applied = applySkuTemplate(template);
  const without = [{ name: 'Size', values: POSTER_SIZES.filter((s) => s !== '16"x24"') }];
  const removed = reconcileSkus(applied.variations, without, applied.skus, seed);
  const readded = reconcileSkus(without, applied.variations, removed, seed);
  check('6 dòng, không trùng', [readded.length, new Set(readded.map((s) => combinationKey(s.optionValues))).size], [6, 6]);
  check('🔴 dòng thêm lại nhận đúng dữ liệu template của 16"x24"', [row(readded, '16"x24"')?.sellerSku, row(readded, '16"x24"')?.salePrice, row(readded, '16"x24"')?.quantity], ['16X24', '29.99', 500]);
}

// ---------------------------------------------------------------------------
console.log('Test 8 — Apply → Lưu nháp → Mở lại: SKU / trục / giá / tồn còn nguyên');
{
  const applied = applySkuTemplate(teeTemplate());
  const form = emptyCustomListingForm();
  form.title = 'Tee';
  form.shopIds = ['shop-a'];
  form.templates.sku = 'st-poster';
  form.variations = applied.variations;
  form.skus = applied.skus.map((sku) => (sku.sellerSku === 'TEE-BK-M' ? { ...sku, salePrice: '23.50', quantity: 99 } : sku));

  const payload = buildCustomListingPayload(form);
  const session = {
    id: 's-1',
    market: 'US',
    shops: [{ shopId: 'shop-a', shop: { id: 'shop-a', name: 'A', region: 'US' } }],
    templates: [
      { id: 'r', templateType: 'SKU', templateName: 'Poster', categoryTemplateId: null, skuTemplateId: 'st-poster', descriptionTemplateId: null, imageTemplateId: null, pricingStrategyId: null },
    ],
  } as unknown as PodListingSessionDetail;
  const product = {
    id: 'sp-1',
    title: 'Tee',
    images: [],
    manualData: JSON.parse(JSON.stringify(payload.product.manualData)),
  } as unknown as PodSessionProduct;

  const restored = restoreCustomListingForm(session, product);
  check('trục còn nguyên', restored.variations, teeVariations);
  check('🔴 6 dòng SKU còn nguyên, kể cả giá đã sửa', [restored.skus.length, row(restored.skus, 'Black/M')?.salePrice, row(restored.skus, 'Black/M')?.quantity], [6, '23.50', 99]);
  check('mẫu SKU đang chọn được nhớ', restored.templates.sku, 'st-poster');
  check('mở lại rồi đổi trục vẫn đồng bộ (không mất giá đã sửa)', row(reconcileSkus(restored.variations, [{ name: 'Color', values: ['Black'] }, { name: 'Size', values: SIZES }], restored.skus), 'Black/M')?.salePrice, '23.50');
}

// ---------------------------------------------------------------------------
console.log('Test 9 — Multi-axis: xoá Color = Black ⇒ còn White/S, White/M, White/L');
{
  const template = teeTemplate();
  const applied = applySkuTemplate(template);
  const skus = reconcileSkus(teeVariations, [{ name: 'Color', values: ['White'] }, { name: 'Size', values: SIZES }], applied.skus, skuTemplateSeed(template));
  check('còn đúng 3 tổ hợp White', names(skus), ['White/S', 'White/M', 'White/L']);
  const sizeM = reconcileSkus(teeVariations, [{ name: 'Color', values: COLORS }, { name: 'Size', values: ['S', 'L'] }], applied.skus, skuTemplateSeed(template));
  check('xoá Size = M ⇒ bỏ mọi tổ hợp chứa M', names(sizeM), ['Black/S', 'Black/L', 'White/S', 'White/L']);
}

// ---------------------------------------------------------------------------
console.log('Test 10 — Payload gửi backend chứa đúng SKU / giá / tồn / tổ hợp');
{
  const applied = applySkuTemplate(posterTemplate());
  const form = emptyCustomListingForm();
  form.variations = applied.variations;
  form.skus = applied.skus;
  const manual = buildManualData(form);
  check('variations trong payload', manual.variations, [{ name: 'Size', values: POSTER_SIZES }]);
  check('6 SKU trong payload', manual.skus?.length, 6);
  check('🔴 SKU trong payload = đúng dòng đang hiển thị (một nguồn sự thật)', manual.skus?.[2], {
    sellerSku: '12X18',
    optionValues: [{ name: 'Size', value: '12"x18"' }],
    salePrice: '25.99',
    retailPrice: '25.99',
    quantity: 500,
  });
}

// ---------------------------------------------------------------------------
console.log('Biên — mặc định template, tổ hợp tắt, bản ghi cũ, đổi tên, thêm / bỏ trục, ảnh SKU');
{
  // Item không tự khai giá / tồn 0 ⇒ rơi về mặc định template; item có giá riêng thì ưu tiên.
  const template = makeTemplate(
    [{ name: 'Size', values: ['S', 'M'] }],
    [
      { combo: { Size: 'S' }, skuCode: 'S1', sale: null, retail: null, quantity: 0 },
      { combo: { Size: 'M' }, skuCode: 'M1', sale: '30.00', retail: '35.00', quantity: 3, imageFileId: 'file-m' },
    ],
    { defaultSalePrice: '10.00', defaultRetailPrice: '15.00', defaultQuantity: 50 },
  );
  const { skus } = applySkuTemplate(template);
  check('🔴 SKU-level trống ⇒ mặc định template (10.00 / 15.00 / 50)', [skus[0].salePrice, skus[0].retailPrice, skus[0].quantity], ['10.00', '15.00', 50]);
  check('🔴 SKU-level có giá trị ⇒ ưu tiên SKU-level, không lấy mặc định', [skus[1].salePrice, skus[1].retailPrice, skus[1].quantity], ['30.00', '35.00', 3]);
  check('ảnh SKU mang sang', skus[1].imageFileId, 'file-m');
}
{
  const template = makeTemplate(
    [{ name: 'Size', values: ['S', 'M'] }],
    [
      { combo: { Size: 'S' }, skuCode: 'S1', sale: '9.99', quantity: 1 },
      { combo: { Size: 'M' }, skuCode: 'M1', sale: '9.99', quantity: 1, isActive: false },
    ],
  );
  check('tổ hợp TẮT trong template không được áp', names(applySkuTemplate(template).skus), ['S']);
}
{
  const legacy = makeTemplate(
    [
      { name: 'Color', values: ['Black'] },
      { name: 'Size', values: ['S'] },
    ],
    [{ combo: { Color: 'Black', Size: 'S' }, skuCode: 'L1', sale: '9.99', quantity: 1, legacy: true }],
  );
  check('bản ghi cũ không có bảng nối ⇒ tách variantName theo trục', applySkuTemplate(legacy).skus[0].optionValues, [
    { name: 'Color', value: 'Black' },
    { name: 'Size', value: 'S' },
  ]);
  const stale = makeTemplate(
    [{ name: 'Size', values: ['S'] }],
    [
      { combo: { Size: 'S' }, skuCode: 'S1', sale: '9.99', quantity: 1 },
      { combo: { Size: 'XL' }, skuCode: 'XL1', sale: '9.99', quantity: 1 },
    ],
  );
  check('tổ hợp có giá trị KHÔNG còn trên trục (template cũ) ⇒ bị bỏ, không mồ côi', names(applySkuTemplate(stale).skus), ['S']);
}
{
  const template = posterTemplate();
  const seed = skuTemplateSeed(template);
  const applied = applySkuTemplate(template);
  const edited = applied.skus.map((sku) => (sku.optionValues[0].value === '8"x12"' ? { ...sku, salePrice: '77.00' } : sku));
  const renamed = reconcileSkus(applied.variations, [{ name: 'Size', values: POSTER_SIZES.map((s) => (s === '8"x12"' ? '8x12 in' : s)) }], edited, seed);
  check('đổi tên giá trị (cùng vị trí) ⇒ dòng đổi tên, GIỮ giá đã gõ', [row(renamed, '8x12 in')?.salePrice, renamed.length], ['77.00', 6]);

  const withAxis = reconcileSkus(applied.variations, [{ name: 'Size', values: POSTER_SIZES }, { name: 'Frame', values: ['None', 'Black'] }], edited, seed);
  check('thêm trục ⇒ mỗi dòng nhân với giá trị trục mới, mang theo giá đã gõ', [withAxis.length, row(withAxis, '8"x12"/Black')?.salePrice, row(withAxis, '8"x12"/None')?.salePrice], [12, '77.00', '77.00']);
  check('Seller SKU khác nhau giữa các dòng vừa tách', new Set(withAxis.map((s) => s.sellerSku)).size, 12);

  const withoutAxis = reconcileSkus([{ name: 'Size', values: POSTER_SIZES }, { name: 'Frame', values: ['None', 'Black'] }], [{ name: 'Size', values: POSTER_SIZES }], withAxis, seed);
  check('bỏ trục ⇒ gộp về 6 dòng, không trùng', [withoutAxis.length, new Set(withoutAxis.map((s) => combinationKey(s.optionValues))).size], [6, 6]);

  const axisRenamed = reconcileSkus(applied.variations, [{ name: 'Siz', values: POSTER_SIZES }], edited, seed);
  check('đổi TÊN trục (gõ sửa) ⇒ dòng đổi tên trục, giữ giá đã gõ, không nhân đôi', [axisRenamed.length, axisRenamed[0].optionValues[0].name, row(axisRenamed, '8"x12"')?.salePrice], [6, 'Siz', '77.00']);

  check('chưa có bảng ⇒ reconcile không tự sinh (vẫn chờ "Tạo SKU")', reconcileSkus([], applied.variations, []), []);
  check('"Tạo SKU" lần đầu với mẫu ⇒ dòng lấy dữ liệu mẫu', row(buildSkuCombinations(applied.variations, [], seed), '8"x20"')?.sellerSku, '8X20');
}

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case Apply SKU Template + đồng bộ Variation → SKU đúng`);
