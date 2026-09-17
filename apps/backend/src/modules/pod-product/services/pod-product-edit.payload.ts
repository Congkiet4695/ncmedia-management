import type {
  TiktokPartialEditProductRequest,
  TiktokPartialEditSku,
} from '../../tiktok-sdk/types/tiktok-product.types';

/**
 * Dựng payload **Partial Edit** từ thứ người dùng gửi lên và ảnh chụp sản phẩm hiện tại.
 *
 * 🔴 Đây là hàm quan trọng nhất của luồng sửa sản phẩm, và là hàm THUẦN để kiểm được bằng
 * unit test: nó quyết định **đúng những gì** được gửi tới một sản phẩm đang bán trên sàn.
 * Gửi thừa một trường là ghi đè dữ liệu người dùng không đụng tới; gửi thiếu là "lưu xong
 * mà không có gì thay đổi".
 *
 * Ba quy tắc:
 *
 *  1. **Chỉ gửi trường THỰC SỰ đổi.** So với ảnh chụp hiện tại, giống hệt thì bỏ ra khỏi
 *     payload. Đây là yêu cầu §14 và cũng là cách giảm rủi ro TikTok từ chối cả request vì
 *     một trường không liên quan.
 *  2. **Chỉ gửi SKU có thay đổi**, và mỗi SKU chỉ kèm những trường của chính nó đã đổi.
 *     Sửa giá 2 SKU trong một sản phẩm 600 SKU thì payload có đúng 2 dòng.
 *  3. **Không bao giờ tự suy diễn.** Trường người dùng không gửi lên (`undefined`) nghĩa là
 *     "không đụng tới", khác hẳn gửi chuỗi rỗng (= xoá). Nhập nhèm hai thứ này là xoá mô tả
 *     của một sản phẩm đang bán chỉ vì form không gửi trường đó.
 */

/** Ảnh chụp sản phẩm hiện tại (đọc từ database đã đồng bộ) — vế SO SÁNH của phép diff. */
export interface ProductSnapshot {
  title: string | null;
  description: string | null;
  tiktokBrandId: string | null;
  packageWeight: string | null;
  weightUnit: string | null;
  packageLength: string | null;
  packageWidth: string | null;
  packageHeight: string | null;
  dimensionUnit: string | null;
  /** Từ khoá & highlights đã đồng bộ về — có vế so nên không phải lần nào cũng gửi lại. */
  searchTerms: string[] | null;
  keyProductFeatures: string[] | null;
  /** Ảnh sản phẩm hiện tại, ĐÚNG THỨ TỰ trên sàn. Tấm đầu là ảnh đại diện. */
  mainImageUris: string[];
  sizeChartUri: string | null;
  sizeChartTemplateId: string | null;
  videoId: string | null;
  variants: Array<{
    tiktokSkuId: string;
    sellerSku: string | null;
    salePrice: string | null;
    listPrice: string | null;
    inventoryTotal: number;
    currency: string | null;
  }>;
}

/** Thay đổi người dùng gửi lên. Trường `undefined` = KHÔNG đụng tới. */
export interface ProductEditInput {
  title?: string;
  description?: string;
  searchTerms?: string[];
  highlights?: string[];
  brandId?: string;
  package?: {
    weight?: string;
    weightUnit?: string;
    length?: string;
    width?: string;
    height?: string;
    dimensionUnit?: string;
  };
  /**
   * Bộ ảnh sản phẩm SAU khi sửa — đầy đủ và đúng thứ tự, đã quy về `uri`.
   *
   * 🔴 Đây là TRẠNG THÁI CUỐI, không phải danh sách ảnh thêm vào: thêm, xoá và đổi thứ tự
   * đều biểu diễn bằng cùng một mảng này, vì `main_images` của TikTok thay cả bộ.
   */
  mainImageUris?: string[];
  /** `null` = người dùng gỡ bảng size (xem `buildMedia` để biết vì sao chưa gửi được). */
  sizeChart?: { uri?: string; templateId?: string } | null;
  /** ID video TikTok trả về sau khi upload. */
  videoId?: string;
  skus?: ProductEditSkuInput[];
}

export interface ProductEditSkuInput {
  /** TikTok SKU ID — bắt buộc, đây là cách TikTok biết sửa dòng nào. */
  tiktokSkuId: string;
  sellerSku?: string;
  salePrice?: string;
  listPrice?: string;
  quantity?: number;
  /** Kho nhận tồn kho mới. Thiếu ⇒ không gửi phần tồn kho (TikTok cần biết kho nào). */
  warehouseId?: string;
}

/** Kết quả dựng payload: phần gửi đi + phần tóm tắt để ghi log và hiện cho người dùng. */
export interface PartialEditPlan {
  body: TiktokPartialEditProductRequest;
  /** Tên các trường cấp sản phẩm sẽ đổi — dùng cho log và thông báo. */
  changedFields: string[];
  /** Số SKU sẽ đổi. */
  changedSkus: number;
  /** Không có gì đổi ⇒ nơi gọi KHÔNG được gọi TikTok. */
  isEmpty: boolean;
}

/** So sánh hai chuỗi tiền/số ở dạng GIÁ TRỊ, không phải chuỗi: `19.9` và `19.90` là một. */
function sameAmount(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim();
  const b = right?.trim();
  if (!a && !b) return true;
  if (!a || !b) return false;
  const na = Number(a);
  const nb = Number(b);
  // Không phải số thì so nguyên văn — thà gửi thừa còn hơn bỏ sót một thay đổi thật.
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return a === b;
  return na === nb;
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? '').trim() === (right ?? '').trim();
}

/** Hai danh sách chuỗi giống nhau — THỨ TỰ có tính, vì thứ tự ảnh là dữ liệu. */
function sameList(left: string[], right: string[] | null | undefined): boolean {
  const other = right ?? [];
  return left.length === other.length && left.every((item, index) => item === other[index]);
}

/**
 * Ảnh · bảng size · video.
 *
 * 🔴 **Ảnh gửi theo CẢ BỘ hoặc không gửi.** `main_images` của TikTok thay toàn bộ danh sách,
 * nên thêm / xoá / đổi thứ tự đều là cùng một phép: so mảng `uri` mới với mảng hiện tại, khác
 * thì gửi trọn bộ, giống thì không gửi gì. Gửi "phần thêm" là xoá mất phần còn lại.
 *
 * 🔴 **Bộ ảnh rỗng KHÔNG được gửi.** Sản phẩm TikTok bắt buộc có ảnh; gửi mảng rỗng là một
 * request chắc chắn bị từ chối, mà lại bị từ chối SAU khi đã upload xong mọi thứ.
 *
 * 🔴 **Gỡ bảng size / gỡ video: KHÔNG gửi.** `partial_edit` không có cách nào diễn đạt "xoá
 * trường này" cho hai trường đó — gửi `{}` hay chuỗi rỗng đều là đoán. Ở đây bỏ qua, và giao
 * diện nói thẳng là chưa gỡ được, thay vì báo lưu thành công rồi bảng size vẫn còn nguyên.
 */
function buildMedia(
  input: ProductEditInput,
  snapshot: ProductSnapshot,
): {
  mainImages?: Array<{ uri?: string }>;
  sizeChart?: { image?: { uri?: string }; template?: { id?: string } };
  video?: { id?: string };
} {
  const result: ReturnType<typeof buildMedia> = {};

  if (input.mainImageUris !== undefined) {
    const next = input.mainImageUris.filter((uri) => uri.trim() !== '');
    if (next.length > 0 && !sameList(next, snapshot.mainImageUris)) {
      result.mainImages = next.map((uri) => ({ uri }));
    }
  }

  if (input.sizeChart) {
    if (input.sizeChart.uri && !sameText(input.sizeChart.uri, snapshot.sizeChartUri)) {
      result.sizeChart = { image: { uri: input.sizeChart.uri } };
    } else if (
      input.sizeChart.templateId &&
      !sameText(input.sizeChart.templateId, snapshot.sizeChartTemplateId)
    ) {
      result.sizeChart = { template: { id: input.sizeChart.templateId } };
    }
  }

  if (input.videoId !== undefined && !sameText(input.videoId, snapshot.videoId)) {
    if (input.videoId.trim()) result.video = { id: input.videoId.trim() };
  }

  return result;
}

export function buildPartialEditPayload(
  input: ProductEditInput,
  snapshot: ProductSnapshot,
): PartialEditPlan {
  const body: TiktokPartialEditProductRequest = {};
  const changedFields: string[] = [];

  if (input.title !== undefined && !sameText(input.title, snapshot.title)) {
    body.title = input.title.trim();
    changedFields.push('title');
  }

  if (input.description !== undefined && !sameText(input.description, snapshot.description)) {
    body.description = input.description;
    changedFields.push('description');
  }

  if (input.brandId !== undefined && !sameText(input.brandId, snapshot.tiktokBrandId)) {
    body.brandId = input.brandId;
    changedFields.push('brand');
  }

  // Get Product CÓ trả `search_terms` và `key_product_features`, và từ lượt đồng bộ này ta
  // đã lưu lại — nên hai ô này so được như mọi trường khác, không phải "cứ gửi là gửi".
  if (input.searchTerms !== undefined) {
    const next = input.searchTerms.filter((term) => term.trim() !== '');
    if (!sameList(next, snapshot.searchTerms)) {
      body.searchTerms = next;
      changedFields.push('searchTerms');
    }
  }
  if (input.highlights !== undefined) {
    const next = input.highlights.filter((line) => line.trim() !== '');
    if (!sameList(next, snapshot.keyProductFeatures)) {
      body.keyProductFeatures = next;
      changedFields.push('highlights');
    }
  }

  const media = buildMedia(input, snapshot);
  if (media.mainImages) {
    body.mainImages = media.mainImages;
    changedFields.push('mainImages');
  }
  if (media.sizeChart) {
    body.sizeChart = media.sizeChart;
    changedFields.push('sizeChart');
  }
  if (media.video) {
    body.video = media.video;
    changedFields.push('video');
  }

  const pkg = buildPackage(input.package, snapshot);
  if (pkg.weight) {
    body.packageWeight = pkg.weight;
    changedFields.push('packageWeight');
  }
  if (pkg.dimensions) {
    body.packageDimensions = pkg.dimensions;
    changedFields.push('packageDimensions');
  }

  const skus = buildSkus(input.skus, snapshot);
  if (skus.length > 0) body.skus = skus;

  return {
    body,
    changedFields,
    changedSkus: skus.length,
    isEmpty: changedFields.length === 0 && skus.length === 0,
  };
}

/**
 * Kiện hàng.
 *
 * 🔴 TikTok nhận `package_dimensions` như MỘT CỤM: thiếu một chiều là request không hợp lệ.
 * Nên chỉ gửi khi đủ cả ba chiều, và chỉ khi có ít nhất một chiều thực sự đổi.
 */
function buildPackage(
  input: ProductEditInput['package'],
  snapshot: ProductSnapshot,
): {
  weight?: { value: string; unit?: string };
  dimensions?: { length: string; width: string; height: string; unit?: string };
} {
  if (!input) return {};
  const result: ReturnType<typeof buildPackage> = {};

  const weightChanged =
    (input.weight !== undefined && !sameAmount(input.weight, snapshot.packageWeight)) ||
    (input.weightUnit !== undefined && !sameText(input.weightUnit, snapshot.weightUnit));
  if (weightChanged) {
    const value = input.weight ?? snapshot.packageWeight ?? '';
    if (value.trim()) {
      result.weight = { value: value.trim(), unit: input.weightUnit ?? snapshot.weightUnit ?? undefined };
    }
  }

  const length = input.length ?? snapshot.packageLength ?? '';
  const width = input.width ?? snapshot.packageWidth ?? '';
  const height = input.height ?? snapshot.packageHeight ?? '';
  const dimensionChanged =
    (input.length !== undefined && !sameAmount(input.length, snapshot.packageLength)) ||
    (input.width !== undefined && !sameAmount(input.width, snapshot.packageWidth)) ||
    (input.height !== undefined && !sameAmount(input.height, snapshot.packageHeight)) ||
    (input.dimensionUnit !== undefined && !sameText(input.dimensionUnit, snapshot.dimensionUnit));

  if (dimensionChanged && length.trim() && width.trim() && height.trim()) {
    result.dimensions = {
      length: length.trim(),
      width: width.trim(),
      height: height.trim(),
      unit: input.dimensionUnit ?? snapshot.dimensionUnit ?? undefined,
    };
  }

  return result;
}

/**
 * Chỉ những SKU CÓ thay đổi, mỗi SKU chỉ kèm trường của chính nó đã đổi.
 *
 * 🔴 SKU không có trong ảnh chụp bị BỎ QUA hoàn toàn: gửi một `tiktokSkuId` lạ lên có thể
 * khiến TikTok tạo thêm SKU, và đó là một biến thể ma trên sản phẩm đang bán.
 */
function buildSkus(
  inputs: ProductEditSkuInput[] | undefined,
  snapshot: ProductSnapshot,
): TiktokPartialEditSku[] {
  if (!inputs?.length) return [];

  const current = new Map(snapshot.variants.map((variant) => [variant.tiktokSkuId, variant]));
  const result: TiktokPartialEditSku[] = [];

  for (const input of inputs) {
    const existing = current.get(input.tiktokSkuId);
    if (!existing) continue;

    const sku: TiktokPartialEditSku = { id: input.tiktokSkuId };
    let touched = false;

    if (input.sellerSku !== undefined && !sameText(input.sellerSku, existing.sellerSku)) {
      sku.sellerSku = input.sellerSku.trim();
      touched = true;
    }

    if (input.salePrice !== undefined && !sameAmount(input.salePrice, existing.salePrice)) {
      sku.price = { amount: input.salePrice.trim(), currency: existing.currency ?? undefined };
      touched = true;
    }

    if (input.listPrice !== undefined && !sameAmount(input.listPrice, existing.listPrice)) {
      sku.listPrice = { amount: input.listPrice.trim(), currency: existing.currency ?? undefined };
      touched = true;
    }

    // Tồn kho cần biết KHO nào. Không có kho thì bỏ phần này chứ không đoán — đoán sai là
    // cộng tồn vào một kho không bán hàng ở thị trường đó.
    if (
      input.quantity !== undefined &&
      input.quantity !== existing.inventoryTotal &&
      input.warehouseId
    ) {
      sku.inventory = [{ warehouseId: input.warehouseId, quantity: input.quantity }];
      touched = true;
    }

    if (touched) result.push(sku);
  }

  return result;
}
