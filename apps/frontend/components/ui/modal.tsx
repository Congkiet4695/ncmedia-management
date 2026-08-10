'use client';

import { useTranslation } from 'react-i18next';
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Modal — dialog tối giản (overlay + content), không phụ thuộc Radix.
 * Đóng bằng Escape / click backdrop / nút X. Khóa scroll nền khi mở.
 */
export function Modal({ open, onClose, title, description, children, className }: ModalProps) {
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('action.close')}
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg',
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('action.close')}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        {title && <h2 className="pr-6 text-lg font-semibold">{title}</h2>}
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
