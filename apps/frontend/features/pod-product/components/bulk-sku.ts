/**
 * Cập nhật SKU **hàng loạt** — phần logic thuần, tách khỏi giao diện để kiểm được.
 *
 * 🔴 Vì sao tách: một sản phẩm POD có thể có hàng trăm SKU (5 màu × 6 size × 4 kiểu in).
 * Sửa giá từng dòng là không dùng được. Nhưng "áp cho tất cả SKU màu Đen" mà chọn nhầm tập
 * hợp thì người dùng vừa đổi giá hàng loạt trên một sản phẩm ĐANG BÁN — và họ chỉ phát hiện
 * khi đơn về sai giá. Nên phép chọn phải kiểm được bằng test, không nằm lẫn trong JSX.
 */

/** Một SKU nhìn từ góc độ lọc — chỉ cần đúng hai thứ này. */
export interface BulkSkuCandidate {
  tiktokSkuId: string;
  /** Tên biến thể TikTok trả về, dạng `"Black / L"`. */
  variantName: string | null;
}

/** Một giá trị biến thể chọn được, ví dụ `Màu: Đen`. */
export interface VariationValue {
  /** Vị trí trong tên biến thể (0 = trục thứ nhất). Đây là phần định danh thật. */
  axis: number;
  value: string;
  /** Số SKU mang giá trị này — hiện ngay để người dùng biết sắp đụng vào bao nhiêu dòng. */
  count: number;
}

/** Trường được áp hàng loạt. Vắng mặt = không đụng tới. */
export interface BulkSkuPatch {
  salePrice?: string;
  listPrice?: string;
  quantity?: string;
}

/** TikTok ghép các trục biến thể bằng `" / "` (xem `PodProductMapper.toVariant`). */
const AXIS_SEPARATOR = '/';

function axesOf(variantName: string | null): string[] {
  if (!variantName) return [];
  return variantName
    .split(AXIS_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Liệt kê các giá trị biến thể chọn được, kèm số SKU của từng giá trị.
 *
 * 🔴 Khoá theo **vị trí trục**, không phải theo chữ. Một sản phẩm có thể có giá trị trùng
 * tên ở hai trục khác nhau (`"Trắng / Trắng"` — màu áo và màu chữ in). Gộp chúng lại là áp
 * giá cho một tập hợp rộng hơn thứ người dùng nghĩ mình đang chọn.
 */
export function listVariationValues(skus: BulkSkuCandidate[]): VariationValue[] {
  const counter = new Map<string, VariationValue>();

  for (const sku of skus) {
    axesOf(sku.variantName).forEach((value, axis) => {
      const key = `${axis} ${value.toLowerCase()}`;
      const existing = counter.get(key);
      if (existing) existing.count += 1;
      else counter.set(key, { axis, value, count: 1 });
    });
  }

  return [...counter.values()].sort((a, b) => a.axis - b.axis || a.value.localeCompare(b.value));
}

/**
 * Những SKU chịu tác động của lựa chọn hiện tại.
 *
 * `selected` rỗng ⇒ **tất cả** SKU. Nhiều lựa chọn trên CÙNG một trục là "hoặc" (Đen hoặc
 * Trắng); khác trục là "và" (Đen **và** size L) — đúng như cách người dùng đọc bộ lọc.
 */
export function matchSkus(skus: BulkSkuCandidate[], selected: VariationValue[]): string[] {
  if (selected.length === 0) return skus.map((sku) => sku.tiktokSkuId);

  const byAxis = new Map<number, Set<string>>();
  for (const item of selected) {
    const set = byAxis.get(item.axis) ?? new Set<string>();
    set.add(item.value.toLowerCase());
    byAxis.set(item.axis, set);
  }

  return skus
    .filter((sku) => {
      const axes = axesOf(sku.variantName);
      for (const [axis, values] of byAxis) {
        const actual = axes[axis];
        if (!actual || !values.has(actual.toLowerCase())) return false;
      }
      return true;
    })
    .map((sku) => sku.tiktokSkuId);
}

/** Bỏ trường trống — người dùng chỉ điền ô giá thì KHÔNG được xoá trắng tồn kho. */
export function cleanPatch(patch: BulkSkuPatch): BulkSkuPatch {
  const result: BulkSkuPatch = {};
  if (patch.salePrice?.trim()) result.salePrice = patch.salePrice.trim();
  if (patch.listPrice?.trim()) result.listPrice = patch.listPrice.trim();
  if (patch.quantity?.trim()) result.quantity = patch.quantity.trim();
  return result;
}

/** Có gì để áp không. Không có thì nút Áp dụng phải tắt — tránh "bấm mà không có gì xảy ra". */
export function hasPatch(patch: BulkSkuPatch): boolean {
  return Object.keys(cleanPatch(patch)).length > 0;
}
