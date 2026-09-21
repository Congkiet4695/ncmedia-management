import type {
  PodCategoryTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '@/features/pod-listing/types';
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
 * SKU Template → trục biến thể + bảng SKU.
 *
 * 🔴 Ưu tiên `items` (tổ hợp template đã SINH và người dựng đã điền giá) hơn là sinh lại từ
 * `variants`: template thường có bảng giá khai tay cho từng tổ hợp, sinh lại sẽ vứt hết.
 * Chỉ khi template chưa sinh tổ hợp nào thì mới trả trục để form tự sinh.
 *
 * `effectiveSalePrice` là con số SERVER sẽ gửi TikTok (đã tính cả quy tắc lệch giá), nên nó
 * mới là giá đúng để điền vào ô — không phải `salePrice` thô.
 */
export function applySkuTemplate(template: PodSkuTemplate): {
  variations: ManualVariation[];
  skus: ManualSku[];
} {
  const variations: ManualVariation[] = [...template.variants]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((variant) => ({
      name: variant.name,
      values: [...variant.values]
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((value) => value.value)
        .filter((value) => value.trim() !== ''),
    }))
    .filter((variation) => variation.name.trim() !== '' && variation.values.length > 0);

  const items = template.items ?? [];
  if (items.length === 0) return { variations, skus: [] };

  const axisNames = variations.map((variation) => variation.name);

  const skus: ManualSku[] = items.map((item) => {
    // `variantName` của template là "Black / S" — tách ngược theo đúng thứ tự trục.
    const parts = item.variantName.split('/').map((part) => part.trim());
    const optionValues = parts
      .map((value, index) => ({ name: axisNames[index] ?? `Option ${index + 1}`, value }))
      .filter((option) => option.value !== '');

    return {
      sellerSku: item.skuCode ?? item.variantName.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase(),
      optionValues,
      salePrice: item.effectiveSalePrice ?? item.salePrice ?? '',
      retailPrice: item.retailPrice ?? '',
      quantity: item.quantity,
      ...(item.barcode ? { barcode: item.barcode } : {}),
    };
  });

  return { variations, skus };
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
