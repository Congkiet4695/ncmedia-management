import sharp from 'sharp';

/** Cạnh dài tối đa (px). Đủ cho ô 36px và cả ảnh phóng to khi hover (256px); thường chỉ vài chục KB. */
export const STORAGE_THUMBNAIL_MAX_SIZE = 384;
export const STORAGE_THUMBNAIL_MIME = 'image/webp';
/** Object key mới mỗi file nên nội dung không bao giờ đổi. */
export const STORAGE_THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Trần điểm ảnh khi giải mã (mặc định của sharp), chặn ảnh bung ra hết RAM. */
const MAX_INPUT_PIXELS = 268_402_689;
/** File in có thể gần 100 MP: chỉ thu nhỏ MỘT ảnh một lúc để RAM server không cộng dồn khi nhiều upload cùng lúc. */
let queue: Promise<unknown> = Promise.resolve();

/** Bản thu nhỏ WEBP giữ tỉ lệ và nền trong suốt. File không phải ảnh giải mã được ⇒ throw. */
export function createThumbnail(source: Buffer): Promise<Buffer> {
  const run = queue.then(() =>
    sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
      .rotate()
      .resize(STORAGE_THUMBNAIL_MAX_SIZE, STORAGE_THUMBNAIL_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer(),
  );
  queue = run.catch(() => undefined);
  return run;
}

export const thumbnailObjectKey = (objectKey: string): string => `${objectKey}.thumb.webp`;
