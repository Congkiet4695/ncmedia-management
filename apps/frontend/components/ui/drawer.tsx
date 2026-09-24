'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  /** Đóng bằng Escape / nền / nút X. Truyền hàm rỗng khi đang chạy tác vụ không được huỷ. */
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Nội dung phụ ở header (badge trạng thái, tên nhà cung cấp…). */
  headerExtra?: ReactNode;
  children?: ReactNode;
  /** Thanh hành động GHIM ở đáy — luôn thấy dù nội dung dài bao nhiêu. */
  footer?: ReactNode;
  /** Ghi đè bề rộng ở desktop. Mặc định ~560px (yêu cầu UX: 520–700px). */
  className?: string;
}

/**
 * Drawer — tấm trượt từ MÉP PHẢI, dùng cho quy trình nhiều bước ngay cạnh danh sách.
 *
 * ```
 *   ┌─ header  (shrink-0, luôn thấy: tiêu đề · trạng thái · nút đóng)
 *   │  body    (flex-1, min-h-0, overflow-y-auto)   ← chỗ DUY NHẤT được cuộn
 *   └─ footer  (shrink-0, luôn thấy: Huỷ · hành động chính)
 * ```
 *
 * 🔴 Vì sao không dùng Modal cho luồng Fulfill: modal ở giữa màn hình che mất danh sách đơn và
 * buộc phải gói mọi thứ vào một khung nhỏ. Thao tác gửi sản xuất cần ĐỌC nhiều (đơn, sản phẩm,
 * ánh xạ, design, lý do chưa gửi được) rồi mới chọn — drawer cao bằng màn hình, cuộn riêng, và
 * vẫn để người dùng thấy mình đang đứng ở đơn nào.
 *
 * 🔴 `min-h-0` ở vùng body là bắt buộc: mặc định flex item là `min-height:auto` nên nó từ chối
 * co nhỏ hơn nội dung và `overflow-y-auto` sẽ không bao giờ kích hoạt (cùng lý do với `Modal`).
 *
 * 🔴 Khoá cuộn nền khi mở — nếu không, cuộn trong drawer tới đáy sẽ "lây" sang trang phía sau.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  headerExtra,
  children,
  footer,
  className,
}: DrawerProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('action.close')}
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />

      <aside
        className={cn(
          // Mobile/tablet: tràn hết bề ngang. Desktop: 560px — đủ cho bố cục hai cột mà vẫn
          // chừa danh sách đơn phía sau.
          'relative z-10 flex h-full w-full flex-col border-l bg-card shadow-xl sm:w-[560px]',
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="truncate text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            {headerExtra && <div className="mt-2 flex flex-wrap items-center gap-2">{headerExtra}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('action.close')}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Chỗ DUY NHẤT được cuộn — xem chú thích `min-h-0` ở đầu file. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="shrink-0 border-t bg-card px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

/**
 * Một khối nội dung trong drawer: tiêu đề nhỏ + phần thân + **lỗi của đúng khối đó**.
 *
 * 🔴 Lỗi hiện TẠI CHỖ phải sửa, không gom hết lên đầu: người dùng đọc "thiếu ánh xạ sản phẩm"
 * ngay trên khối Sản phẩm thì biết bấm vào đâu; gom lên đầu thì phải tự dò xuống.
 */
export function DrawerSection({
  title,
  action,
  issues,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  /** Câu lỗi thuộc khối này (backend đã phân loại theo `section`). */
  issues?: string[];
  children?: ReactNode;
}) {
  return (
    <section className="space-y-2 border-b pb-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
      {issues && issues.length > 0 && (
        <ul className="space-y-1 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {issues.map((issue, index) => (
            <li key={index} className="flex gap-1.5">
              <span aria-hidden>✕</span>
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
