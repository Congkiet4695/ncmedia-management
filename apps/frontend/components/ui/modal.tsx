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
  /**
   * Vùng hành động GHIM ở đáy (Cancel / Save…).
   *
   * 🔴 Bỏ trống thì nút vẫn nằm trong `children` và cuộn theo nội dung — chấp nhận được với
   * dialog ngắn. Dialog dài BẮT BUỘC dùng prop này: nút Save nằm cuối một khối cuộn dài sẽ
   * bị khuất khỏi màn hình, và người dùng không có cách nào biết là phải cuộn tiếp.
   *
   * Nút submit đặt ở đây nằm NGOÀI thẻ `<form>` của body, nên phải nối lại bằng thuộc tính
   * `form="<id>"` — xem `MappingFormDialog`.
   */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal — dialog tối giản (overlay + content), không phụ thuộc Radix.
 * Đóng bằng Escape / click backdrop / nút X. Khóa scroll nền khi mở.
 *
 * 🔴 **Chiều cao luôn nằm trong viewport.** Bố cục là một cột flex:
 *
 * ```
 *   ┌─ header  (shrink-0, luôn thấy)
 *   │  body    (flex-1, min-h-0, overflow-y-auto)   ← chỗ duy nhất được cuộn
 *   └─ footer  (shrink-0, luôn thấy)
 * ```
 *
 * Trước đây modal không có trần chiều cao: nội dung dài hơn màn hình thì phần dưới — kể cả
 * nút Save — bị đẩy ra ngoài viewport, và vì nền đã bị khoá cuộn nên KHÔNG có cách nào với
 * tới. Người dùng phải thu nhỏ zoom trình duyệt mới bấm được nút.
 *
 * 🔴 `min-h-0` trên vùng body là bắt buộc, không phải trang trí: mặc định của flex item là
 * `min-height:auto`, nghĩa là nó từ chối co nhỏ hơn nội dung và `overflow-y-auto` sẽ không
 * bao giờ kích hoạt.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
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
    <div
      // `!m-0`: modal thường nằm trong khối `space-y-*` của trang — margin-top của khối đó đẩy lớp
      // `fixed inset-0` lệch xuống, hở một dải không bị phủ ở mép trên màn hình.
      className="fixed inset-0 z-50 !m-0 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label={t('action.close')}
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        className={cn(
          // `max-h-[calc(100vh-4rem)]` chừa đúng phần padding 1rem của khung ngoài ở cả hai
          // phía cộng một khoảng thở — dialog không bao giờ chạm mép màn hình.
          'relative z-10 flex max-h-[calc(100vh-4rem)] w-full max-w-lg flex-col',
          'overflow-hidden rounded-2xl border bg-card shadow-xl',
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('action.close')}
          className="absolute right-4 top-4 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>

        {(title || description) && (
          <div className="shrink-0 border-b px-6 pb-4 pt-6">
            {title && <h2 className="pr-6 text-lg font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        )}

        {/* Chỗ DUY NHẤT được cuộn. `min-h-0` để flex item chịu co lại — xem chú thích ở trên. */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-4', !title && !description && 'pt-6')}>
          {children}
        </div>

        {footer && <div className="shrink-0 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
