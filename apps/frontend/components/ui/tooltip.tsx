'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Side = 'top' | 'bottom';

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
 * nhãn của các nút chỉ-có-icon ở cột Action.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({
      top: side === 'top' ? rect.top - OFFSET : rect.bottom + OFFSET,
      left: rect.left + rect.width / 2,
    });
  }, [side]);

  const hide = useCallback(() => setBox(null), []);

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
              transform: `translate(-50%, ${side === 'top' ? '-100%' : '0'})`,
            }}
            className={cn(
              'pointer-events-none fixed z-[60] max-w-xs rounded-md bg-foreground px-2 py-1',
              'text-xs leading-snug text-background shadow-md',
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
