/**
 * Thao tác trên các thẻ `<img>` trong HTML mô tả sản phẩm — HÀM THUẦN, không Nest/Prisma.
 *
 * 🔴 Vì sao tách riêng: TikTok chỉ nhận `<img src>` là URL do Upload Product Image
 * (`use_case = DESCRIPTION_IMAGE`) trả về (lỗi `12052340`). Mọi đường gửi mô tả lên sàn
 * (Bulk Listing, Publish, Edit Product) đều phải qua cùng một phép "tìm ảnh → đổi src → giữ
 * width/height"; viết ba bản là ba cách sai khác nhau. Phần gọi TikTok/database nằm ở
 * `PodDescriptionImageService`; ở đây chỉ có chuỗi vào, chuỗi ra — và test không cần gì khác.
 *
 * HTML vào đây đã đi qua `RichTextEditor` (client) và/hoặc `sanitizeDescriptionHtml` (server)
 * nên là HTML "sạch": thẻ `img` tự đóng hoặc không, thuộc tính trong dấu nháy. Bộ đọc thẻ dưới
 * đây cố ý đơn giản (không parse cả DOM) — mô tả sản phẩm không phải tài liệu tuỳ ý.
 */

/** Một thẻ `<img>` tìm thấy trong mô tả. */
export interface DescriptionImageRef {
  /** Thứ tự xuất hiện (0-based) — dùng để báo "ảnh thứ N". */
  index: number;
  src: string;
  width: string | null;
  height: string | null;
  /** Nguyên văn thẻ — để thay đúng đoạn đó trong HTML. */
  raw: string;
}

/** Nguồn của một `src` — quyết định phải làm gì với nó. */
export type DescriptionImageSourceKind = 'HTTP' | 'DATA' | 'BLOB' | 'EMPTY' | 'OTHER';

const IMG_TAG = /<img\b[^>]*>/gi;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** Đọc thuộc tính của một thẻ `img` → map tên (chữ thường) → giá trị. */
function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<img\b/i, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(ATTR)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Tìm mọi `<img>` trong HTML, theo đúng thứ tự. */
export function extractDescriptionImages(html: string): DescriptionImageRef[] {
  if (!html) return [];
  const refs: DescriptionImageRef[] = [];
  let index = 0;
  for (const match of html.matchAll(IMG_TAG)) {
    const attributes = readAttributes(match[0]);
    refs.push({
      index,
      src: (attributes.get('src') ?? '').trim(),
      width: attributes.get('width') ?? null,
      height: attributes.get('height') ?? null,
      raw: match[0],
    });
    index += 1;
  }
  return refs;
}

/** Phân loại `src`: chỉ `HTTP` là thứ có thể tải về rồi đẩy lên TikTok. */
export function classifyImageSource(src: string): DescriptionImageSourceKind {
  const value = src.trim();
  if (!value) return 'EMPTY';
  const lower = value.toLowerCase();
  if (lower.startsWith('data:')) return 'DATA';
  if (lower.startsWith('blob:')) return 'BLOB';
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'HTTP';
  return 'OTHER';
}

/** Ảnh mô tả sau khi đã có URL của TikTok. */
export interface ResolvedDescriptionImage {
  url: string;
  width: number | null;
  height: number | null;
}

/**
 * Dựng lại HTML: mỗi `<img>` được thay `src` bằng URL TikTok và đặt/giữ `width` + `height`.
 *
 * `resolve` trả `null` ⇒ giữ nguyên thẻ (nơi gọi đã quyết là hợp lệ, vd ảnh sẵn có trên sản
 * phẩm TikTok). Thuộc tính khác (`alt`, `style`…) giữ nguyên thứ tự; `width`/`height` cũ chỉ
 * bị thay khi có kích thước THẬT từ TikTok — không bịa số, không lấy kích thước thumbnail.
 */
export function rewriteDescriptionImages(
  html: string,
  resolve: (ref: DescriptionImageRef) => ResolvedDescriptionImage | null,
): string {
  if (!html) return html;
  let index = 0;
  return html.replace(IMG_TAG, (tag) => {
    const attributes = readAttributes(tag);
    const ref: DescriptionImageRef = {
      index,
      src: (attributes.get('src') ?? '').trim(),
      width: attributes.get('width') ?? null,
      height: attributes.get('height') ?? null,
      raw: tag,
    };
    index += 1;

    const resolved = resolve(ref);
    if (!resolved) return tag;

    const next = new Map(attributes);
    next.set('src', resolved.url);
    if (resolved.width && resolved.width > 0) next.set('width', String(resolved.width));
    if (resolved.height && resolved.height > 0) next.set('height', String(resolved.height));

    const selfClosing = /\/>$/.test(tag.trim());
    const rendered = [...next.entries()]
      .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
      .join(' ');
    return `<img ${rendered}${selfClosing ? ' /' : ''}>`;
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Lỗi kiểm HTML mô tả trước khi gửi sàn — theo TỪNG ảnh.
 *
 * `isResolved(src)` là câu trả lời của METADATA (bảng `pod_tiktok_description_images`, hoặc
 * bộ ảnh đang có trên sản phẩm TikTok) — KHÔNG phải kiểm tiền tố URL. Ảnh `data:`/`blob:` là
 * ảnh chưa bao giờ rời khỏi trình duyệt, không có gì để tải lên.
 */
export interface DescriptionImageProblem {
  index: number;
  src: string;
  reason: 'EMPTY' | 'DATA_URL' | 'BLOB_URL' | 'INVALID_URL' | 'NOT_UPLOADED' | 'NO_SIZE';
}

export function findDescriptionImageProblems(
  html: string,
  isResolved: (ref: DescriptionImageRef) => boolean,
  options: { requireSize?: boolean } = {},
): DescriptionImageProblem[] {
  const problems: DescriptionImageProblem[] = [];
  for (const ref of extractDescriptionImages(html)) {
    const kind = classifyImageSource(ref.src);
    if (kind === 'EMPTY') problems.push({ index: ref.index, src: ref.src, reason: 'EMPTY' });
    else if (kind === 'DATA') problems.push({ index: ref.index, src: ref.src, reason: 'DATA_URL' });
    else if (kind === 'BLOB') problems.push({ index: ref.index, src: ref.src, reason: 'BLOB_URL' });
    else if (kind === 'OTHER') problems.push({ index: ref.index, src: ref.src, reason: 'INVALID_URL' });
    else if (!isResolved(ref)) problems.push({ index: ref.index, src: ref.src, reason: 'NOT_UPLOADED' });
    else if (options.requireSize && (!ref.width || !ref.height)) {
      problems.push({ index: ref.index, src: ref.src, reason: 'NO_SIZE' });
    }
  }
  return problems;
}

/** Ảnh `data:`/`blob:`/rỗng/không phải http(s) — lỗi hình thức, kiểm được mà không cần database. */
export function findUnsendableDescriptionImages(html: string): DescriptionImageProblem[] {
  return findDescriptionImageProblems(html, () => true);
}
