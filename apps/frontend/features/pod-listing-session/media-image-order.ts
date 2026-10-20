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
