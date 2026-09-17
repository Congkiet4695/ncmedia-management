import type { SessionImageInput } from '@/features/pod-listing-session/types';
import type {
  PodImageTemplate,
  PodSkuTemplate,
  PodCategoryTemplate,
} from '@/features/pod-listing/types';
import type { PodProductDetail, UpdatePodProductPayload, UpdatePodProductSku } from '../types';

/**
 * Phần **logic thuần** của màn hình Sửa sản phẩm: dựng trạng thái ban đầu, dựng payload gửi
 * đi, và áp template.
 *
 * 🔴 Vì sao tách khỏi component: đây là chỗ quyết định thứ gì chạm tới một sản phẩm ĐANG BÁN.
 * Hai kiểu sai nguy hiểm nhất đều không ném lỗi và không hiện ra trên màn hình:
 *   - Gửi thừa ⇒ ghi đè dữ liệu người dùng không hề đụng tới.
 *   - Gửi bộ ảnh thiếu một tấm ⇒ TikTok XOÁ tấm đó, vì `main_images` thay cả bộ.
 * Nằm trong JSX thì không test được; nằm ở đây thì kiểm được từng luật một.
 */

/** Giá trị đang sửa của một SKU. Chuỗi rỗng = người dùng xoá trắng ô. */
export interface SkuDraft {
  sellerSku: string;
  salePrice: string;
  listPrice: string;
  quantity: string;
}

/** Toàn bộ thứ người dùng đang sửa, dùng chung cho cả ba tab. */
export interface EditProductForm {
  title: string;
  description: string;
  searchTerms: string;
  highlights: string;
  brandId: string;
  images: SessionImageInput[];
  sizeChart: SessionImageInput | null;
  /** Video MỚI người dùng vừa tải lên. `null` = giữ nguyên video đang có. */
  video: { fileId?: string; fileName?: string | null; url?: string | null } | null;
  skus: Record<string, SkuDraft>;
}

// ---------------------------------------------------------------------------
// Trạng thái ban đầu
// ---------------------------------------------------------------------------

/**
 * Sản phẩm đã đồng bộ → trạng thái form.
 *
 * 🔴 Ảnh mang theo `uri`: đó là thứ gửi lại được cho TikTok. Giữ `uri` nghĩa là đổi thứ tự
 * hay xoá bớt ảnh KHÔNG phải upload lại tấm nào — chỉ tấm người dùng mới thêm mới cần upload.
 */
export function toFormState(product: PodProductDetail): EditProductForm {
  return {
    title: product.title ?? '',
    description: product.description ?? '',
    searchTerms: (product.searchTerms ?? []).join(', '),
    highlights: (product.highlights ?? []).join('\n'),
    brandId: '',
    images: mainImagesOf(product),
    sizeChart: sizeChartOf(product),
    video: videoOf(product),
    skus: Object.fromEntries(
      product.variants.map((variant) => [
        variant.tiktokSkuId,
        {
          sellerSku: variant.sellerSku ?? '',
          salePrice: variant.salePrice ?? '',
          listPrice: variant.listPrice ?? '',
          quantity: String(variant.inventoryTotal ?? 0),
        },
      ]),
    ),
  };
}

/** Ảnh SẢN PHẨM, đúng thứ tự. Ảnh của biến thể (`variantId`) không thuộc về đây. */
export function mainImagesOf(product: PodProductDetail): SessionImageInput[] {
  return product.images
    .filter((image) => !image.variantId)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((image, index) => ({
      imageUrl: image.thumbUrl ?? image.url ?? '',
      uri: image.uri ?? undefined,
      imageType: 'MAIN',
      fileName: `#${index + 1}`,
    }));
}

function sizeChartOf(product: PodProductDetail): SessionImageInput | null {
  const chart = product.sizeChart;
  if (!chart || (!chart.uri && !chart.url)) return null;
  return {
    imageUrl: chart.url ?? '',
    uri: chart.uri ?? undefined,
    imageType: 'SIZE_CHART',
    fileName: 'size-chart',
  };
}

function videoOf(product: PodProductDetail): EditProductForm['video'] {
  const video = product.videos[0];
  if (!video) return null;
  return { fileName: video.format ?? 'video', url: video.url };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/**
 * Form → payload PATCH. **Chỉ những gì thật sự đổi.**
 *
 * Backend còn diff lần nữa với dữ liệu đã đồng bộ, nhưng phép so ở đây mới là thứ quyết định
 * nút Lưu có sáng lên hay không — và quyết định có upload ảnh mới lên TikTok hay không.
 */
export function buildUpdatePayload(
  product: PodProductDetail,
  form: EditProductForm,
): UpdatePodProductPayload {
  const payload: UpdatePodProductPayload = {};

  if (form.title.trim() !== (product.title ?? '').trim()) payload.title = form.title;
  if (form.description !== (product.description ?? '')) payload.description = form.description;
  if (form.brandId && form.brandId !== (product.tiktokBrandId ?? '')) payload.brandId = form.brandId;

  const terms = splitList(form.searchTerms, ',');
  if (!sameList(terms, product.searchTerms)) payload.searchTerms = terms;

  const highlights = splitList(form.highlights, '\n');
  if (!sameList(highlights, product.highlights)) payload.highlights = highlights;

  /**
   * 🔴 Ảnh: gửi CẢ BỘ hoặc không gửi gì.
   *
   * Khoá so sánh là `uri` với ảnh cũ và `fileId` với ảnh vừa tải lên — không phải `imageUrl`,
   * vì link hiển thị của TikTok có tham số hết hạn và đổi giữa hai lần đồng bộ, so bằng nó
   * thì lần nào cũng thấy "có thay đổi".
   */
  const currentKeys = mainImagesOf(product).map(imageKey);
  const nextKeys = form.images.map(imageKey);
  if (form.images.length > 0 && !sameList(nextKeys, currentKeys)) {
    payload.mainImages = form.images.map((image) => ({
      ...(image.uri ? { uri: image.uri } : {}),
      ...(image.fileId ? { fileId: image.fileId } : {}),
    }));
  }

  // Bảng size chỉ gửi khi người dùng chọn tấm MỚI (có `fileId`). Tấm đang có trên sản phẩm
  // không có `fileId`, nên mở form rồi đóng lại không đụng gì tới bảng size.
  if (form.sizeChart?.fileId) payload.sizeChart = { fileId: form.sizeChart.fileId };

  // Video tương tự: chỉ gửi khi có file mới.
  if (form.video?.fileId) payload.video = { fileId: form.video.fileId };

  const skus: UpdatePodProductSku[] = [];
  for (const variant of product.variants) {
    const draft = form.skus[variant.tiktokSkuId];
    if (!draft) continue;
    const entry: UpdatePodProductSku = { tiktokSkuId: variant.tiktokSkuId };
    let touched = false;

    if (draft.sellerSku.trim() !== (variant.sellerSku ?? '').trim()) {
      entry.sellerSku = draft.sellerSku.trim();
      touched = true;
    }
    if (!sameAmount(draft.salePrice, variant.salePrice)) {
      entry.salePrice = draft.salePrice.trim();
      touched = true;
    }
    if (!sameAmount(draft.listPrice, variant.listPrice)) {
      entry.listPrice = draft.listPrice.trim();
      touched = true;
    }
    if (Number(draft.quantity) !== variant.inventoryTotal) {
      entry.quantity = Number(draft.quantity);
      touched = true;
    }
    if (touched) skus.push(entry);
  }
  if (skus.length > 0) payload.skus = skus;

  return payload;
}

/** Ảnh cũ nhận diện bằng `uri`, ảnh mới bằng `fileId`. Link hiển thị KHÔNG dùng để so. */
function imageKey(image: SessionImageInput): string {
  return image.uri ?? (image.fileId ? `file:${image.fileId}` : `url:${image.imageUrl}`);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Ảnh của bộ ảnh mẫu — chỉ ảnh SẢN PHẨM, bảng size tách riêng. */
export function imagesFromTemplate(template: PodImageTemplate): SessionImageInput[] {
  return [...(template.items ?? [])]
    .filter((item) => item.assetType !== 'SIZE_CHART' && Boolean(item.imageUrl))
    .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0))
    .map((item) => ({
      imageUrl: item.imageUrl,
      fileId: item.fileId,
      imageType: 'MAIN',
      fileName: item.title,
    }));
}

/**
 * Bảng size trong bộ ảnh mẫu.
 *
 * 🔴 Tách khỏi ảnh sản phẩm là BẮT BUỘC, không phải cho gọn: TikTok cấp `uri` khác nhau cho
 * cùng một tấm ảnh tuỳ `use_case`. Để lẫn một tấm bảng size vào `main_images` là đăng bảng
 * size thành ảnh gian hàng — lỗi đã từng xảy ra ở luồng Bulk Listing.
 */
export function sizeChartFromTemplate(template: PodImageTemplate): SessionImageInput | null {
  const item = [...(template.items ?? [])]
    .filter((entry) => entry.assetType === 'SIZE_CHART' && Boolean(entry.imageUrl))
    .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0))[0];
  if (!item) return null;
  return {
    imageUrl: item.imageUrl,
    fileId: item.fileId,
    imageType: 'SIZE_CHART',
    fileName: item.title,
  };
}

/** Phần một Category Template ĐIỀN ĐƯỢC cho sản phẩm đã đăng. */
export interface CategoryTemplateEffect {
  brandId?: string;
  sizeChartFileId?: string;
  videoFileId?: string;
  /** Danh mục của mẫu khác danh mục sản phẩm ⇒ nói rõ là phần đó không áp được. */
  categoryBlocked: boolean;
}

/**
 * Category Template → sản phẩm đang sửa.
 *
 * 🔴 **Danh mục KHÔNG bao giờ được áp.** `partial_edit` không nhận `category_id`, nên mẫu có
 * khai danh mục khác thì phần đó phải bị bỏ và phải NÓI RA, thay vì để người dùng tin là đã
 * đổi danh mục xong. Những phần còn lại của mẫu (thương hiệu, bảng size, video) vẫn áp được
 * bình thường — bỏ cả mẫu chỉ vì một trường không áp được mới là phí.
 *
 * 🔴 Kiện hàng (`package`) cũng không áp ở đây: màn hình Sửa sản phẩm chưa có ô nhập kích
 * thước/khối lượng, áp vào một chỗ người dùng không nhìn thấy là thay đổi ngầm.
 */
export function applyCategoryTemplateToProduct(
  template: PodCategoryTemplate,
  product: PodProductDetail,
): CategoryTemplateEffect {
  const effect: CategoryTemplateEffect = {
    categoryBlocked: Boolean(
      template.tiktokCategoryId && template.tiktokCategoryId !== product.tiktokCategoryId,
    ),
  };

  if (template.brandMode === 'SPECIFIC' && template.tiktokBrandId) {
    effect.brandId = template.tiktokBrandId;
  }
  if (template.sizeChartFileId) effect.sizeChartFileId = template.sizeChartFileId;
  if (template.videoFileId) effect.videoFileId = template.videoFileId;

  return effect;
}

/** Kết quả áp SKU Template lên bảng SKU đang có. */
export interface SkuTemplateEffect {
  skus: Record<string, SkuDraft>;
  /** Số SKU đã điền giá mới. */
  matched: number;
  /** Tổ hợp có trong mẫu nhưng sản phẩm KHÔNG có — không tạo thêm được, phải nói ra. */
  unmatched: string[];
}

/**
 * SKU Template → bảng SKU của sản phẩm đã đăng.
 *
 * 🔴 Chỉ ĐIỀN GIÁ và TỒN KHO cho những tổ hợp sản phẩm ĐÃ CÓ, khớp theo tên biến thể.
 * Không tạo SKU mới: `partial_edit` sửa được SKU đang có chứ không thêm được SKU, nên tổ hợp
 * lạ trong mẫu phải được báo là bỏ qua — im lặng bỏ qua thì người dùng tưởng đã có đủ.
 *
 * So tên biến thể sau khi chuẩn hoá khoảng trắng và hoa thường: mẫu ghi `"Black / S"` còn
 * TikTok trả `"Black/S"` là cùng một tổ hợp.
 */
export function applySkuTemplateToProduct(
  template: PodSkuTemplate,
  product: PodProductDetail,
  current: Record<string, SkuDraft>,
): SkuTemplateEffect {
  const items = template.items ?? [];
  const byName = new Map(items.map((item) => [normalizeVariant(item.variantName), item]));

  const skus = { ...current };
  let matched = 0;
  const used = new Set<string>();

  for (const variant of product.variants) {
    const item = byName.get(normalizeVariant(variant.variantName ?? ''));
    if (!item) continue;
    used.add(normalizeVariant(item.variantName));

    const draft = skus[variant.tiktokSkuId];
    if (!draft) continue;

    // `effectiveSalePrice` là con số server thật sự gửi lên TikTok (đã tính quy tắc lệch
    // giá) — `salePrice` thô chưa tính, dùng nó là điền sai giá.
    const salePrice = item.effectiveSalePrice ?? item.salePrice ?? '';
    skus[variant.tiktokSkuId] = {
      ...draft,
      ...(salePrice ? { salePrice } : {}),
      ...(item.retailPrice ? { listPrice: item.retailPrice } : {}),
      ...(item.quantity != null ? { quantity: String(item.quantity) } : {}),
      ...(item.skuCode ? { sellerSku: item.skuCode } : {}),
    };
    matched += 1;
  }

  const unmatched = items
    .filter((item) => !used.has(normalizeVariant(item.variantName)))
    .map((item) => item.variantName);

  return { skus, matched, unmatched };
}

function normalizeVariant(name: string): string {
  return name
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('/');
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

export function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sameList(left: string[], right: string[] | null | undefined): boolean {
  const other = right ?? [];
  return left.length === other.length && left.every((item, index) => item === other[index]);
}

/** So tiền theo GIÁ TRỊ: `19.9` và `19.90` là một. Cùng quy tắc với backend. */
export function sameAmount(left: string, right: string | null): boolean {
  const a = left.trim();
  const b = (right ?? '').trim();
  if (!a && !b) return true;
  if (!a || !b) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return a === b;
  return na === nb;
}
