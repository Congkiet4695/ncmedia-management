'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  /** Phần tử mở menu (thường là một Button icon). */
  trigger: ReactNode;
  children: ReactNode;
  /** Canh mép phải của menu theo mép phải trigger — mặc định cho cột Action ở cuối bảng. */
  align?: 'start' | 'end';
  className?: string;
}

const OFFSET = 4;
const MENU_WIDTH = 208; // w-52

/**
 * Dropdown Menu — không phụ thuộc Radix, cùng quy ước với `modal.tsx` / `tooltip.tsx`.
 *
 * 🔴 Portal + `position: fixed` vì lý do giống Tooltip: menu của cột Action nằm sát mép phải
 * một bảng `overflow-x-auto`, render trong luồng là bị cắt mất một nửa.
 *
 * Đóng khi: click ra ngoài · Escape · cuộn trang · đổi kích thước cửa sổ. Ba trường hợp sau
 * quan trọng vì toạ độ đã được chốt lúc mở — không đóng thì menu sẽ trôi khỏi nút của nó.
 */
export function DropdownMenu({ trigger, children, align = 'end', className }: DropdownMenuProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => setBox(null), []);

  const toggle = useCallback(() => {
    if (box) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Kẹp trong viewport để menu không tràn ra ngoài màn hình hẹp.
    const rawLeft = align === 'end' ? rect.right - MENU_WIDTH : rect.left;
    setBox({
      top: rect.bottom + OFFSET,
      left: Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, [align, box, close]);

  useEffect(() => {
    if (!box) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // `capture` để bắt được cả cuộn bên trong vùng overflow của bảng, không chỉ cuộn trang.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [box, close]);

  return (
    <>
      <div
        ref={triggerRef}
        onClick={toggle}
        className="inline-flex"
        aria-haspopup="menu"
        aria-expanded={Boolean(box)}
      >
        {trigger}
      </div>

      {box &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: box.top, left: box.left, width: MENU_WIDTH }}
            className={cn(
              'fixed z-50 overflow-hidden rounded-md border bg-popover p-1 shadow-md',
              className,
            )}
            // Chọn xong là đóng — không có mục nào của màn hình này cần giữ menu mở.
            onClick={close}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

interface DropdownMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Mục nguy hiểm (xoá, huỷ) — tô đỏ. */
  destructive?: boolean;
  className?: string;
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" role="separator" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
