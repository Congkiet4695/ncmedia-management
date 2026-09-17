/**
 * Cập nhật SKU hàng loạt — phép CHỌN phải đúng.
 *
 * 🔴 Vì sao có tệp này: "Áp dụng cho 12 SKU" là một thao tác sửa giá trên sản phẩm ĐANG BÁN.
 * Chọn dư một SKU là bán lỗ một biến thể; chọn thiếu là người dùng tưởng đã đổi giá cả dòng
 * hàng nhưng vài SKU vẫn giữ giá cũ. Cả hai đều không ném lỗi và chỉ lộ ra khi đơn đã về.
 *
 * Chạy: `npm run test:bulk-sku`
 */

import assert from 'node:assert/strict';
import {
  cleanPatch,
  hasPatch,
  listVariationValues,
  matchSkus,
  type BulkSkuCandidate,
} from '../features/pod-product/components/bulk-sku.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Sản phẩm POD điển hình: 2 màu × 3 size = 6 SKU, tên ghép bằng `" / "` như TikTok trả về. */
const CATALOG: BulkSkuCandidate[] = [
  { tiktokSkuId: 's1', variantName: 'Black / S' },
  { tiktokSkuId: 's2', variantName: 'Black / M' },
  { tiktokSkuId: 's3', variantName: 'Black / L' },
  { tiktokSkuId: 's4', variantName: 'White / S' },
  { tiktokSkuId: 's5', variantName: 'White / M' },
  { tiktokSkuId: 's6', variantName: 'White / L' },
];

const value = (axis: number, name: string) => ({ axis, value: name, count: 0 });

console.log('Liệt kê giá trị biến thể');

test('gom đúng giá trị của từng trục, kèm số SKU', () => {
  const values = listVariationValues(CATALOG);

  assert.deepEqual(
    values.map((item) => `${item.axis}:${item.value}=${item.count}`),
    ['0:Black=3', '0:White=3', '1:L=2', '1:M=2', '1:S=2'],
  );
});

test('🔴 giá trị trùng tên ở hai trục KHÔNG bị gộp', () => {
  // Áo trắng in chữ trắng: "White" xuất hiện ở cả trục màu áo lẫn trục màu chữ.
  const values = listVariationValues([
    { tiktokSkuId: 'a', variantName: 'White / White' },
    { tiktokSkuId: 'b', variantName: 'White / Black' },
  ]);

  const white = values.filter((item) => item.value === 'White');
  assert.equal(white.length, 2, 'phải là hai mục riêng, một cho mỗi trục');
  assert.deepEqual(
    white.map((item) => [item.axis, item.count]),
    [
      [0, 2],
      [1, 1],
    ],
  );
});

test('SKU không có biến thể (sản phẩm đơn) ⇒ không có giá trị nào để lọc', () => {
  assert.deepEqual(listVariationValues([{ tiktokSkuId: 'only', variantName: null }]), []);
});

console.log('\nChọn SKU chịu tác động');

test('🔴 không chọn gì ⇒ TẤT CẢ SKU (đúng như nhãn nút nói)', () => {
  assert.deepEqual(matchSkus(CATALOG, []), ['s1', 's2', 's3', 's4', 's5', 's6']);
});

test('một giá trị ⇒ đúng các SKU mang giá trị đó', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'Black')]), ['s1', 's2', 's3']);
});

test('🔴 cùng trục là HOẶC — Black hoặc White = cả 6', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'Black'), value(0, 'White')]).length, 6);
});

test('🔴 khác trục là VÀ — Black và size M = đúng 1 SKU', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'Black'), value(1, 'M')]), ['s2']);
});

test('kết hợp: (Black hoặc White) và size L', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'Black'), value(0, 'White'), value(1, 'L')]), [
    's3',
    's6',
  ]);
});

test('không SKU nào khớp ⇒ danh sách rỗng, nút Áp dụng phải tắt', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'Black'), value(1, 'XXL')]), []);
});

test('so khớp KHÔNG phân biệt hoa thường', () => {
  assert.deepEqual(matchSkus(CATALOG, [value(0, 'BLACK')]), ['s1', 's2', 's3']);
});

test('🔴 SKU thiếu trục thứ hai không bị coi là khớp bừa', () => {
  const mixed: BulkSkuCandidate[] = [...CATALOG, { tiktokSkuId: 's7', variantName: 'Black' }];
  assert.deepEqual(matchSkus(mixed, [value(1, 'M')]), ['s2', 's5']);
});

console.log('\nTrường được áp');

test('🔴 ô trống KHÔNG được áp — điền mỗi giá thì tồn kho phải nguyên vẹn', () => {
  assert.deepEqual(cleanPatch({ salePrice: '19.99', listPrice: '', quantity: '   ' }), {
    salePrice: '19.99',
  });
});

test('không điền gì ⇒ không có gì để áp', () => {
  assert.equal(hasPatch({ salePrice: '', quantity: '' }), false);
  assert.equal(hasPatch({ quantity: '0' }), true);
});

test('cắt khoảng trắng thừa', () => {
  assert.deepEqual(cleanPatch({ salePrice: '  12.50  ' }), { salePrice: '12.50' });
});

console.log(`\n✓ ${passed}/${passed} đúng`);
