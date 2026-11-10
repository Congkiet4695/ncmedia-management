/**
 * Kiểm chứng KÉO THẢ ĐỔI THỨ TỰ TRỤC BIẾN THỂ của Custom Listing — `npm run test:variation-reorder`.
 *
 * Bất biến được canh:
 *   1. Thứ tự trục đổi đúng như người dùng kéo, và đi vào `variations` của form (không chỉ giao diện).
 *   2. Không dòng SKU nào mất / sinh thêm / trùng; danh tính dòng (`combinationKey`) không đổi.
 *   3. Seller SKU / giá / tồn / barcode đi theo ĐÚNG tổ hợp — không hoán đổi giữa các dòng.
 *   4. `optionValues` của mọi dòng theo thứ tự trục mới (⇒ `sales_attributes` gửi TikTok).
 *   5. Ảnh: dòng chỉ lấy ảnh của trục ĐẦU (luật `sku_img`), ảnh của trục bị kéo xuống KHÔNG bị xoá,
 *      kéo lên lại là ảnh quay về đúng giá trị — không hoán đổi, không trùng.
 *   6. Lưu nháp → mở lại giữ thứ tự trục (và ảnh của trục không đứng đầu).
 *
 * Kiểm ĐÚNG mã nguồn app (Node chạy thẳng TypeScript qua `register-ts.mjs`).
 */

import {
  buildSkuCombinations,
  combinationKey,
  moveVariation,
  reconcileSkus,
} from '../features/pod-listing-session/manual-sku.ts';
import {
  buildManualData,
  emptyCustomListingForm,
  restoreCustomListingForm,
} from '../features/pod-listing-session/custom-listing-state.ts';
import type { ManualSku, ManualVariation } from '../features/pod-listing-session/types.ts';
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
  console.error(`  ✗ ${label}\n      expected: ${e}\n      actual:   ${a}`);
}

const names = (variations: ManualVariation[]) => variations.map((variation) => variation.name);
const order = (sku: ManualSku) => sku.optionValues.map((option) => option.name);
const label = (sku: ManualSku) => sku.optionValues.map((option) => option.value).join(' / ');

/** Dữ liệu NGƯỜI DÙNG đã gõ của từng tổ hợp — tra theo khoá tổ hợp (độc lập thứ tự trục). */
function dataByKey(skus: ManualSku[]) {
  // Sắp theo khoá: so DỮ LIỆU của từng tổ hợp, không so thứ tự dòng (đổi trục thì dòng được sắp lại).
  return Object.fromEntries(
    skus
      .map((sku) => [
        combinationKey(sku.optionValues),
        [sku.sellerSku, sku.salePrice, sku.retailPrice, sku.quantity, sku.barcode ?? null],
      ] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const imagesByKey = (skus: ManualSku[]) =>
  Object.fromEntries(
    skus
      .map((sku) => [combinationKey(sku.optionValues), sku.imageFileId ?? null] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Bảng SKU đầy đủ, mỗi dòng có dữ liệu RIÊNG (để phát hiện hoán đổi). */
function filledSkus(variations: ManualVariation[]): ManualSku[] {
  return buildSkuCombinations(variations).map((sku, index) => ({
    ...sku,
    sellerSku: `SKU-${index + 1}`,
    salePrice: `${10 + index}.00`,
    retailPrice: `${20 + index}.00`,
    quantity: 100 + index,
    barcode: `BC-${index + 1}`,
  }));
}

/** Mô phỏng ĐÚNG luồng form: editor đổi `variations` ⇒ form gọi `reconcileSkus(prev, next, skus)`. */
function drag(state: { variations: ManualVariation[]; skus: ManualSku[] }, from: number, to: number) {
  const next = moveVariation(state.variations, from, to);
  return { variations: next, skus: reconcileSkus(state.variations, next, state.skus) };
}

const COLOR: ManualVariation = {
  name: 'Color',
  values: ['BLACK', 'WHITE'],
  images: [
    { value: 'BLACK', fileId: 'file-black' },
    { value: 'WHITE', fileId: 'file-white' },
  ],
};
const SIZE: ManualVariation = { name: 'Size', values: ['S', 'M'] };
const TYPE: ManualVariation = { name: 'Type', values: ['Youth T-Shirt', 'Adult T-Shirt'] };

// ---------------------------------------------------------------------------
console.log('Basic: Type, Color, Size → Size, Color, Type');
{
  const variations = [TYPE, COLOR, SIZE];
  const step1 = moveVariation(variations, 2, 0); // Size lên đầu
  check('Size lên đầu', names(step1), ['Size', 'Type', 'Color']);
  const step2 = moveVariation(step1, 2, 1); // Color lên thứ hai
  check('→ Size, Color, Type', names(step2), ['Size', 'Color', 'Type']);
  check('nội dung trục đi nguyên khối (giá trị + ảnh)', step2[1], COLOR);
  check('vị trí ngoài phạm vi ⇒ CHÍNH mảng cũ', moveVariation(variations, 0, 5) === variations, true);
  check('kéo vào chính chỗ cũ ⇒ CHÍNH mảng cũ', moveVariation(variations, 1, 1) === variations, true);
}

// ---------------------------------------------------------------------------
console.log('Data preservation + identity: Color, Size → Size, Color');
{
  const start = { variations: [COLOR, SIZE], skus: filledSkus([COLOR, SIZE]) };
  const before = dataByKey(start.skus);
  const after = drag(start, 1, 0);

  check('thứ tự trục mới', names(after.variations), ['Size', 'Color']);
  check('không mất / thêm dòng', after.skus.length, start.skus.length);
  check('🔴 mọi tổ hợp giữ ĐÚNG Seller SKU / giá / tồn / barcode', dataByKey(after.skus), before);
  check(
    'danh tính dòng (combinationKey) không đổi',
    after.skus.map((sku) => combinationKey(sku.optionValues)).sort(),
    start.skus.map((sku) => combinationKey(sku.optionValues)).sort(),
  );
  check('optionValues theo thứ tự trục mới', after.skus.map(order), after.skus.map(() => ['Size', 'Color']));
  check('dòng sắp theo trục mới', after.skus.map(label), ['S / BLACK', 'S / WHITE', 'M / BLACK', 'M / WHITE']);
  // Ví dụ của yêu cầu: BLACK + S → SKU-A → $10 → Qty 5 ⇒ S + BLACK vẫn là SKU-A.
  const blackS = after.skus.find((sku) => label(sku) === 'S / BLACK');
  const originalBlackS = start.skus.find((sku) => label(sku) === 'BLACK / S');
  check(
    'S + BLACK vẫn là dữ liệu của BLACK + S',
    [blackS?.sellerSku, blackS?.salePrice, blackS?.quantity],
    [originalBlackS?.sellerSku, originalBlackS?.salePrice, originalBlackS?.quantity],
  );
}

// ---------------------------------------------------------------------------
console.log('Ảnh biến thể: chỉ trục đầu, không mất, không hoán đổi');
{
  const start = { variations: [COLOR, SIZE], skus: filledSkus([COLOR, SIZE]) };
  start.skus = reconcileSkus([COLOR, SIZE], [COLOR, SIZE], start.skus); // đã đồng bộ ảnh
  const startImages = imagesByKey(buildSkuCombinations([COLOR, SIZE], start.skus));
  check(
    'trước: ảnh theo Color',
    Object.values(startImages),
    ['file-black', 'file-black', 'file-white', 'file-white'],
  );

  const down = drag({ ...start, skus: buildSkuCombinations([COLOR, SIZE], start.skus) }, 0, 1);
  check('Size đứng đầu (không ảnh) ⇒ dòng không mang ảnh của Color', Object.values(imagesByKey(down.skus)), [
    null,
    null,
    null,
    null,
  ]);
  check('🔴 ảnh của Color KHÔNG bị xoá khỏi trục', down.variations[1].images, COLOR.images);

  const back = drag(down, 1, 0);
  check('kéo Color lên lại ⇒ ảnh quay về ĐÚNG tổ hợp', imagesByKey(back.skus), startImages);
  check('kéo đi kéo về ⇒ dữ liệu y nguyên', dataByKey(back.skus), dataByKey(start.skus));
  check('kéo đi kéo về ⇒ thứ tự dòng y nguyên', back.skus.map(label), start.skus.map(label));
}

// ---------------------------------------------------------------------------
console.log('Edge cases');
{
  // 1 trục: không có gì để đổi.
  const one = { variations: [SIZE], skus: filledSkus([SIZE]) };
  check('1 trục ⇒ moveVariation trả CHÍNH mảng cũ', moveVariation(one.variations, 0, 0) === one.variations, true);

  // 4 trục, nhiều giá trị, kéo nhanh nhiều lần rồi kéo về.
  const MATERIAL: ManualVariation = { name: 'Material', values: ['Cotton', 'Poly', 'Blend'] };
  const many = [TYPE, COLOR, SIZE, MATERIAL];
  let state = { variations: many, skus: filledSkus(many) };
  const original = dataByKey(state.skus);
  const moves: Array<[number, number]> = [[3, 0], [0, 2], [1, 3], [2, 1], [3, 0], [0, 3]];
  for (const [from, to] of moves) {
    state = drag(state, from, to);
    check(`sau kéo ${from}→${to}: không mất dữ liệu`, dataByKey(state.skus), original);
    check(
      `sau kéo ${from}→${to}: optionValues theo trục`,
      state.skus.every((sku) => order(sku).join() === names(state.variations).join()),
      true,
    );
    check(
      `sau kéo ${from}→${to}: không trùng tổ hợp`,
      new Set(state.skus.map((sku) => combinationKey(sku.optionValues))).size,
      state.skus.length,
    );
  }

  // Trục chưa có giá trị: kéo nó không đổi bảng SKU (trục trống không vào tổ hợp).
  const empty: ManualVariation = { name: 'Style', values: [] };
  const withEmpty = { variations: [COLOR, SIZE, empty], skus: filledSkus([COLOR, SIZE]) };
  const movedEmpty = drag(withEmpty, 2, 0);
  check('kéo trục CHƯA có giá trị ⇒ bảng SKU giữ nguyên (cùng tham chiếu)', movedEmpty.skus === withEmpty.skus, true);

  // Giá trị trùng / rỗng trong trục: đã được chuẩn hoá trước khi so.
  const dup: ManualVariation = { name: 'Size', values: ['S', 'S', ' ', 'M'] };
  const dupState = { variations: [COLOR, dup], skus: filledSkus([COLOR, dup]) };
  const dupMoved = drag(dupState, 1, 0);
  check('giá trị trùng / rỗng ⇒ vẫn 4 dòng, dữ liệu giữ nguyên', dataByKey(dupMoved.skus), dataByKey(dupState.skus));

  // Kéo rồi xoá trục: luật "bỏ trục" cũ vẫn áp (gộp theo phần còn lại).
  const dragged = drag({ variations: [COLOR, SIZE], skus: filledSkus([COLOR, SIZE]) }, 1, 0);
  const removed = reconcileSkus(dragged.variations, [dragged.variations[0]], dragged.skus);
  check('kéo rồi xoá Color ⇒ còn 2 dòng theo Size', removed.map(label), ['S', 'M']);

  // Kéo rồi thêm trục: nhân dòng, mang theo dữ liệu.
  const added = reconcileSkus(dragged.variations, [...dragged.variations, TYPE], dragged.skus);
  check('kéo rồi thêm Type ⇒ 8 dòng', added.length, 8);
  check('dòng mới theo thứ tự trục Size, Color, Type', added.map(order)[0], ['Size', 'Color', 'Type']);
  check(
    'giá / tồn mang theo từ dòng gốc',
    added.filter((sku) => sku.optionValues[0].value === 'S' && sku.optionValues[1].value === 'BLACK').map((sku) => [sku.salePrice, sku.quantity]),
    [
      [dragged.skus[0].salePrice, dragged.skus[0].quantity],
      [dragged.skus[0].salePrice, dragged.skus[0].quantity],
    ],
  );
}

// ---------------------------------------------------------------------------
console.log('Lưu nháp → mở lại: thứ tự trục được giữ');
{
  const dragged = drag({ variations: [COLOR, SIZE], skus: filledSkus([COLOR, SIZE]) }, 1, 0);
  const form = { ...emptyCustomListingForm(), variations: dragged.variations, skus: dragged.skus };
  const manual = buildManualData(form);

  check('payload: thứ tự trục Size, Color', manual.variations?.map((variation) => variation.name), ['Size', 'Color']);
  check('🔴 payload: ảnh của Color được LƯU dù không đứng đầu', manual.variations?.[1].images, COLOR.images);
  check('payload: optionValues của SKU theo Size, Color', manual.skus?.map(order)[0], ['Size', 'Color']);

  const session = {
    market: 'US',
    shops: [],
    templates: [],
    groupTemplateId: null,
  } as unknown as PodListingSessionDetail;
  const product = {
    id: 'sp-1',
    title: '',
    images: [],
    manualData: JSON.parse(JSON.stringify(manual)),
  } as unknown as PodSessionProduct;
  const restored = restoreCustomListingForm(session, product);

  check('mở lại: thứ tự trục giữ nguyên', names(restored.variations), ['Size', 'Color']);
  check('mở lại: ảnh của Color còn nguyên', restored.variations[1].images, COLOR.images);
  check('mở lại: dữ liệu từng tổ hợp giữ nguyên', dataByKey(restored.skus), dataByKey(dragged.skus));

  // Mở lại rồi kéo Color về đầu ⇒ ảnh quay về đúng giá trị.
  const back = drag({ variations: restored.variations, skus: restored.skus }, 1, 0);
  check(
    'mở lại → kéo Color lên ⇒ ảnh theo Color',
    back.skus.map((sku) => [label(sku), sku.imageFileId]),
    [
      ['BLACK / S', 'file-black'],
      ['BLACK / M', 'file-black'],
      ['WHITE / S', 'file-white'],
      ['WHITE / M', 'file-white'],
    ],
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
