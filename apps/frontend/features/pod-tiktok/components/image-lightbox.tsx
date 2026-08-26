'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Một ảnh trong bộ xem — `label` hiện ở thanh dưới để biết đang xem cái gì. */
export interface LightboxImage {
  src: string;
  label?: string;
  /** Tên file gợi ý khi tải về. Bỏ trống thì suy từ URL. */
  fileName?: string;
}

interface ImageLightboxProps {
  open: boolean;
  /** Xem MỘT ảnh. Dùng khi không có bộ ảnh để đi tới đi lui. */
  src?: string | null;
  /** Xem một BỘ ảnh, có next/previous. Được ưu tiên hơn `src`. */
  images?: LightboxImage[];
  /** Vị trí ảnh mở đầu trong `images`. */
  startIndex?: number;
  alt?: string;
  onClose: () => void;
}

/** Mức phóng to khi bấm vào ảnh. Hai mức là đủ — nhiều mức hơn cần thanh trượt. */
const ZOOM_LEVELS = [1, 2] as const;

/**
 * ImageLightbox — xem ảnh cỡ lớn: **design in** và **ảnh sản phẩm** dùng CHUNG component này.
 *
 * 🔴 Một component cho cả hai, không phải hai. Trước đây chỉ design mới bấm xem to được, còn
 * bấm vào ảnh sản phẩm thì không có gì xảy ra — mà người dùng thì không có cách nào đoán ra
 * quy tắc đó. Dựng thêm một bộ xem riêng cho sản phẩm sẽ để lại hai hành vi lệch nhau ngay
 * lần sửa tiếp theo.
 *
 * Hỗ trợ: phóng to (bấm ảnh hoặc nút), đi tới/lui khi có nhiều ảnh, tải về.
 * Bàn phím: `Esc` đóng · `←` `→` chuyển ảnh.
 *
 * Đóng bằng Escape / click nền / nút X. Khoá scroll nền khi mở.
 */
export function ImageLightbox({
  open,
  src,
  images,
  startIndex = 0,
  alt,
  onClose,
}: ImageLightboxProps) {
  const { t } = useTranslation();

  // Một nguồn dữ liệu duy nhất cho cả hai cách gọi: `images` (bộ) và `src` (một ảnh).
  const items = useMemo<LightboxImage[]>(() => {
    if (images && images.length > 0) return images;
    return src ? [{ src, label: alt }] : [];
  }, [images, src, alt]);

  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(0);

  // Mở lại (hoặc bấm sang ảnh khác từ ngoài) ⇒ về đúng ảnh được yêu cầu và bỏ phóng to.
  useEffect(() => {
    if (!open) return;
    setIndex(startIndex);
    setZoom(0);
  }, [open, startIndex, src]);

  const count = items.length;
  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      // Quay vòng: từ ảnh cuối bấm tiếp về ảnh đầu — không có ngõ cụt.
      setIndex((current) => (current + delta + count) % count);
      setZoom(0);
    },
    [count],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, go]);

  if (!open || count === 0) return null;

  const current = items[Math.min(index, count - 1)];
  const scale = ZOOM_LEVELS[zoom];
  const zoomedIn = zoom > 0;

  /**
   * Tên file khi tải về. Suy từ URL nếu nơi gọi không đặt tên — vẫn hơn là để trình duyệt
   * lưu thành `download` không đuôi.
   */
  const downloadName =
    current.fileName ?? decodeURIComponent(current.src.split('?')[0].split('/').pop() || 'image');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={current.label ?? alt ?? t('image.viewLarge')}
    >
      <button
        type="button"
        aria-label={t('action.close')}
        className="absolute inset-0 cursor-zoom-out bg-black/80"
        onClick={onClose}
      />

      {/* Thanh công cụ */}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => setZoom((z) => (z + 1) % ZOOM_LEVELS.length)}
          aria-label={zoomedIn ? t('image.zoomOut') : t('image.zoomIn')}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          {zoomedIn ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
        </button>
        {/* Tải về: ảnh nằm trên CDN khác origin nên `download` có thể bị trình duyệt bỏ qua
            và chuyển thành mở tab mới. Vẫn hơn là không có đường tải nào. */}
        <a
          href={current.src}
          download={downloadName}
          target="_blank"
          rel="noreferrer"
          aria-label={t('image.download')}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          <Download className="size-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('action.close')}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Điều hướng — chỉ hiện khi thực sự có nhiều hơn một ảnh. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t('action.previous')}
            className="absolute left-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t('action.next')}
            className="absolute right-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <ChevronRight className="size-6" />
          </button>
        </>
      )}

      {/* Ảnh — bấm để phóng to/thu nhỏ. Bọc trong khối cuộn để ảnh đã phóng vẫn xem hết được. */}
      <div
        className="relative z-[1] flex max-h-[88vh] max-w-[92vw] overflow-auto"
        // Chặn sự kiện lan ra nền, nếu không bấm vào ảnh sẽ đóng luôn lightbox.
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.label ?? alt ?? 'Image'}
          onClick={() => setZoom((z) => (z + 1) % ZOOM_LEVELS.length)}
          style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
          className={`max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl transition-transform ${
            zoomedIn ? 'cursor-zoom-out' : 'cursor-zoom-in'
          }`}
        />
      </div>

      {/* Nhãn + vị trí trong bộ ảnh */}
      {(current.label || count > 1) && (
        <div className="absolute bottom-4 z-10 rounded-full bg-black/60 px-4 py-1.5 text-sm text-white">
          {current.label}
          {current.label && count > 1 ? ' · ' : ''}
          {count > 1 ? `${index + 1}/${count}` : ''}
        </div>
      )}
    </div>
  );
}
