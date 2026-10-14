'use client';

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** `right`: nhãn của icon trong sidebar thu gọn — hiện ngang hàng, không che menu kế bên. */
type Side = 'top' | 'bottom' | 'right';

interface TooltipProps {
  /** Nội dung tooltip. Rỗng/undefined ⇒ không gắn gì, trả về nguyên trigger. */
  content?: ReactNode;
  children: ReactNode;
  side?: Side;
  className?: string;
}

/** Khoảng cách giữa trigger và tooltip. */
const OFFSET = 6;

/**
 * Tooltip — không phụ thuộc Radix, theo đúng quy ước của `modal.tsx`.
 *
 * 🔴 Render qua **portal + `position: fixed`**, không phải absolute trong luồng.
 * Bảng đơn hàng nằm trong `overflow-x-auto`; một tooltip absolute sẽ bị CẮT ngay tại mép
 * vùng cuộn — đúng chỗ nó cần hiện nhất (cột cuối, tiêu đề sản phẩm dài).
 *
 * Hiện khi hover VÀ khi focus bằng bàn phím: người dùng chỉ dùng phím Tab vẫn đọc được
 * nhãn của các nút chỉ-có-icon ở cột Action. Trên màn hình cảm ứng (không có hover) thì CHẠM
 * vào trigger để mở. Đóng bằng Esc, chạm ra ngoài hoặc cuộn trang — tooltip `fixed` không
 * được trôi lệch khỏi trigger khi bảng cuộn.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // 🔴 Wrapper là `display: contents` (không có hộp layout) ⇒ `getBoundingClientRect()` của chính nó luôn
    // là 0×0 tại (0,0) và tooltip bị đẩy ra ngoài góc trên-trái màn hình. Đo NỘI DUNG bên trong bằng Range.
    const range = document.createRange();
    range.selectNodeContents(trigger);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setBox(
      side === 'right'
        ? { top: rect.top + rect.height / 2, left: rect.right + OFFSET }
        : { top: side === 'top' ? rect.top - OFFSET : rect.bottom + OFFSET, left: rect.left + rect.width / 2 },
    );
  }, [side]);

  const hide = useCallback(() => setBox(null), []);
  const open = box !== null;

  // Chạm: không có mouseenter đáng tin cậy ⇒ mở theo pointerdown của ngón tay.
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLSpanElement>) => {
      if (event.pointerType === 'touch') show();
    },
    [show],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onOutside = (event: Event) => {
      if (!triggerRef.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, hide]);

  if (!content) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        aria-describedby={box ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onPointerDown={onPointerDown}
        className="contents"
      >
        {children}
      </span>

      {box &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              top: box.top,
              left: box.left,
              transform: side === 'right' ? 'translate(0, -50%)' : `translate(-50%, ${side === 'top' ? '-100%' : '0'})`,
            }}
            className={cn(
              'pointer-events-none fixed z-[60] max-w-xs rounded-md bg-foreground px-2.5 py-1.5',
              'text-xs leading-snug text-background shadow-lg',
              className,
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
