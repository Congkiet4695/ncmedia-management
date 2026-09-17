import type { Prisma } from '@prisma/client';
import { POD_DRAFT_ISSUE_CODES } from '../constants/pod-listing.constants';
import type { ResolveIssue, ResolvedListing, ResolvedVariant } from './pod-listing-resolver.service';

/**
 * Dữ liệu NHẬP TAY cho một Draft Product — phần ghi đè lên template của lượt đăng.
 *
 * 🔴 **Ghi đè theo TỪNG TRƯỜNG, không phải thay cả cụm.** Giao diện cho mỗi khu vực chọn
 * độc lập "dùng mẫu có sẵn" hay "nhập tay" (xem `docs/listing/2.png`: mỗi section có một
 * dropdown mẫu riêng, với lựa chọn `NHẬP TAY MÔ TẢ`). Trường vắng mặt ⇒ rơi về template.
 * Nhờ vậy một sản phẩm có thể dùng Category Template chung của cả lượt nhưng mang mô tả và
 * bảng giá riêng, mà không phải nhân bản template.
 *
 * 🔴 **Đây là hàm THUẦN, không Nest/Prisma.** Nó là luật "nhập tay thắng template" và luật
 * đó phải giống hệt nhau ở ba nơi: xem trước, validate, và lúc dựng payload gửi TikTok.
 * Mỗi nơi tự viết một bản là ba câu trả lời khác nhau cho cùng một sản phẩm.
 *
 * Phạm vi hiện tại đúng bằng lát cắt dọc đã chốt: **Tiêu đề · Mô tả · Giá/SKU**.
 * (Tiêu đề vốn đã nằm trên `pod_listing_session_products.title` và đã thắng template từ
 * trước — xem `resolveFromContext` — nên ở đây không lặp lại.)
 * Category / brand / thuộc tính / ảnh / đóng gói vẫn do template quyết; thêm sau chỉ là
 * thêm nhánh vào `applyManualOverride`, KHÔNG phải đổi hình dạng dữ liệu.
 */
export interface ManualListingOverride {
  /** Mô tả HTML người dùng gõ. Chuỗi rỗng = CÓ Ý xoá mô tả, khác hẳn `undefined` = dùng mẫu. */
  description?: string;
  /** Danh mục TikTok chọn trực tiếp trên form (không qua Category Template). */
  category?: ManualCategory;
  /** Thương hiệu. `tiktokBrandId` rỗng = "No brand" (TikTok chấp nhận, là mặc định hàng POD). */
  brand?: ManualBrand;
  /**
   * Giá trị thuộc tính danh mục người dùng điền.
   *
   * 🔴 Có mặt (kể cả rỗng) ⇒ thay TOÀN BỘ bộ thuộc tính của Category Template. Trộn hai
   * nguồn sẽ đẩy lên sàn một tập thuộc tính không ai chủ động chọn.
   */
  attributes?: ManualAttribute[];
  /** Kiện hàng. Ghi đè từng trường — để trống trường nào thì trường đó lấy từ template. */
  package?: ManualPackage;
  /**
   * Video sản phẩm — file trong Storage Module.
   *
   * 🔴 Chỉ lưu `fileId`, KHÔNG lưu id phía TikTok: id đó do TikTok cấp lúc upload và gắn với
   * app, còn ở đây ta mới chỉ có file của người dùng. Publisher upload rồi điền `tiktokVideoId`.
   */
  video?: ManualVideo;
  /**
   * Trục biến thể (`Color: Black, White`). Lưu để mở lại nháp dựng đúng lưới đã sinh —
   * bản thân nó KHÔNG sinh SKU ở backend, `skus` mới là danh sách thật.
   */
  variations?: ManualVariation[];
  /** Bảng SKU. Có mặt (kể cả rỗng) ⇒ thay TOÀN BỘ biến thể từ SKU Template. */
  skus?: ManualSku[];
}

export interface ManualCategory {
  tiktokCategoryId: string;
  name?: string | null;
  path?: string | null;
}

export interface ManualBrand {
  /** Rỗng/thiếu = No brand. */
  tiktokBrandId?: string | null;
  name?: string | null;
}

export interface ManualAttribute {
  tiktokAttributeId: string;
  name?: string | null;
  type?: string | null;
  isRequired?: boolean;
  /** Giá trị chính thức của TikTok (`value_id`). */
  values?: Array<{ id?: string; name?: string }>;
  /** Giá trị người dùng tự gõ — TikTok nhận dưới dạng `{ name }` không kèm id. */
  customValues?: string[];
}

export interface ManualVideo {
  fileId: string;
  /** Tên file để hiển thị lại trên form. */
  fileName?: string | null;
}

export interface ManualPackage {
  weight?: string | null;
  weightUnit?: string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  dimensionUnit?: string | null;
}

export interface ManualVariation {
  name: string;
  values: string[];
}

export interface ManualSku {
  sellerSku: string;
  /** `[{ name: 'Color', value: 'Black' }, { name: 'Size', value: 'S' }]`. */
  optionValues: Array<{ name: string; value: string }>;
  /** Giá bán thực tế — TikTok `sale_price`. Ô "Retail price" trên lưới. */
  salePrice?: string | null;
  /** Giá gạch ngang — TikTok `original_price`. Ô "List price" trên lưới. */
  retailPrice?: string | null;
  quantity?: number | null;
  imageFileId?: string | null;
  barcode?: string | null;
}

/** Trần số SKU một sản phẩm — cùng con số với SKU Template để hai đường không lệch nhau. */
export const MANUAL_SKU_MAX = 3000;

/**
 * Đọc cột JSON thành contract đã kiểm hình dạng.
 *
 * 🔴 Cột `Json` của Prisma KHÔNG bảo đảm kiểu gì cả: dữ liệu có thể do một phiên bản cũ ghi,
 * do import, hoặc do một bug ở nơi khác. Ép kiểu bằng `as` là tin vào một lời hứa không ai
 * giữ — một `skus: "abc"` sẽ nổ ở tận chỗ dựng payload gửi TikTok. Ở đây phần tử sai hình
 * dạng bị BỎ QUA, phần đúng vẫn dùng được (cùng tinh thần với `toStringArray` của
 * `PodProductResponseMapper`).
 *
 * Trả `null` khi không có gì dùng được ⇒ nơi gọi rơi về template như chưa từng có override.
 */
export function parseManualOverride(value: Prisma.JsonValue | null): ManualListingOverride | null {
  if (!isJsonObject(value)) return null;

  const result: ManualListingOverride = {};

  if (typeof value.description === 'string') result.description = value.description;

  if (isJsonObject(value.category)) {
    const tiktokCategoryId = asString(value.category.tiktokCategoryId);
    // Thiếu mã danh mục thì object này vô dụng — bỏ hẳn để rơi về Category Template, thay vì
    // giữ một danh mục "rỗng" rồi chặn listing bằng một lỗi khó hiểu.
    if (tiktokCategoryId) {
      result.category = {
        tiktokCategoryId,
        name: asString(value.category.name),
        path: asString(value.category.path),
      };
    }
  }

  if (isJsonObject(value.brand)) {
    result.brand = {
      tiktokBrandId: asString(value.brand.tiktokBrandId),
      name: asString(value.brand.name),
    };
  }

  if (Array.isArray(value.attributes)) {
    result.attributes = value.attributes
      .filter(isJsonObject)
      .map((raw) => ({
        tiktokAttributeId: asString(raw.tiktokAttributeId) ?? '',
        name: asString(raw.name),
        type: asString(raw.type),
        isRequired: raw.isRequired === true,
        values: Array.isArray(raw.values)
          ? raw.values
              .filter(isJsonObject)
              .map((entry) => ({
                id: asString(entry.id) ?? undefined,
                name: asString(entry.name) ?? undefined,
              }))
              .filter((entry) => entry.id !== undefined || entry.name !== undefined)
          : [],
        customValues: Array.isArray(raw.customValues)
          ? raw.customValues.map(asString).filter(isNonEmpty)
          : [],
      }))
      .filter((attribute) => attribute.tiktokAttributeId !== '');
  }

  if (isJsonObject(value.video)) {
    const fileId = asString(value.video.fileId);
    if (fileId) result.video = { fileId, fileName: asString(value.video.fileName) };
  }

  if (isJsonObject(value.package)) {
    const pkg = {
      weight: asString(value.package.weight),
      weightUnit: asString(value.package.weightUnit),
      length: asString(value.package.length),
      width: asString(value.package.width),
      height: asString(value.package.height),
      dimensionUnit: asString(value.package.dimensionUnit),
    };
    if (Object.values(pkg).some((entry) => entry !== null)) result.package = pkg;
  }

  if (Array.isArray(value.variations)) {
    const variations = value.variations
      .filter(isJsonObject)
      .map((raw) => ({
        name: asString(raw.name) ?? '',
        values: Array.isArray(raw.values) ? raw.values.map(asString).filter(isNonEmpty) : [],
      }))
      .filter((variation) => variation.name !== '' && variation.values.length > 0);
    if (variations.length > 0) result.variations = variations;
  }

  if (Array.isArray(value.skus)) {
    // `skus` CÓ MẶT là một tín hiệu, kể cả khi lọc xong còn rỗng: nó nghĩa là "sản phẩm này
    // nhập tay bảng SKU". Rỗng ⇒ `applyManualOverride` báo lỗi thiếu biến thể, chứ KHÔNG
    // lặng lẽ rơi về template — rơi về template là đăng lên sàn một bảng giá người dùng
    // tưởng mình đã thay.
    result.skus = value.skus
      .filter(isJsonObject)
      .map((raw) => ({
        sellerSku: asString(raw.sellerSku) ?? '',
        optionValues: Array.isArray(raw.optionValues)
          ? raw.optionValues
              .filter(isJsonObject)
              .map((option) => ({
                name: asString(option.name) ?? '',
                value: asString(option.value) ?? '',
              }))
              .filter((option) => option.name !== '' && option.value !== '')
          : [],
        salePrice: asString(raw.salePrice),
        retailPrice: asString(raw.retailPrice),
        quantity: typeof raw.quantity === 'number' && Number.isFinite(raw.quantity) ? raw.quantity : null,
        imageFileId: asString(raw.imageFileId),
        barcode: asString(raw.barcode),
      }))
      .filter((sku) => sku.sellerSku !== '');
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Áp dữ liệu nhập tay lên listing đã giải từ template.
 *
 * Trả về payload MỚI (không sửa tại chỗ) để nơi gọi so sánh được trước/sau khi cần.
 * `issues` được bồi thêm — KHÔNG thay thế — nên lỗi của template vẫn còn nguyên.
 */
export function applyManualOverride(
  payload: ResolvedListing,
  override: ManualListingOverride | null,
  issues: ResolveIssue[],
): ResolvedListing {
  if (!override) return payload;

  const next: ResolvedListing = { ...payload };

  if (override.description !== undefined) {
    next.description = override.description;
    // Mô tả rỗng do người dùng CỐ Ý xoá vẫn là listing không đăng được. Gỡ lỗi cũ của
    // template rồi báo lại theo đúng nội dung mới — nếu không sẽ tồn tại hai lỗi mô tả
    // mâu thuẫn, hoặc tệ hơn: lỗi của template biến mất trong khi mô tả vẫn rỗng.
    dropIssues(issues, POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION);
    if (!stripHtml(override.description)) {
      issues.push({
        level: 'ERROR',
        field: 'description',
        code: POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION,
        message: 'Listing chưa có mô tả',
      });
    }
  }

  if (override.category) {
    next.category = {
      tiktokCategoryId: override.category.tiktokCategoryId,
      name: override.category.name ?? null,
      path: override.category.path ?? null,
    };
    // Danh mục chọn tay là danh mục hợp lệ ⇒ lỗi "chưa chọn danh mục" của template không còn
    // nói về dữ liệu đang dùng.
    dropIssues(issues, POD_DRAFT_ISSUE_CODES.MISSING_CATEGORY);
  }

  if (override.brand) {
    // 🔴 KHÔNG đụng tới `mode`: `brand.mode` là câu trả lời "có thương hiệu hay không" do
    // template quyết, và `PodListingPublisherService.resolveBrandId` đọc nó. Ở đây chỉ thay
    // GIÁ TRỊ. Thiếu `tiktokBrandId` nghĩa là No brand — lựa chọn mặc định của hàng POD.
    next.brand = {
      ...payload.brand,
      tiktokBrandId: override.brand.tiktokBrandId ?? null,
      name: override.brand.name ?? null,
    };
  }

  if (override.attributes !== undefined) {
    next.attributes = override.attributes.map((attribute) => ({
      tiktokAttributeId: attribute.tiktokAttributeId,
      name: attribute.name ?? null,
      type: attribute.type ?? null,
      isRequired: attribute.isRequired ?? false,
      values: attribute.values ?? [],
      customValues: attribute.customValues ?? [],
    }));

    // Thuộc tính bắt buộc phải kiểm LẠI trên bộ mới: bộ của template đã bị thay hoàn toàn,
    // nên lỗi cũ vừa sai vừa che mất lỗi thật.
    dropIssues(issues, POD_DRAFT_ISSUE_CODES.MISSING_REQUIRED_ATTRIBUTE);
    const missing = next.attributes.filter(
      (attribute) =>
        attribute.isRequired &&
        attribute.values.length === 0 &&
        attribute.customValues.length === 0,
    );
    // Gộp thành MỘT dòng: một danh mục TikTok có tới 47 thuộc tính, liệt kê từng cái thành
    // một lỗi riêng sẽ đẩy mọi lỗi khác ra khỏi màn hình (§10).
    if (missing.length > 0) {
      issues.push({
        level: 'ERROR',
        field: 'attributes',
        code: POD_DRAFT_ISSUE_CODES.MISSING_REQUIRED_ATTRIBUTE,
        message: summarize(
          'Thuộc tính bắt buộc chưa có giá trị',
          missing.map((attribute) => attribute.name ?? attribute.tiktokAttributeId),
          'thuộc tính',
        ),
      });
    }
  }

  if (override.package) {
    // Ghi đè TỪNG trường: người dùng sửa mỗi khối lượng thì kích thước vẫn của template.
    next.package = {
      weight: override.package.weight ?? payload.package.weight,
      weightUnit: override.package.weightUnit ?? payload.package.weightUnit,
      length: override.package.length ?? payload.package.length,
      width: override.package.width ?? payload.package.width,
      height: override.package.height ?? payload.package.height,
      dimensionUnit: override.package.dimensionUnit ?? payload.package.dimensionUnit,
    };
    dropIssues(issues, POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE);
    if (!positiveDecimal(next.package.weight)) {
      issues.push({
        level: 'ERROR',
        field: 'package.weight',
        code: POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE,
        message: 'Khối lượng kiện hàng phải lớn hơn 0',
      });
    }
  }

  if (override.video) {
    // `tiktokVideoId` để trống: publisher upload file lên TikTok rồi mới có id.
    next.video = { fileId: override.video.fileId, url: null, tiktokVideoId: null };
  }

  if (override.skus !== undefined) {
    // Bảng SKU nhập tay thay TOÀN BỘ biến thể của template ⇒ mọi lỗi biến thể/giá của
    // template không còn nói về dữ liệu đang dùng nữa.
    dropIssues(issues, POD_DRAFT_ISSUE_CODES.MISSING_VARIANT, POD_DRAFT_ISSUE_CODES.MISSING_PRICE);
    next.variants = buildManualVariants(override.skus, payload, issues);
  }

  return next;
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Bảng SKU nhập tay → `ResolvedVariant[]`, kèm kiểm tra.
 *
 * 🔴 Lỗi được GỘP theo loại, không phải mỗi SKU một dòng (yêu cầu §10). Một lượt 600 SKU
 * quên điền giá phải ra **một** dòng "Chưa có giá bán — 600 SKU", không phải 600 dòng giống
 * hệt nhau đẩy mọi lỗi khác ra khỏi màn hình.
 */
function buildManualVariants(
  skus: ManualSku[],
  payload: ResolvedListing,
  issues: ResolveIssue[],
): ResolvedVariant[] {
  if (skus.length === 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants',
      code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
      message: 'Listing chưa có biến thể nào',
    });
    return [];
  }

  if (skus.length > MANUAL_SKU_MAX) {
    issues.push({
      level: 'ERROR',
      field: 'variants',
      code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
      message: `Vượt trần ${MANUAL_SKU_MAX} SKU cho một sản phẩm (đang có ${skus.length}).`,
    });
    return [];
  }

  const currency = payload.pricing?.currency ?? null;
  const missingPrice: string[] = [];
  const duplicated: string[] = [];
  const seen = new Set<string>();

  const variants = skus.map((sku, index) => {
    // Seller SKU trùng nhau là đơn hàng về không biết gói món nào — TikTok từ chối, và
    // phát hiện ở đây rẻ hơn phát hiện sau 600 lời gọi API.
    if (seen.has(sku.sellerSku)) duplicated.push(sku.sellerSku);
    else seen.add(sku.sellerSku);

    const salePrice = positiveDecimal(sku.salePrice);
    if (!salePrice) missingPrice.push(sku.sellerSku);

    return {
      variantName: sku.optionValues.map((option) => option.value).join(' / ') || sku.sellerSku,
      sellerSku: sku.sellerSku,
      barcode: sku.barcode ?? null,
      optionValues: sku.optionValues,
      salePrice,
      retailPrice: positiveDecimal(sku.retailPrice),
      currency,
      // Không điền số lượng ⇒ 0. TikTok nhận 0 (hàng hết), nên đây không phải lỗi chặn.
      quantity: sku.quantity ?? 0,
      imageFileId: sku.imageFileId ?? null,
      sortOrder: index,
    } satisfies ResolvedVariant;
  });

  if (missingPrice.length > 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants.salePrice',
      code: POD_DRAFT_ISSUE_CODES.MISSING_PRICE,
      message: summarize('Giá bán phải lớn hơn 0', missingPrice),
    });
  }
  if (duplicated.length > 0) {
    issues.push({
      level: 'ERROR',
      field: 'variants.sellerSku',
      code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT,
      message: summarize('Seller SKU bị trùng', [...new Set(duplicated)]),
    });
  }

  return variants;
}

/**
 * Một dòng lỗi cho cả nhóm: nêu vài mã SKU đầu để người dùng biết bắt đầu sửa từ đâu, rồi
 * báo tổng số. Liệt kê hết 600 mã trong một câu thì không ai đọc.
 */
function summarize(reason: string, items: string[], unit = 'SKU'): string {
  const sample = items.slice(0, 3).join(', ');
  return items.length <= 3
    ? `${reason} — ${unit}: ${sample}`
    : `${reason} — ${unit}: ${sample}… (tổng ${items.length} ${unit})`;
}

/** Gỡ các lỗi mà dữ liệu nhập tay vừa làm cho không còn đúng nữa. Sửa MẢNG tại chỗ. */
function dropIssues(issues: ResolveIssue[], ...codes: string[]): void {
  const remove = new Set(codes);
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    if (remove.has(issues[index].code)) issues.splice(index, 1);
  }
}

/**
 * Chuỗi số dương hợp lệ, hoặc `null`.
 *
 * `0`, số âm, chuỗi rỗng và chữ đều ra `null` — cùng quy ước với `resolveSkuItemPrice`
 * ("ô để trống ghi xuống 0 nghĩa là CHƯA ĐẶT").
 */
function positiveDecimal(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? text : null;
}

/** Mô tả chỉ gồm thẻ rỗng (`<p></p>`, `<br>`) vẫn là mô tả rỗng với người mua. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/**
 * 🔴 Thu hẹp về `Prisma.JsonObject`, KHÔNG phải `Record<string, unknown>`: chỉ kiểu đầu
 * mới `extends JsonValue`, và `Array.prototype.filter` chỉ dùng overload type-predicate khi
 * kiểu đích là kiểu con của kiểu phần tử. Dùng `Record` thì filter âm thầm trả về
 * `JsonValue[]` và mọi phép truy cập trường bên dưới mất kiểu.
 */
function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isNonEmpty(value: string | null): value is string {
  return value !== null;
}
