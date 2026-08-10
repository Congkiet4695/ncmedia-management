'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ImageLightboxProps {
  open: boolean;
  src: string | null;
  alt?: string;
  onClose: () => void;
}

/**
 * ImageLightbox — xem ảnh cỡ lớn khi click thumbnail.
 * Đóng bằng Escape / click nền / nút X. Khoá scroll nền khi mở.
 */
export function ImageLightbox({ open, src, alt, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t('image.viewLarge')}
    >
      <button
        type="button"
        aria-label={t('action.close')}
        className="absolute inset-0 cursor-zoom-out bg-black/80"
        onClick={onClose}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={t('action.close')}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
      >
        <X className="size-5" />
      </button>
      {/* Ảnh do người dùng upload — dùng <img> để không phụ thuộc cấu hình next/image remotePatterns. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? 'Design'}
        className="relative z-[1] max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
