/**
 * Luật thuần của ô **Images** trong "Edit draft product" (dán ảnh từ clipboard + kéo thả sắp xếp) — không React
 * ⇒ kiểm bằng `npm run test:draft-images`.
 *
 * 🔴 Thứ tự ảnh = thứ tự MẢNG; lưu đi với `sortOrder = index`, mở lại sắp theo `sortOrder` (backend). Ảnh ĐẦU TIÊN
 * là thumbnail và ảnh đầu của listing — không có cờ thumbnail riêng nào để lệch.
 */
import { normalizeImageUrl } from './media-image-order';
import type { PodSessionImageType } from './types';

/** Một ảnh gốc của Draft Product đang sửa. Giữ `fileId` / `imageType` của ảnh cũ để lưu lại KHÔNG mất liên kết. */
export interface DraftImage {
  imageUrl: string;
  /** File trong Storage (ảnh dán / tải lên). Ảnh chỉ có URL thì không có. */
  fileId?: string;
  imageType?: PodSessionImageType;
}

/** Phần của `ClipboardEvent.clipboardData` cần đọc — tách ra để kiểm không cần trình duyệt. */
export interface ClipboardLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }> | null;
  files?: ArrayLike<File> | null;
}

/**
 * Các FILE ẢNH trong clipboard. Rỗng ⇒ clipboard không có ảnh ⇒ người gọi KHÔNG được chặn thao tác dán (dán chữ
 * vào ô nhập phải chạy như bình thường).
 *
 * Đọc `items` trước (Chrome/Edge/Firefox: ảnh chụp màn hình, "Copy image"); `files` là đường dự phòng (Safari / dán
 * file từ Finder). Không lấy cả hai ⇒ không nhân đôi một ảnh.
 */
export function clipboardImageFiles(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'));
}

export type RejectedImageReason = 'TYPE' | 'SIZE';

export interface ImageUploadPlan {
  /** Được tải lên (đúng định dạng, đúng dung lượng, còn chỗ). */
  accepted: File[];
  /** Sai định dạng / quá dung lượng — báo rõ từng file, không tải. */
  rejected: Array<{ file: File; reason: RejectedImageReason }>;
  /** Số file hợp lệ bị bỏ vì hết chỗ — người gọi PHẢI báo (không được im lặng bỏ ảnh). */
  overflow: number;
  /** Danh sách đã đủ trần từ trước ⇒ không nhận thêm ảnh nào. */
  full: boolean;
}

/** Quyết định ảnh nào được tải lên — kiểm định dạng / dung lượng trước, rồi mới tính chỗ trống. */
export function planImageUploads(
  files: readonly File[],
  currentCount: number,
  max: number,
  rules: { types: readonly string[]; maxBytes: number },
): ImageUploadPlan {
  const room = Math.max(0, max - currentCount);
  const rejected: ImageUploadPlan['rejected'] = [];
  const valid: File[] = [];
  for (const file of files) {
    if (!rules.types.includes(file.type)) rejected.push({ file, reason: 'TYPE' });
    else if (file.size > rules.maxBytes) rejected.push({ file, reason: 'SIZE' });
    else valid.push(file);
  }
  return {
    accepted: valid.slice(0, room),
    rejected,
    overflow: Math.max(0, valid.length - room),
    full: room === 0,
  };
}

/** Ảnh đã có trong danh sách chưa — cùng `fileId`, hoặc cùng URL (bỏ qua khác biệt hình thức). */
export function hasImage(images: readonly DraftImage[], candidate: DraftImage): boolean {
  return images.some((image) =>
    image.fileId && candidate.fileId
      ? image.fileId === candidate.fileId
      : normalizeImageUrl(image.imageUrl) === normalizeImageUrl(candidate.imageUrl),
  );
}

/**
 * Nối ảnh mới vào CUỐI danh sách — bỏ ảnh trùng, không vượt trần. Trả về cả số ảnh bị bỏ để người gọi báo.
 * Không đổi vị trí ảnh đang có: ảnh đầu tiên là thumbnail, chèn lên đầu là âm thầm đổi thumbnail.
 */
export function appendImages(
  images: readonly DraftImage[],
  additions: readonly DraftImage[],
  max: number,
): { images: DraftImage[]; duplicates: number; overflow: number } {
  const next = [...images];
  let duplicates = 0;
  let overflow = 0;
  for (const image of additions) {
    if (hasImage(next, image)) duplicates += 1;
    else if (next.length >= max) overflow += 1;
    else next.push(image);
  }
  return { images: next, duplicates, overflow };
}

/** Payload ảnh gửi backend: `sortOrder = index` (thứ tự hiển thị), giữ `fileId` / `imageType` nếu có. */
export function toImagePayload(
  images: readonly DraftImage[],
): Array<{
  imageUrl: string;
  sortOrder: number;
  fileId?: string;
  imageType?: PodSessionImageType;
}> {
  return images.map((image, index) => ({
    imageUrl: image.imageUrl,
    sortOrder: index,
    ...(image.fileId ? { fileId: image.fileId } : {}),
    ...(image.imageType ? { imageType: image.imageType } : {}),
  }));
}
