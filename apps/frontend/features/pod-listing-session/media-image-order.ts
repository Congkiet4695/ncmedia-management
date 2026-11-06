/**
 * Luật thuần của danh sách **Product Images** (kéo thả sắp xếp + thêm bằng URL) — không React ⇒ kiểm bằng
 * `npm run test:media-images`.
 *
 * 🔴 Thứ tự ảnh = thứ tự MẢNG. Payload submit lấy `sortOrder = index` (`buildImages`), mở lại nháp sắp theo
 * `sortOrder` ⇒ kéo thả chỉ cần đổi mảng, không có trường thứ tự riêng nào để lệch.
 */

/** Phần của một ảnh mà các hàm dưới cần đọc. */
export interface OrderedImage {
  imageUrl: string;
  fileId?: string;
  uri?: string;
}

/**
 * Khoá ỔN ĐỊNH cho từng ảnh (React key + id kéo thả). Không dùng index: index đổi theo mỗi lần kéo, React và
 * thư viện kéo thả sẽ nhầm ảnh này với ảnh kia. Hai ảnh trùng hệt nhau (hiếm) nhận hậu tố theo thứ tự xuất hiện.
 */
export function imageKeys(images: readonly OrderedImage[]): string[] {
  const seen = new Map<string, number>();
  return images.map((image, index) => {
    const base = image.fileId || image.uri || image.imageUrl || `empty-${index}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

/** Chuyển ảnh ở `from` tới vị trí `to` (các ảnh khác giữ thứ tự tương đối). Không xoá, không nhân đôi. */
export function moveImage<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * URL vừa nhập so với danh sách ảnh HIỆN TẠI:
 * - `PRESENT`: ảnh đang nằm trong danh sách (khớp URL lưu trữ, hoặc khớp file đã tải về từ URL này).
 * - `REMOVED`: đã tải về trong lần mở form này nhưng không còn trong danh sách (người dùng xoá, hoặc áp Image Template
 *   thay cả bộ ảnh). File vẫn còn trong Storage ⇒ đưa lại được mà không tải lại.
 * - `NEW`: chưa từng biết ⇒ đi đường tải về và kiểm tra của server như bình thường.
 */
export type ImageUrlState<T> =
  | { status: 'PRESENT'; index: number }
  | { status: 'REMOVED'; image: T }
  | { status: 'NEW' };

export function classifyImageUrl<T extends OrderedImage>(
  url: string,
  images: readonly T[],
  remembered: ReadonlyMap<string, T>,
): ImageUrlState<T> {
  const key = normalizeImageUrl(url);
  const known = remembered.get(key);
  const index = images.findIndex(
    (image) => normalizeImageUrl(image.imageUrl) === key || (known !== undefined && isSameImage(image, known)),
  );
  if (index >= 0) return { status: 'PRESENT', index };
  return known ? { status: 'REMOVED', image: known } : { status: 'NEW' };
}

function isSameImage(a: OrderedImage, b: OrderedImage): boolean {
  if (a.fileId || b.fileId) return a.fileId === b.fileId;
  return a.imageUrl !== '' && normalizeImageUrl(a.imageUrl) === normalizeImageUrl(b.imageUrl);
}

/**
 * Đưa ảnh đã gỡ trở lại CUỐI danh sách. Ảnh đang có thì giữ nguyên danh sách: ảnh đầu tiên là ảnh chính, nên đổi thứ tự ở
 * đây là âm thầm đổi ảnh chính. Hết chỗ thì giữ nguyên. Không có khái niệm "vị trí cũ" nên không đoán vị trí.
 */
export function readdImage<T extends OrderedImage>(images: readonly T[], image: T, max: number): T[] {
  if (images.some((entry) => isSameImage(entry, image)) || images.length >= max) return [...images];
  return [...images, image];
}

/** Tối đa ký tự một URL — khớp `POD_LISTING_IMAGE_URL_MAX_LENGTH` của backend. */
export const IMAGE_URL_MAX_LENGTH = 2048;

export type ImageUrlProblem = 'INVALID' | 'NOT_HTTP' | 'TOO_LONG';

/**
 * Tách ô nhập thành các URL (dán nhiều link cách nhau bởi xuống dòng / khoảng trắng / dấu phẩy) và kiểm HÌNH
 * THỨC. Hàng rào thật (IP nội bộ, redirect, có phải ảnh không) nằm ở backend — đây chỉ để báo sớm lỗi gõ.
 */
export function parseImageUrls(raw: string): Array<{ url: string; problem: ImageUrlProblem | null }> {
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((url) => ({ url, problem: imageUrlProblem(url) }));
}

function imageUrlProblem(url: string): ImageUrlProblem | null {
  if (url.length > IMAGE_URL_MAX_LENGTH) return 'TOO_LONG';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'INVALID';
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? null : 'NOT_HTTP';
}

/** Lỗi hình thức của ô nhập URL cho MỘT giá trị biến thể. */
export type SingleImageUrlProblem = ImageUrlProblem | 'EMPTY' | 'MULTIPLE';

/** Ô URL của một giá trị biến thể nhận đúng MỘT link. Trả về link đã trim, hoặc lý do từ chối. */
export function checkSingleImageUrl(
  raw: string,
): { url: string; problem: null } | { url: null; problem: SingleImageUrlProblem } {
  const parsed = parseImageUrls(raw);
  if (parsed.length === 0) return { url: null, problem: 'EMPTY' };
  if (parsed.length > 1) return { url: null, problem: 'MULTIPLE' };
  const [{ url, problem }] = parsed;
  return problem ? { url: null, problem } : { url, problem: null };
}

/** File đã được server tải về từ URL và lưu Storage. */
export interface ImportedVariationImage {
  fileId: string;
  url: string | null;
}

/**
 * Trạng thái ô URL của một giá trị biến thể:
 * `IDLE → LOADING (server tải + kiểm) → PREVIEW (trình duyệt đang tải ảnh) → READY (mới được dùng)`.
 *
 * 🔴 `requestId` chống kết quả về muộn: người dùng đổi URL lúc server còn đang tải thì kết quả của URL cũ phải bị
 * bỏ, không được hiện thành preview của URL mới rồi gắn nhầm vào biến thể.
 */
export interface VariationUrlState {
  input: string;
  status: 'IDLE' | 'LOADING' | 'PREVIEW' | 'READY' | 'ERROR';
  requestId: number;
  image: ImportedVariationImage | null;
  /** Lỗi hình thức (mã để dịch). */
  problem: SingleImageUrlProblem | null;
  /** Lỗi từ server, đã dịch. */
  errorMessage: string | null;
  /** Ảnh tải được về server nhưng trình duyệt không hiển thị được. */
  previewFailed: boolean;
}

export type VariationUrlEvent =
  | { type: 'INPUT'; input: string }
  | { type: 'REJECTED'; problem: SingleImageUrlProblem }
  | { type: 'START'; requestId: number }
  | { type: 'LOADED'; requestId: number; image: ImportedVariationImage }
  | { type: 'FAILED'; requestId: number; message: string }
  | { type: 'PREVIEW_OK'; requestId: number }
  | { type: 'PREVIEW_ERROR'; requestId: number }
  | { type: 'RESET' };

export const EMPTY_VARIATION_URL: VariationUrlState = {
  input: '',
  status: 'IDLE',
  requestId: 0,
  image: null,
  problem: null,
  errorMessage: null,
  previewFailed: false,
};

export function variationUrlReducer(state: VariationUrlState, event: VariationUrlEvent): VariationUrlState {
  const cleared = { image: null, problem: null, errorMessage: null, previewFailed: false };
  switch (event.type) {
    case 'INPUT':
      // Đổi URL ⇒ preview + lỗi cũ không còn đúng. Tăng `requestId` để kết quả đang chờ của URL cũ thành vô hiệu.
      return { ...state, ...cleared, input: event.input, status: 'IDLE', requestId: state.requestId + 1 };
    case 'REJECTED':
      return { ...state, ...cleared, status: 'ERROR', problem: event.problem };
    case 'START':
      return { ...state, ...cleared, status: 'LOADING', requestId: event.requestId };
    case 'LOADED':
      if (event.requestId !== state.requestId) return state;
      // Không có URL công khai ⇒ không có gì để trình duyệt tải; file đã qua kiểm tra chữ ký ở server.
      return { ...state, ...cleared, status: event.image.url ? 'PREVIEW' : 'READY', image: event.image };
    case 'FAILED':
      if (event.requestId !== state.requestId) return state;
      return { ...state, ...cleared, status: 'ERROR', errorMessage: event.message };
    case 'PREVIEW_OK':
      return event.requestId === state.requestId && state.status === 'PREVIEW' ? { ...state, status: 'READY' } : state;
    case 'PREVIEW_ERROR':
      if (event.requestId !== state.requestId) return state;
      return { ...state, ...cleared, status: 'ERROR', previewFailed: true };
    case 'RESET':
      return { ...EMPTY_VARIATION_URL, requestId: state.requestId + 1 };
  }
}

/** Gắn ảnh cho ĐÚNG một giá trị biến thể; ảnh của các giá trị khác giữ nguyên. */
export function setVariationImage<T>(images: Record<string, T>, value: string, image: T): Record<string, T> {
  return { ...images, [value]: image };
}

/** So khớp hai URL ảnh "là một": bỏ `#…`, host chữ thường (đường dẫn / query giữ nguyên — có thể phân biệt ảnh). */
export function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
