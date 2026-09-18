import type { AttributeSelection } from '@/features/pod-listing/components/attribute-value-picker';
import type { PodCategoryAttributeDef, PodListingMarket } from '@/features/pod-listing/types';
import type {
  CreateCustomListingPayload,
  ManualAttribute,
  ManualListingData,
  ManualSku,
  ManualVariation,
  ManualVideo,
  PodListingSessionDetail,
  PodSessionProduct,
  PodSessionTemplateSelection,
  SessionImageInput,
  SessionImagePayload,
  UpdateCustomListingPayload,
} from './types';

/**
 * Trạng thái form **Add / Edit Custom Listing** và hai phép biến đổi quanh nó:
 *
 * ```
 *   Session + Draft Product (API)  ──restoreCustomListingForm──▶  CustomListingForm
 *   CustomListingForm              ──buildCustomListingPayload──▶  POST /custom · PATCH /:id/custom
 * ```
 *
 * 🔴 Tách khỏi component vì đây là chỗ quyết định "nháp lưu gì" và "mở lại thấy gì". Hai
 * hàm này phải là NGHỊCH ĐẢO của nhau — lưu rồi mở lại phải ra đúng form đã nhập — và điều
 * đó chỉ kiểm được bằng test khi chúng là hàm thuần (`scripts/verify-custom-listing.ts`).
 *
 * 🔴 Danh mục khoá theo `tiktokCategoryId` (ĐÚNG thứ database lưu trong `manualData.category`),
 * KHÔNG phải UUID nội bộ của `pod_product_categories`: cây danh mục ~10.000 nút lá mà API
 * chỉ trả 500 mỗi lần, nên "tra ngược danh sách đang tải để tìm danh mục đã chọn" là cách
 * chắc chắn để mất danh mục ngay khi ô tìm kiếm được dọn — đúng lỗi "chọn Poster xong hệ
 * thống vẫn bảo chưa chọn danh mục".
 */

/** Trần TikTok cho từ khoá tìm kiếm — cùng số với `MANUAL_SEARCH_TERMS_MAX` phía backend. */
export const SEARCH_TERMS_MAX = 15;

export interface CustomListingCategory {
  /** `category_id` của TikTok. Rỗng = chưa chọn. */
  id: string;
  name: string;
  path: string;
}

export interface CustomListingBrand {
  /** `brand_id` của TikTok. Rỗng = No brand. */
  id: string;
  name: string;
}

export interface CustomListingPackage {
  weight: string;
  weightUnit: string;
  length: string;
  width: string;
  height: string;
  dimensionUnit: string;
}

/** Mẫu đang CHỌN ở từng khu vực — lưu vào lượt đăng làm nguồn cho phần không nhập tay. */
export interface CustomListingTemplates {
  category: string;
  description: string;
  sku: string;
  image: string;
}

export interface CustomListingForm {
  market: PodListingMarket;
  shopIds: string[];
  title: string;
  /** Từ khoá cách nhau bằng dấu phẩy — đúng cách ô Sửa sản phẩm đang nhập. */
  searchTerms: string;
  /** Mỗi dòng một ý. */
  highlights: string;
  category: CustomListingCategory;
  attributeValues: Record<string, AttributeSelection>;
  brand: CustomListingBrand;
  description: string;
  pkg: CustomListingPackage;
  images: SessionImageInput[];
  sizeChart: SessionImageInput | null;
  video: ManualVideo | null;
  variations: ManualVariation[];
  skus: ManualSku[];
  warehouseId: string;
  templates: CustomListingTemplates;
}

export function emptyCustomListingForm(): CustomListingForm {
  return {
    market: 'US',
    shopIds: [],
    title: '',
    searchTerms: '',
    highlights: '',
    category: { id: '', name: '', path: '' },
    attributeValues: {},
    brand: { id: '', name: '' },
    description: '',
    pkg: {
      weight: '',
      weightUnit: 'GRAM',
      length: '',
      width: '',
      height: '',
      dimensionUnit: 'CENTIMETER',
    },
    images: [],
    sizeChart: null,
    video: null,
    variations: [],
    skus: [],
    warehouseId: '',
    templates: { category: '', description: '', sku: '', image: '' },
  };
}

/** Bảng size và ảnh trong mô tả KHÔNG thuộc bộ ảnh sản phẩm. */
const GALLERY_IMAGE_TYPES = new Set<SessionImageInput['imageType']>(['MAIN', 'VARIANT']);

/**
 * Session + Draft Product ⇒ form. Nghịch đảo của `buildCustomListingPayload`.
 *
 * Mọi giá trị lấy từ CHÍNH dữ liệu đã lưu (tên danh mục, tên brand, tên file…), không tra
 * ngược danh sách nào — nên form hiện đúng ngay cả khi danh mục/brand không nằm trong trang
 * dữ liệu đang tải.
 */
export function restoreCustomListingForm(
  session: PodListingSessionDetail,
  product: PodSessionProduct | null,
): CustomListingForm {
  const form = emptyCustomListingForm();
  const manual = product?.manualData ?? null;

  form.market = session.market;
  form.shopIds = session.shops.map((link) => link.shopId);
  form.templates = {
    category: pickTemplate(session, 'categoryTemplateId'),
    description: pickTemplate(session, 'descriptionTemplateId'),
    sku: pickTemplate(session, 'skuTemplateId'),
    image: pickTemplate(session, 'imageTemplateId'),
  };

  if (!product) return form;

  form.title = product.title;
  form.searchTerms = (manual?.searchTerms ?? []).join(', ');
  form.highlights = (manual?.highlights ?? []).join('\n');
  form.description = manual?.description ?? '';
  form.warehouseId = manual?.warehouseId ?? '';

  if (manual?.category?.tiktokCategoryId) {
    form.category = {
      id: manual.category.tiktokCategoryId,
      name: manual.category.name ?? '',
      path: manual.category.path ?? '',
    };
  }
  if (manual?.brand) {
    form.brand = { id: manual.brand.tiktokBrandId ?? '', name: manual.brand.name ?? '' };
  }
  form.attributeValues = Object.fromEntries(
    (manual?.attributes ?? []).map((attribute) => [
      attribute.tiktokAttributeId,
      {
        valueIds: (attribute.values ?? [])
          .map((value) => value.id)
          .filter((id): id is string => Boolean(id)),
        customValues: attribute.customValues ?? [],
      },
    ]),
  );
  if (manual?.package) {
    form.pkg = {
      weight: manual.package.weight ?? '',
      weightUnit: manual.package.weightUnit ?? form.pkg.weightUnit,
      length: manual.package.length ?? '',
      width: manual.package.width ?? '',
      height: manual.package.height ?? '',
      dimensionUnit: manual.package.dimensionUnit ?? form.pkg.dimensionUnit,
    };
  }

  // Ảnh: bộ ảnh sản phẩm theo đúng `sortOrder` đã lưu (tấm đầu là ảnh chính); bảng size là
  // tấm ĐẦU TIÊN mang `SIZE_CHART` — TikTok chỉ nhận một.
  const images = [...product.images].sort((left, right) => left.sortOrder - right.sortOrder);
  form.images = images
    .filter((image) => GALLERY_IMAGE_TYPES.has(image.imageType))
    .map((image) => ({
      imageUrl: image.imageUrl,
      fileId: image.fileId ?? undefined,
      imageType: image.imageType,
    }));
  const chart = images.find((image) => image.imageType === 'SIZE_CHART');
  form.sizeChart = chart
    ? { imageUrl: chart.imageUrl, fileId: chart.fileId ?? undefined, imageType: 'SIZE_CHART' }
    : null;

  form.video = manual?.video?.fileId
    ? { fileId: manual.video.fileId, fileName: manual.video.fileName ?? null }
    : null;
  form.variations = manual?.variations ?? [];
  form.skus = manual?.skus ?? [];

  return form;
}

/** Định nghĩa thuộc tính của danh mục đang chọn — có thể CHƯA nạp xong lúc người dùng bấm Lưu. */
export interface AttributeSource {
  /** `undefined` = chưa nạp ⇒ dùng `fallback` (bộ đã lưu trong nháp) để không mất dữ liệu. */
  definitions?: PodCategoryAttributeDef[];
  fallback?: ManualAttribute[];
}

/**
 * Form ⇒ payload tạo mới. `buildUpdateCustomListingPayload` dùng lại đúng phần ruột này.
 *
 * 🔴 Gửi lên TRỌN trạng thái của form, kể cả mẫu đang chọn: mẫu là NGUỒN cho phần người dùng
 * không nhập tay (backend rơi về template khi trường vắng mặt), còn phần đã nhập tay thắng
 * template — xem `applyManualOverride`. Nhờ vậy ba chế độ (mẫu · nhập tay · kết hợp) cùng
 * đi qua một đường.
 */
export function buildCustomListingPayload(
  form: CustomListingForm,
  attributes: AttributeSource = {},
): CreateCustomListingPayload {
  return {
    market: form.market,
    shopIds: form.shopIds,
    templates: buildTemplates(form.templates),
    product: {
      title: form.title.trim(),
      images: buildImages(form),
      manualData: buildManualData(form, attributes),
    },
  };
}

export function buildUpdateCustomListingPayload(
  form: CustomListingForm,
  attributes: AttributeSource = {},
): UpdateCustomListingPayload {
  const payload = buildCustomListingPayload(form, attributes);
  return {
    market: payload.market,
    shopIds: payload.shopIds,
    templates: payload.templates,
    product: payload.product,
  };
}

/** Mẫu chọn ở form ⇒ bộ template của lượt đăng. Ô trống = gỡ template loại đó. */
function buildTemplates(templates: CustomListingTemplates): PodSessionTemplateSelection {
  return {
    categoryTemplateId: templates.category || null,
    descriptionTemplateId: templates.description || null,
    skuTemplateId: templates.sku || null,
    imageTemplateId: templates.image || null,
  };
}

/**
 * Bảng size đi CHUNG mảng `images` nhưng mang `imageType = SIZE_CHART`; resolver tách nó ra
 * khỏi bộ ảnh sản phẩm và gửi vào `size_chart` của TikTok. `fileId` phải đi kèm — mất nó là
 * mở lại nháp không còn liên kết với file đã tải lên.
 */
function buildImages(form: CustomListingForm): SessionImagePayload[] {
  return [...form.images, ...(form.sizeChart ? [form.sizeChart] : [])].map((image, index) => ({
    imageUrl: image.imageUrl,
    imageType: image.imageType,
    fileId: image.fileId,
    sortOrder: index,
  }));
}

/**
 * Dữ liệu nhập tay — chỉ gồm khu vực người dùng THỰC SỰ điền; khu vực trống thì bỏ trường để
 * backend rơi về template của lượt (nếu có).
 *
 * Danh mục đã chọn ⇒ gửi kèm brand + bộ thuộc tính ĐANG HIỆN trên form (kể cả rỗng): thứ
 * người dùng nhìn thấy là thứ được đăng. Không gửi thuộc tính nghĩa là bộ của Category
 * Template (nếu có) âm thầm đi lên sàn trong khi form hiện một bộ khác.
 */
export function buildManualData(
  form: CustomListingForm,
  attributes: AttributeSource = {},
): ManualListingData {
  const searchTerms = splitList(form.searchTerms, ',').slice(0, SEARCH_TERMS_MAX);
  const highlights = splitList(form.highlights, '\n');

  return {
    ...(form.description.trim() ? { description: form.description } : {}),
    ...(searchTerms.length > 0 ? { searchTerms } : {}),
    ...(highlights.length > 0 ? { highlights } : {}),
    ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
    ...(form.category.id
      ? {
          category: {
            tiktokCategoryId: form.category.id,
            name: form.category.name || null,
            path: form.category.path || null,
          },
          brand: { tiktokBrandId: form.brand.id || null, name: form.brand.name || null },
          attributes: buildAttributes(form.attributeValues, attributes),
        }
      : {}),
    ...(form.pkg.weight.trim() ? { package: form.pkg } : {}),
    ...(form.video?.fileId ? { video: { fileId: form.video.fileId, fileName: form.video.fileName } } : {}),
    ...(form.skus.length > 0 || form.variations.length > 0
      ? { variations: normalizeVariations(form.variations), skus: form.skus }
      : {}),
  };
}

/**
 * Bộ thuộc tính gửi lên, khoá theo định nghĩa của DANH MỤC ĐANG CHỌN.
 *
 * 🔴 Chỉ thuộc tính có trong định nghĩa hiện tại mới được gửi — đổi danh mục A → B thì giá
 * trị của A không lọt sang B. Định nghĩa chưa nạp (người dùng Lưu ngay khi vừa mở nháp) thì
 * giữ nguyên bộ đã lưu, không được gửi `[]` rồi xoá sạch thuộc tính của họ.
 */
function buildAttributes(
  values: Record<string, AttributeSelection>,
  source: AttributeSource,
): ManualAttribute[] {
  if (source.definitions) {
    return source.definitions.map((attribute) => {
      const entry = values[attribute.tiktokAttributeId] ?? { valueIds: [], customValues: [] };
      return {
        tiktokAttributeId: attribute.tiktokAttributeId,
        name: attribute.name ?? undefined,
        type: attribute.type ?? undefined,
        isRequired: attribute.isRequired,
        values: entry.valueIds.map((id) => ({
          id,
          name: attribute.values?.find((value) => value.id === id)?.name,
        })),
        customValues: entry.customValues,
      };
    });
  }
  return (source.fallback ?? []).filter((attribute) => attribute.tiktokAttributeId in values);
}

/**
 * Giữ lại những giá trị thuộc tính còn hợp lệ với danh mục MỚI.
 *
 * Thuộc tính cùng `tiktokAttributeId` ở danh mục mới ⇒ giữ (giá trị chính thức chỉ giữ khi
 * danh mục mới vẫn có `value_id` đó; giá trị tự nhập giữ khi thuộc tính cho phép). Phần còn
 * lại bỏ — không bao giờ gửi thuộc tính của danh mục cũ sang danh mục mới.
 */
export function pruneAttributeValues(
  values: Record<string, AttributeSelection>,
  definitions: PodCategoryAttributeDef[],
): Record<string, AttributeSelection> {
  const next: Record<string, AttributeSelection> = {};
  for (const attribute of definitions) {
    const entry = values[attribute.tiktokAttributeId];
    if (!entry) continue;
    const allowed = new Set((attribute.values ?? []).map((value) => value.id));
    const valueIds = entry.valueIds.filter((id) => allowed.has(id));
    const customValues = attribute.isCustomizable ? entry.customValues : [];
    if (valueIds.length > 0 || customValues.length > 0) {
      next[attribute.tiktokAttributeId] = { valueIds, customValues };
    }
  }
  return next;
}

/** Mã lỗi kiểm TRƯỚC khi gửi — thông điệp do component dịch. */
export type CustomListingCheck =
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'SHOP_REQUIRED'
  | 'CATEGORY_REQUIRED'
  | 'SKU_REQUIRED'
  | 'SKU_INVALID';

export const TITLE_MAX = 255;

/**
 * Kiểm nhanh phía client trước khi ĐĂNG. Lưu nháp chỉ cần tiêu đề + shop; phần còn lại nháp
 * được phép dở dang.
 *
 * 🔴 Kiểm DỮ LIỆU, không kiểm "đã chọn mẫu chưa": danh mục có thể đến từ ô chọn tay HOẶC từ
 * Category Template; SKU có thể nhập tay HOẶC từ SKU Template. Chỉ khi cả hai nguồn đều
 * trống mới là lỗi — và lỗi nói về thứ thiếu, không nói về mẫu. Backend kiểm lại bằng đúng
 * luật này (`checkProduct`), đây chỉ là báo sớm.
 */
export function checkCustomListingForm(
  form: CustomListingForm,
  mode: 'DRAFT' | 'SUBMIT',
): CustomListingCheck[] {
  const issues: CustomListingCheck[] = [];
  if (!form.title.trim()) issues.push('TITLE_REQUIRED');
  else if (form.title.length > TITLE_MAX) issues.push('TITLE_TOO_LONG');
  if (form.shopIds.length === 0) issues.push('SHOP_REQUIRED');
  if (mode === 'DRAFT') return issues;

  if (!form.category.id && !form.templates.category) issues.push('CATEGORY_REQUIRED');
  if (form.skus.length === 0) {
    if (!form.templates.sku) issues.push('SKU_REQUIRED');
  } else if (form.skus.some((sku) => !isUsableSku(sku))) {
    issues.push('SKU_INVALID');
  }
  return issues;
}

/** Một dòng SKU dùng được: có Seller SKU, giá bán > 0, số lượng không âm. */
export function isUsableSku(sku: ManualSku): boolean {
  return (
    sku.sellerSku.trim() !== '' &&
    Number(sku.salePrice) > 0 &&
    (sku.quantity === undefined || sku.quantity >= 0)
  );
}

function pickTemplate(
  session: PodListingSessionDetail,
  key: 'categoryTemplateId' | 'skuTemplateId' | 'descriptionTemplateId' | 'imageTemplateId',
): string {
  return session.templates.find((row) => row[key] !== null)?.[key] ?? '';
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Bỏ trục trống và giá trị rỗng — lưới SKU đã dựng từ bộ này nên không đổi tổ hợp nào. */
function normalizeVariations(variations: ManualVariation[]): ManualVariation[] {
  return variations
    .map((variation) => ({
      name: variation.name.trim(),
      values: variation.values.map((value) => value.trim()).filter(Boolean),
    }))
    .filter((variation) => variation.name !== '' && variation.values.length > 0);
}
