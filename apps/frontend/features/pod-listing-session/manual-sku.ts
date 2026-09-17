import type { ManualSku, ManualVariation } from './types';

/**
 * Sinh bảng SKU từ các trục biến thể (tích Descartes).
 *
 * `Color: Black, White` × `Size: S, M` ⇒ Black/S · Black/M · White/S · White/M.
 *
 * 🔴 **Giữ lại dữ liệu người dùng đã gõ.** Đây là điểm dễ hỏng nhất của màn hình này: người
 * vận hành điền giá cho 12 dòng, thêm một màu nữa rồi bấm "Tạo SKU" — và mất sạch 12 dòng
 * giá nếu hàm này dựng lại từ đầu. Tổ hợp cũ được tra theo **khoá tổ hợp** (`Color=Black|
 * Size=S`), nên đổi thứ tự trục hay thêm giá trị mới đều không đụng tới dòng đã có.
 *
 * 🔴 Khoá tra cứu dùng cặp `tên trục = giá trị`, KHÔNG dùng chỉ số dòng: chỉ số đổi ngay khi
 * thêm một giá trị vào giữa danh sách, và khi đó giá của "Black / S" sẽ nhảy sang "Black / M".
 */
export function buildSkuCombinations(
  variations: ManualVariation[],
  previous: ManualSku[] = [],
  options: { skuPrefix?: string } = {},
): ManualSku[] {
  const axes = normalizeVariations(variations);
  if (axes.length === 0) return [];

  const byKey = new Map(previous.map((sku) => [combinationKey(sku.optionValues), sku]));

  let combos: ManualSku['optionValues'][] = [[]];
  for (const axis of axes) {
    combos = combos.flatMap((combo) =>
      axis.values.map((value) => [...combo, { name: axis.name, value }]),
    );
  }

  return combos.map((optionValues) => {
    const existing = byKey.get(combinationKey(optionValues));
    if (existing) return { ...existing, optionValues };

    return {
      sellerSku: suggestSellerSku(optionValues, options.skuPrefix),
      optionValues,
      salePrice: '',
      retailPrice: '',
      quantity: 0,
    };
  });
}

/**
 * Bỏ trục không dùng được và **loại giá trị trùng trong cùng một trục**.
 *
 * Trùng giá trị sinh ra hai dòng SKU giống hệt nhau — TikTok từ chối cả lô, và người dùng
 * không nhìn ra vì trên lưới chúng nằm cạnh nhau trông như một.
 */
function normalizeVariations(variations: ManualVariation[]): ManualVariation[] {
  return variations
    .map((variation) => {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const raw of variation.values) {
        const value = raw.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
      return { name: variation.name.trim(), values };
    })
    .filter((variation) => variation.name !== '' && variation.values.length > 0);
}

/** Khoá tổ hợp — độc lập với thứ tự trục để đổi thứ tự không làm mất dữ liệu đã gõ. */
function combinationKey(optionValues: ManualSku['optionValues']): string {
  return [...optionValues]
    .map((option) => `${option.name}=${option.value}`)
    .sort()
    .join('|');
}

/**
 * Seller SKU gợi ý — người dùng sửa được.
 *
 * Chỉ giữ chữ/số để không sinh mã chứa dấu cách hay ký tự lạ; `Sport Grey` ⇒ `SPORTGREY`.
 */
function suggestSellerSku(optionValues: ManualSku['optionValues'], prefix?: string): string {
  const parts = optionValues.map((option) =>
    option.value.toUpperCase().replace(/[^A-Z0-9]+/g, ''),
  );
  return [prefix?.trim().toUpperCase(), ...parts].filter(Boolean).join('-');
}

/** Số tổ hợp sẽ sinh ra — dùng để cảnh báo TRƯỚC khi dựng một lưới khổng lồ. */
export function countCombinations(variations: ManualVariation[]): number {
  const axes = normalizeVariations(variations);
  if (axes.length === 0) return 0;
  return axes.reduce((total, axis) => total * axis.values.length, 1);
}
