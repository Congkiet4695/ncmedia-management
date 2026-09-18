/**
 * Thao tác trên các thẻ `<img>` trong HTML mô tả sản phẩm — HÀM THUẦN, không Nest/Prisma.
 *
 * 🔴 Vì sao tách riêng: TikTok chỉ nhận `<img src>` là URL do Upload Product Image
 * (`use_case = DESCRIPTION_IMAGE`) trả về (lỗi `12052340`). Mọi đường gửi mô tả lên sàn
 * (Bulk Listing, Publish, Edit Product) đều phải qua cùng một phép "tìm ảnh → đổi src → giữ
 * width/height"; viết ba bản là ba cách sai khác nhau. Phần gọi TikTok/database nằm ở
 * `PodDescriptionImageService`; ở đây chỉ có chuỗi vào, chuỗi ra — và test không cần gì khác.
 *
 * 🔴 **URL là dữ liệu, thuộc tính HTML là cách đóng gói.** URL TikTok trả về có query string
 * (`…jpeg?dr=12178&from=…&t=…`); trình duyệt khi serialize `innerHTML` ghi `&` trong thuộc tính
 * thành `&amp;`, và HTML người dùng dán vào cũng có thể mang `&amp;`. Vì thế:
 *   - ĐỌC: giá trị thuộc tính được **decode entity** trước khi so sánh/tra cứu — `&amp;` là `&`.
 *   - GHI: `src` được ghi **đúng nguyên văn** URL TikTok (chỉ escape `"`), không đổi `&` thành
 *     `&amp;` — TikTok yêu cầu "src must use the url returned by Upload Image", và ta không
 *     biết bộ kiểm của họ có decode entity hay không. Thuộc tính không đổi giữ NGUYÊN VĂN.
 * Lỗi đã gặp: bản trước encode `&amp;` lúc ghi rồi đọc lại không decode ⇒ hàng rào cuối tự
 * kết luận "ảnh chưa upload" dù TikTok đã trả URL — listing FAILED sau khi upload xong.
 *
 * HTML vào đây đã đi qua `RichTextEditor` (client) và/hoặc `sanitizeDescriptionHtml` (server)
 * nên là HTML "sạch". Bộ đọc thẻ dưới đây cố ý đơn giản (không parse cả DOM) — mô tả sản phẩm
 * không phải tài liệu tuỳ ý.
 */

/** Một thẻ `<img>` tìm thấy trong mô tả. Giá trị thuộc tính ĐÃ decode entity. */
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
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Một thuộc tính như nó đứng trong thẻ: tên, giá trị đã decode, và nguyên văn để ghi lại. */
interface RawAttribute {
  name: string;
  value: string;
  raw: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode entity HTML trong giá trị thuộc tính — `&amp;` ⇒ `&`, `&#39;` ⇒ `'`, `&#x2F;` ⇒ `/`. */
export function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Đọc thuộc tính của một thẻ `img` theo đúng thứ tự — giá trị đã decode, kèm nguyên văn. */
function readAttributes(tag: string): RawAttribute[] {
  const attributes: RawAttribute[] = [];
  const body = tag.replace(/^<img\b/i, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(ATTR)) {
    const rawValue = match[2] ?? match[3] ?? match[4];
    attributes.push({
      name: match[1].toLowerCase(),
      value: rawValue === undefined ? '' : decodeHtmlAttribute(rawValue),
      raw: match[0].trim(),
    });
  }
  return attributes;
}

function toRef(tag: string, index: number): DescriptionImageRef {
  const attributes = readAttributes(tag);
  const find = (name: string) => attributes.find((attribute) => attribute.name === name);
  return {
    index,
    src: (find('src')?.value ?? '').trim(),
    width: find('width')?.value ?? null,
    height: find('height')?.value ?? null,
    raw: tag,
  };
}

/** Tìm mọi `<img>` trong HTML, theo đúng thứ tự. */
export function extractDescriptionImages(html: string): DescriptionImageRef[] {
  if (!html) return [];
  return [...html.matchAll(IMG_TAG)].map((match, index) => toRef(match[0], index));
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
 * phẩm TikTok). Thuộc tính khác (`alt`, `style`…) giữ NGUYÊN VĂN và đúng thứ tự; `width`/`height`
 * cũ chỉ bị thay khi có kích thước THẬT từ TikTok — không bịa số, không lấy kích thước thumbnail.
 */
export function rewriteDescriptionImages(
  html: string,
  resolve: (ref: DescriptionImageRef) => ResolvedDescriptionImage | null,
): string {
  if (!html) return html;
  let index = 0;
  return html.replace(IMG_TAG, (tag) => {
    const ref = toRef(tag, index);
    index += 1;

    const resolved = resolve(ref);
    if (!resolved) return tag;

    const attributes = readAttributes(tag);
    const overrides = new Map<string, string>([['src', resolved.url]]);
    if (resolved.width && resolved.width > 0) overrides.set('width', String(resolved.width));
    if (resolved.height && resolved.height > 0) overrides.set('height', String(resolved.height));

    const rendered: string[] = [];
    const written = new Set<string>();
    for (const attribute of attributes) {
      const override = overrides.get(attribute.name);
      if (override !== undefined && !written.has(attribute.name)) {
        rendered.push(`${attribute.name}="${escapeAttribute(override)}"`);
        written.add(attribute.name);
      } else if (override === undefined) {
        rendered.push(attribute.raw);
      }
      // Thuộc tính trùng tên (src ghi hai lần) chỉ giữ lần đầu — HTML cũng chỉ đọc lần đầu.
    }
    for (const [name, value] of overrides) {
      if (!written.has(name)) rendered.push(`${name}="${escapeAttribute(value)}"`);
    }

    const selfClosing = /\/>$/.test(tag.trim());
    return `<img ${rendered.join(' ')}${selfClosing ? ' /' : ''}>`;
  });
}

/**
 * Chỉ escape dấu nháy kép — thứ duy nhất phá vỡ thuộc tính. `&` trong URL giữ nguyên: đây là
 * URL TikTok trả về và phải đứng trong `src` đúng như thế.
 */
function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;');
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

/** Hostname của một URL để ghi log (không kèm path/query — không lộ khoá ký trong query string). */
export function hostnameOf(src: string): string {
  try {
    return new URL(src).hostname;
  } catch {
    return classifyImageSource(src).toLowerCase();
  }
}
