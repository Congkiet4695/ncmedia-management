import type { ManualSku, ManualVariation } from './types';

/**
 * Nguồn dữ liệu cho một dòng SKU MỚI SINH — thường là SKU Template đang áp.
 *
 * Trả về phần dữ liệu template có cho đúng tổ hợp đó (Seller SKU, giá, tồn, ảnh…); `null` =
 * template không có tổ hợp này ⇒ dùng giá trị mặc định trống + Seller SKU gợi ý.
 */
export type SkuSeed = (optionValues: ManualSku['optionValues']) => Partial<ManualSku> | null;

export interface SkuBuildOptions {
  skuPrefix?: string | null;
  skuSuffix?: string | null;
  seed?: SkuSeed;
}

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
 *
 * Dòng MỚI lấy dữ liệu từ `options.seed` (SKU Template đang áp) nếu template có tổ hợp đó;
 * không có thì trống + Seller SKU gợi ý.
 */
export function buildSkuCombinations(
  variations: ManualVariation[],
  previous: ManualSku[] = [],
  options: SkuBuildOptions = {},
): ManualSku[] {
  const axes = normalizeVariations(variations);
  if (axes.length === 0) return [];

  const byKey = new Map(previous.map((sku) => [combinationKey(sku.optionValues), sku]));

  return cartesian(axes).map((optionValues) => {
    const existing = byKey.get(combinationKey(optionValues));
    if (existing) return { ...existing, optionValues };
    return newSku(optionValues, options);
  });
}

/**
 * Đồng bộ bảng SKU khi **trục / giá trị biến thể đổi** — không cần bấm "Tạo SKU".
 *
 * ```
 *   xoá giá trị      ⇒ bỏ mọi dòng chứa giá trị đó
 *   thêm giá trị     ⇒ sinh đúng các tổ hợp chứa giá trị mới (chéo với giá trị hiện có của
 *                       trục khác), lấy dữ liệu từ template nếu có
 *   đổi tên giá trị  ⇒ (cùng vị trí trong trục) đổi tên trên dòng, GIỮ giá/tồn/SKU đã gõ
 *   thêm trục        ⇒ nhân mỗi dòng đang có với các giá trị của trục mới (mang theo dữ liệu)
 *   bỏ trục          ⇒ gộp dòng theo phần trục còn lại (giữ dòng đầu tiên)
 * ```
 *
 * 🔴 Vì sao KHÔNG dựng lại tích Descartes rồi tra khoá: bảng SKU có thể là TẬP CON của tích
 * (SKU Template chỉ sinh / bật một phần tổ hợp). Dựng lại là đẻ thêm những tổ hợp mà người
 * dựng template đã cố ý bỏ. Ở đây chỉ CHẠM tới phần thay đổi; dòng còn hợp lệ giữ nguyên
 * tham chiếu và toàn bộ dữ liệu đã gõ.
 *
 * 🔴 Chưa có bảng (`skus` rỗng) ⇒ trả về rỗng: sinh bảng lần đầu vẫn là nút "Tạo SKU" (có
 * cảnh báo khi tổ hợp quá lớn). Không đổi gì ⇒ trả về CHÍNH mảng cũ để không render lại.
 *
 * Bất biến sau khi chạy: mọi dòng có ĐỦ các trục hiện tại, mọi giá trị đều tồn tại trên trục,
 * không có hai dòng cùng tổ hợp.
 */
export function reconcileSkus(
  previousVariations: ManualVariation[],
  nextVariations: ManualVariation[],
  skus: ManualSku[],
  options: SkuBuildOptions = {},
): ManualSku[] {
  if (skus.length === 0) return skus;
  const prevAxes = normalizeVariations(previousVariations);
  const nextAxes = normalizeVariations(nextVariations);
  if (nextAxes.length === 0) return [];

  let rows: ManualSku[] = skus;
  let changed = false;

  // 0. Đổi TÊN trục (gõ sửa "Size" → "Siz" → "Sizes"): cùng vị trí, tên cũ biến mất, tên mới
  //    xuất hiện ⇒ đổi tên trên dòng, giữ nguyên dữ liệu. Không nhận ra thì đây thành "bỏ trục +
  //    thêm trục" và mọi dòng bị gộp rồi nhân lại — mất giá đã gõ chỉ vì sửa một chữ.
  if (prevAxes.length === nextAxes.length) {
    const prevNames = new Set(prevAxes.map((axis) => axis.name));
    const nextNames = new Set(nextAxes.map((axis) => axis.name));
    const axisRenames = new Map<string, string>();
    prevAxes.forEach((axis, index) => {
      const candidate = nextAxes[index].name;
      if (axis.name !== candidate && !nextNames.has(axis.name) && !prevNames.has(candidate)) {
        axisRenames.set(axis.name, candidate);
      }
    });
    if (axisRenames.size > 0) {
      changed = true;
      rows = rows.map((sku) => ({
        ...sku,
        optionValues: sku.optionValues.map((option) =>
          axisRenames.has(option.name) ? { ...option, name: axisRenames.get(option.name) as string } : option,
        ),
      }));
      prevAxes.forEach((axis) => {
        if (axisRenames.has(axis.name)) axis.name = axisRenames.get(axis.name) as string;
      });
    }
  }

  const prevByName = new Map(prevAxes.map((axis) => [axis.name, axis]));
  const nextByName = new Map(nextAxes.map((axis) => [axis.name, axis]));

  // 1. Đổi tên giá trị (cùng trục, cùng vị trí): sửa tên trên dòng, giữ dữ liệu.
  const renames = new Map<string, Map<string, string>>();
  for (const axis of nextAxes) {
    const prev = prevByName.get(axis.name);
    if (!prev || prev.values.length !== axis.values.length) continue;
    const nextSet = new Set(axis.values);
    const prevSet = new Set(prev.values);
    const map = new Map<string, string>();
    prev.values.forEach((value, index) => {
      const replacement = axis.values[index];
      if (value !== replacement && !nextSet.has(value) && !prevSet.has(replacement)) {
        map.set(value, replacement);
      }
    });
    if (map.size > 0) renames.set(axis.name, map);
  }
  if (renames.size > 0) {
    changed = true;
    rows = rows.map((sku) => ({
      ...sku,
      optionValues: sku.optionValues.map((option) => {
        const replacement = renames.get(option.name)?.get(option.value);
        return replacement ? { ...option, value: replacement } : option;
      }),
    }));
  }

  // 2. Bỏ trục: gộp dòng theo phần còn lại.
  const removedAxes = prevAxes.filter((axis) => !nextByName.has(axis.name)).map((axis) => axis.name);
  if (removedAxes.length > 0) {
    changed = true;
    const drop = new Set(removedAxes);
    rows = rows.map((sku) => ({
      ...sku,
      optionValues: sku.optionValues.filter((option) => !drop.has(option.name)),
    }));
  }

  // 3. Thêm trục: nhân mỗi dòng với giá trị của trục mới, mang theo dữ liệu đã gõ.
  const addedAxes = nextAxes.filter((axis) => !prevByName.has(axis.name));
  for (const axis of addedAxes) {
    changed = true;
    rows = rows.flatMap((sku) =>
      axis.values.map((value) => {
        const optionValues = [...sku.optionValues, { name: axis.name, value }];
        // Giá / tồn / ảnh mang theo từ dòng gốc (dữ liệu người dùng đã gõ); chỉ Seller SKU
        // phải khác nhau giữa các dòng vừa tách ra — lấy của template nếu có, không thì gợi ý.
        const seeded = options.seed?.(optionValues);
        return {
          ...sku,
          optionValues,
          sellerSku: seeded?.sellerSku?.trim() || suggestSellerSku(optionValues, options),
        };
      }),
    );
  }

  // 4. Xoá giá trị / dòng không còn hợp lệ: mọi giá trị phải còn trên trục, đủ trục.
  const before = rows.length;
  rows = rows.filter((sku) => isRowValid(sku, nextAxes));
  if (rows.length !== before) changed = true;

  // 5. Thêm giá trị vào trục đã có: sinh các tổ hợp chứa giá trị mới, chéo với giá trị hiện
  //    có của những trục khác. Chỉ thêm tổ hợp CHƯA có (xoá rồi thêm lại không sinh trùng).
  const existingKeys = new Set(rows.map((sku) => combinationKey(sku.optionValues)));
  const added: ManualSku[] = [];
  for (const axis of nextAxes) {
    const prev = prevByName.get(axis.name);
    if (!prev) continue;
    const renamedInto = new Set(renames.get(axis.name)?.values() ?? []);
    const prevSet = new Set(prev.values);
    const newValues = axis.values.filter((value) => !prevSet.has(value) && !renamedInto.has(value));
    if (newValues.length === 0) continue;
    for (const value of newValues) {
      const others = nextAxes.map((other) =>
        other.name === axis.name ? { name: other.name, values: [value] } : other,
      );
      for (const optionValues of cartesian(others)) {
        const key = combinationKey(optionValues);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        added.push(newSku(optionValues, options));
      }
    }
  }
  if (added.length > 0) {
    changed = true;
    rows = [...rows, ...added];
  }

  // 6. Sắp lại thứ tự option theo thứ tự trục hiện tại + loại dòng trùng tổ hợp.
  const seen = new Set<string>();
  const order = new Map(nextAxes.map((axis, index) => [axis.name, index]));
  const normalized: ManualSku[] = [];
  for (const sku of rows) {
    const key = combinationKey(sku.optionValues);
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    const sorted = [...sku.optionValues].sort(
      (a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0),
    );
    const sameOrder = sorted.every((option, index) => option === sku.optionValues[index]);
    if (!sameOrder) changed = true;
    normalized.push(sameOrder ? sku : { ...sku, optionValues: sorted });
  }

  return changed ? normalized : skus;
}

/**
 * Bỏ trục không dùng được và **loại giá trị trùng trong cùng một trục**.
 *
 * Trùng giá trị sinh ra hai dòng SKU giống hệt nhau — TikTok từ chối cả lô, và người dùng
 * không nhìn ra vì trên lưới chúng nằm cạnh nhau trông như một.
 */
export function normalizeVariations(variations: ManualVariation[]): ManualVariation[] {
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
export function combinationKey(optionValues: ManualSku['optionValues']): string {
  return [...optionValues]
    .map((option) => `${option.name.trim()}=${option.value.trim()}`)
    .sort()
    .join('|');
}

/**
 * Seller SKU gợi ý — người dùng sửa được.
 *
 * Chỉ giữ chữ/số để không sinh mã chứa dấu cách hay ký tự lạ; `Sport Grey` ⇒ `SPORTGREY`.
 * Tiền tố / hậu tố của SKU Template (nếu áp) bọc hai đầu.
 */
export function suggestSellerSku(
  optionValues: ManualSku['optionValues'],
  options: { skuPrefix?: string | null; skuSuffix?: string | null } = {},
): string {
  const parts = optionValues.map((option) =>
    option.value.toUpperCase().replace(/[^A-Z0-9]+/g, ''),
  );
  return [options.skuPrefix?.trim().toUpperCase(), ...parts, options.skuSuffix?.trim().toUpperCase()]
    .filter(Boolean)
    .join('-');
}

/** Số tổ hợp sẽ sinh ra — dùng để cảnh báo TRƯỚC khi dựng một lưới khổng lồ. */
export function countCombinations(variations: ManualVariation[]): number {
  const axes = normalizeVariations(variations);
  if (axes.length === 0) return 0;
  return axes.reduce((total, axis) => total * axis.values.length, 1);
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function cartesian(axes: ManualVariation[]): ManualSku['optionValues'][] {
  let combos: ManualSku['optionValues'][] = [[]];
  for (const axis of axes) {
    combos = combos.flatMap((combo) =>
      axis.values.map((value) => [...combo, { name: axis.name, value }]),
    );
  }
  return combos;
}

/** Dòng mới: dữ liệu template nếu có, còn lại trống + Seller SKU gợi ý. */
function newSku(optionValues: ManualSku['optionValues'], options: SkuBuildOptions): ManualSku {
  const seeded = options.seed?.(optionValues);
  return {
    sellerSku: seeded?.sellerSku?.trim() || suggestSellerSku(optionValues, options),
    optionValues,
    salePrice: seeded?.salePrice ?? '',
    retailPrice: seeded?.retailPrice ?? '',
    quantity: seeded?.quantity ?? 0,
    ...(seeded?.imageFileId ? { imageFileId: seeded.imageFileId } : {}),
    ...(seeded?.barcode ? { barcode: seeded.barcode } : {}),
  };
}

/** Dòng còn hợp lệ với bộ trục: đủ mọi trục, mỗi giá trị còn tồn tại trên trục của nó. */
function isRowValid(sku: ManualSku, axes: ManualVariation[]): boolean {
  if (sku.optionValues.length !== axes.length) return false;
  const present = new Set<string>();
  for (const option of sku.optionValues) {
    const axis = axes.find((entry) => entry.name === option.name.trim());
    if (!axis || !axis.values.includes(option.value.trim()) || present.has(axis.name)) return false;
    present.add(axis.name);
  }
  return true;
}
