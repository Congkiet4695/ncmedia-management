'use client';

import { useState, type ReactNode } from 'react';

interface ItemThumbnailProps {
  /** Ứng viên theo thứ tự ưu tiên — xem `itemThumbnailCandidates`. */
  candidates: string[];
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Placeholder HIỆN CÓ của màn hình gọi — hiện khi không còn ứng viên nào tải được. */
  placeholder: ReactNode;
}

/**
 * Ảnh dòng đơn có fallback: ứng viên đang hiện tải lỗi ⇒ chuyển sang ứng viên kế tiếp; hết ⇒ placeholder.
 *
 * 🔴 Không gán lại `src` trong `onError` (công thức vòng lặp — xem `image-lightbox.tsx`): mỗi lỗi chỉ tăng số ứng
 * viên đã hỏng, và danh sách ứng viên là hữu hạn. Số đếm gắn với danh sách ứng viên, nên dữ liệu đổi (refetch,
 * dòng khác) là bắt đầu lại từ ứng viên đầu.
 */
export function ItemThumbnail({ candidates, alt, className, loading, placeholder }: ItemThumbnailProps) {
  const key = candidates.join('\n');
  const [failure, setFailure] = useState({ key, count: 0 });
  const failedCount = failure.key === key ? failure.count : 0;
  const src = candidates[failedCount];

  if (!src) return <>{placeholder}</>;

  return (
    // Ảnh do TikTok CDN phục vụ, domain đổi theo thị trường ⇒ <img> thay vì next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      // Ảnh TikTok là ảnh gốc cỡ lớn dù chỉ hiện nhỏ: giải mã ngoài luồng chính để không giật khi cuộn.
      decoding="async"
      onError={() => setFailure({ key, count: failedCount + 1 })}
    />
  );
}
