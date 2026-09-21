import type {
  PodCategoryTemplate,
  PodImageTemplate,
  PodSkuTemplate,
  PodSkuTemplateItem,
} from '@/features/pod-listing/types';
import { combinationKey, suggestSellerSku, type SkuBuildOptions } from './manual-sku';
import type { ManualSku, ManualVariation, SessionImageInput } from './types';

/**
 * Chuyển **template có sẵn** thành dữ liệu của form Custom Listing.
 *
 * 🔴 Hàm THUẦN, tách khỏi component: đây là chỗ quyết định "bấm Áp dụng thì những ô nào
 * thay đổi". Viết thẳng trong component thì không kiểm được bằng test, mà sai ở đây nghĩa là
 * người dùng bấm một nút rồi mất dữ liệu họ vừa gõ — kiểu lỗi không có thông báo nào.
 *
 * 🔴 Nguyên tắc chung cho mọi hàm ở đây: **chỉ trả về những trường template THỰC SỰ có**.
 * Template không khai kho thì không được trả `warehouseId: null` — `null` sẽ xoá giá trị
 * người dùng đã chọn, còn `undefined` thì nơi gọi biết là "không đụng tới".
 */

/** Phần form mà Category Template điền được. Trường vắng mặt = template không khai. */
export interface CategoryTemplatePatch {
  market?: PodCategoryTemplate['market'];
  categoryTiktokId?: string;
  categoryName?: string | null;
  categoryPath?: string | null;
  brandId?: string;
  warehouseId?: string;
  package?: {
    weight?: string;
    weightUnit?: string;
    length?: string;
    width?: string;
    height?: string;
    dimensionUnit?: string;
  };
  sizeChartFileId?: string;
  videoFileId?: string;
  /**
   * Giá trị thuộc tính danh mục mà template đã điền, khoá theo `tiktokAttributeId`.
   *
   * 🔴 Phải đi kèm danh mục: form gửi bộ thuộc tính nhập tay là THAY TOÀN BỘ bộ của template
   * (`applyManualOverride`), nên áp mẫu mà không mang giá trị thuộc tính sang là đăng lên sàn
   * một danh mục với thuộc tính bắt buộc bỏ trống — trong khi template đã điền sẵn.
   */
  attributeValues?: Record<string, { valueIds: string[]; customValues: string[] }>;
}

/**
 * Category Template → form.
 *
 * Điền market, danh mục, thương hiệu, kho, đóng gói, và cả bảng size / video nếu template có
 * (`PodCategoryTemplate` đã mang sẵn `sizeChartFileId` + `videoFileId`).
 *
 * 🔴 `brandMode === 'NONE'` nghĩa là người dựng template CỐ Ý chọn "No brand" — khác hẳn
 * "chưa khai". Trả về chuỗi rỗng để form hiểu là No brand, không phải bỏ qua.
 */
export function applyCategoryTemplate(template: PodCategoryTemplate): CategoryTemplatePatch {
  const patch: CategoryTemplatePatch = {
    market: template.market,
    categoryTiktokId: template.tiktokCategoryId,
    categoryName: template.categoryName,
    categoryPath: template.categoryPath,
  };

  if (template.brandMode === 'NONE') patch.brandId = '';
  else if (template.tiktokBrandId) patch.brandId = template.tiktokBrandId;

  if (template.warehouseId) patch.warehouseId = template.warehouseId;
  if (template.sizeChartFileId) patch.sizeChartFileId = template.sizeChartFileId;
  if (template.videoFileId) patch.videoFileId = template.videoFileId;

  const pkg: NonNullable<CategoryTemplatePatch['package']> = {};
  if (template.packageWeight) pkg.weight = template.packageWeight;
  if (template.weightUnit) pkg.weightUnit = template.weightUnit;
  if (template.packageLength) pkg.length = template.packageLength;
  if (template.packageWidth) pkg.width = template.packageWidth;
  if (template.packageHeight) pkg.height = template.packageHeight;
  if (template.dimensionUnit) pkg.dimensionUnit = template.dimensionUnit;
  if (Object.keys(pkg).length > 0) patch.package = pkg;

  const attributes = (template.attributes ?? []).filter(
    (attribute) => attribute.values.length > 0 || attribute.customValues.length > 0,
  );
  if (attributes.length > 0) {
    patch.attributeValues = Object.fromEntries(
      attributes.map((attribute) => [
        attribute.tiktokAttributeId,
        {
          valueIds: attribute.values.map((value) => value.tiktokValueId),
          customValues: attribute.customValues.map((custom) => custom.value),
        },
      ]),
    );
  }

  return patch;
}

/**
 * Dữ liệu SKU Template dùng làm NGUỒN cho bảng SKU của form: tiền tố / hậu tố mã và hàm tra
 * dữ liệu của một tổ hợp (Seller SKU · giá bán · giá gạch · tồn · ảnh · barcode).
 *
 * 🔴 Tra theo **khoá tổ hợp** (`Color=Black|Size=S`) dựng từ bảng nối `items[].values` của
 * template — không theo chỉ số dòng, không tách chuỗi `variantName`: template đổi thứ tự trục
 * hay đổi thứ tự SKU thì giá vẫn về đúng tổ hợp. Chỉ khi bản ghi cũ không có bảng nối mới
 * rơi về tách `variantName` theo thứ tự trục.
 *
 * 🔴 Ưu tiên **giá trị của TỪNG SKU** (giá hiệu lực server đã tính, tồn, mã) rồi mới tới
 * **giá trị mặc định** của template (`defaultSalePrice` / `defaultRetailPrice` /
 * `defaultQuantity`) — đúng thứ tự engine dùng lúc đăng (`resolveVariants`).
 */
export function skuTemplateSeed(template: PodSkuTemplate): SkuBuildOptions {
  const axisNames = [...template.variants]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((variant) => variant.name.trim())
    .filter(Boolean);

  const byKey = new Map<string, Partial<ManualSku>>();
  for (const item of template.items ?? []) {
    // Tổ hợp tắt trong template = người dựng cố ý không bán ⇒ không có dữ liệu để mang sang.
    if (item.isActive === false) continue;
    const optionValues = itemOptionValues(item, axisNames);
    if (optionValues.length === 0) continue;
    const key = combinationKey(optionValues);
    if (!byKey.has(key)) byKey.set(key, itemToSkuData(item, template));
  }

  const fallback: Partial<ManualSku> = {
    ...defaultPrices(template),
    quantity: template.defaultQuantity,
  };

  return {
    skuPrefix: template.skuPrefix,
    skuSuffix: template.skuSuffix,
    seed: (optionValues) => byKey.get(combinationKey(optionValues)) ?? fallback,
  };
}

/**
 * SKU Template → trục biến thể + bảng SKU.
 *
 * Trục lấy từ `variants` (đúng thứ tự người dựng). Bảng SKU = **đúng các tổ hợp template đã
 * sinh và đang bật** (`items`), mỗi dòng mang Seller SKU / giá bán / giá gạch / tồn / ảnh của
 * chính tổ hợp đó — không sinh lại từ trục, không chỉ chép tên giá trị.
 *
 * 🔴 Tổ hợp mà template đã sinh nhưng giá trị không còn trên trục (template đang "cũ" — trục
 * đã sửa sau lần Tạo SKU) thì bị bỏ: form không được có dòng SKU không tồn tại trong bộ trục.
 *
 * Template chưa sinh tổ hợp nào ⇒ chỉ trả trục; người dùng bấm "Tạo SKU" (có cảnh báo khi
 * tổ hợp quá lớn) và dòng mới sẽ lấy giá trị mặc định của template qua `skuTemplateSeed`.
 */
export function applySkuTemplate(template: PodSkuTemplate): {
  variations: ManualVariation[];
  skus: ManualSku[];
} {
  const variations: ManualVariation[] = [...template.variants]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((variant) => ({
      name: variant.name.trim(),
      values: [...variant.values]
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((value) => value.value.trim())
        .filter((value) => value !== ''),
    }))
    .filter((variation) => variation.name !== '' && variation.values.length > 0);

  const items = (template.items ?? []).filter((item) => item.isActive !== false);
  if (items.length === 0) return { variations, skus: [] };

  const axisNames = variations.map((variation) => variation.name);
  const axisValues = new Map(variations.map((variation) => [variation.name, new Set(variation.values)]));
  const options = skuTemplateSeed(template);
  const seen = new Set<string>();
  const skus: ManualSku[] = [];

  for (const item of items) {
    const optionValues = itemOptionValues(item, axisNames);
    // Đủ trục và mọi giá trị còn trên trục — không thì đó là dòng mồ côi.
    const complete =
      optionValues.length === axisNames.length &&
      optionValues.every((option) => axisValues.get(option.name)?.has(option.value));
    if (!complete) continue;
    const key = combinationKey(optionValues);
    if (seen.has(key)) continue;
    seen.add(key);

    const data = itemToSkuData(item, template);
    skus.push({
      sellerSku: data.sellerSku?.trim() || suggestSellerSku(optionValues, options),
      optionValues,
      salePrice: data.salePrice ?? '',
      retailPrice: data.retailPrice ?? '',
      quantity: data.quantity ?? 0,
      ...(data.imageFileId ? { imageFileId: data.imageFileId } : {}),
      ...(data.barcode ? { barcode: data.barcode } : {}),
    });
  }

  // Sắp theo thứ tự trục / giá trị (tích Descartes) — bảng hiển thị theo bộ trục, không theo
  // thứ tự dòng của template (có thể đã bị xáo bởi Bulk Update / import).
  const position = (option: { name: string; value: string }) =>
    variations.find((variation) => variation.name === option.name)?.values.indexOf(option.value) ?? 0;
  skus.sort((left, right) => {
    for (let index = 0; index < axisNames.length; index += 1) {
      const diff = position(left.optionValues[index]) - position(right.optionValues[index]);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  return { variations, skus };
}

/**
 * Trục / giá trị của một tổ hợp template, theo đúng thứ tự trục.
 *
 * Nguồn 1 — bảng nối `values[]` (`variantValue.variant.name` + `variantValue.value`): chính
 * xác tuyệt đối. Nguồn 2 — tách `variantName` ("Black / S") theo thứ tự trục: chỉ cho bản ghi
 * cũ không có bảng nối.
 */
function itemOptionValues(
  item: PodSkuTemplateItem,
  axisNames: string[],
): ManualSku['optionValues'] {
  const links = (item.values ?? [])
    .map((link) => ({
      name: link.variantValue.variant.name.trim(),
      value: link.variantValue.value.trim(),
    }))
    .filter((option) => option.name !== '' && option.value !== '');

  if (links.length > 0) {
    const byAxis = new Map(links.map((option) => [option.name, option.value]));
    return axisNames
      .filter((name) => byAxis.has(name))
      .map((name) => ({ name, value: byAxis.get(name) as string }));
  }

  return item.variantName
    .split('/')
    .map((part) => part.trim())
    .map((value, index) => ({ name: axisNames[index] ?? `Option ${index + 1}`, value }))
    .filter((option) => option.value !== '');
}

/**
 * Dữ liệu SKU-level của một tổ hợp, đã rơi về mặc định template ở trường trống.
 *
 * Giá: `effectiveSalePrice` / `effectiveRetailPrice` là con số SERVER tính bằng đúng hàm
 * engine dùng (`resolveSkuItemPrice`: giá bán khai tường minh → giá gốc trừ % → giá gốc) —
 * dùng nó thay vì tự tính lại ở frontend. Không có (bản ghi từ API list cũ) thì đọc trường
 * thô. Vẫn trống ⇒ mặc định template. Tồn: `quantity` của tổ hợp, `0` (chưa đặt) ⇒ mặc định.
 */
function itemToSkuData(item: PodSkuTemplateItem, template: PodSkuTemplate): Partial<ManualSku> {
  const hasEffective = item.effectiveSalePrice !== undefined;
  let salePrice = hasEffective ? item.effectiveSalePrice : item.salePrice;
  let retailPrice = hasEffective ? item.effectiveRetailPrice : item.retailPrice;
  if (!usable(salePrice)) {
    const defaults = defaultPrices(template);
    salePrice = defaults.salePrice;
    retailPrice = defaults.retailPrice;
  }

  return {
    sellerSku: item.skuCode?.trim() || undefined,
    salePrice: salePrice ?? '',
    retailPrice: usable(retailPrice) ? (retailPrice as string) : '',
    quantity: item.quantity > 0 ? item.quantity : template.defaultQuantity,
    ...(item.imageFileId ? { imageFileId: item.imageFileId } : {}),
    ...(item.barcode ? { barcode: item.barcode } : {}),
  };
}

/**
 * Giá mặc định của template — cùng luật engine dùng khi tổ hợp không tự khai giá
 * (`resolveVariants`: giá bán ← `defaultSalePrice`, giá gạch ← `defaultRetailPrice`). Chỉ có
 * giá gốc ⇒ bán đúng giá gốc, không gạch ngang.
 */
function defaultPrices(template: PodSkuTemplate): { salePrice: string; retailPrice: string } {
  const sale = usable(template.defaultSalePrice) ? (template.defaultSalePrice as string) : '';
  const retail = usable(template.defaultRetailPrice) ? (template.defaultRetailPrice as string) : '';
  if (sale) return { salePrice: sale, retailPrice: retail && Number(retail) > Number(sale) ? retail : '' };
  return { salePrice: retail, retailPrice: '' };
}

function usable(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== '' && Number(value) > 0;
}

/**
 * Image Template → danh sách ảnh của form.
 *
 * Giữ NGUYÊN thứ tự `sortOrder` của bộ mẫu — tấm đầu tiên là ảnh chính, đúng quy ước TikTok
 * và đúng thứ người dựng bộ ảnh đã sắp.
 *
 * 🔴 Bỏ qua mục không có URL xem được: render một thẻ `img` chắc chắn hỏng chỉ làm người dùng
 * tưởng bộ ảnh bị lỗi, trong khi thứ họ cần là biết tấm nào thiếu.
 */
export function applyImageTemplate(template: PodImageTemplate): {
  images: SessionImageInput[];
  /** Số mục bị bỏ vì không có ảnh dùng được — form cảnh báo bằng con số này. */
  skipped: number;
} {
  const items = [...(template.items ?? [])].sort(
    (left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0),
  );

  const images: SessionImageInput[] = [];
  let skipped = 0;

  for (const item of items) {
    // 🔴 Tấm SIZE_CHART của bộ mẫu KHÔNG phải ảnh sản phẩm: TikTok nhận bảng size ở trường
    // riêng (use case SIZE_CHART_IMAGE). Backend tự lấy nó làm bảng size dự phòng khi form
    // không chọn tấm nào; dán vào bộ ảnh là bảng số đo hiện giữa gallery bán hàng.
    if (item.assetType === 'SIZE_CHART') continue;
    const url = item.imageUrl ?? '';
    if (!url) {
      skipped += 1;
      continue;
    }
    images.push({
      imageUrl: url,
      fileId: item.fileId || undefined,
      imageType: 'MAIN',
      fileName: item.title || undefined,
    });
  }

  return { images, skipped };
}

/**
 * Category Template có còn hợp với market đang chọn không.
 *
 * 🔴 Cảnh báo chứ KHÔNG tự đổi market của người dùng: cây danh mục, thương hiệu và kho của
 * TikTok khác nhau theo thị trường, nên một template US áp vào lượt đăng UK là dữ liệu sai —
 * nhưng quyết định sửa cái nào là của người dùng, không phải của form.
 */
export function isTemplateMarketMismatch(
  templateMarket: string,
  selectedMarket: string,
): boolean {
  return templateMarket !== selectedMarket;
}
