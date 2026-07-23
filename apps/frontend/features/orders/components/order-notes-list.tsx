'use client';

import { ORDER_NOTE_TYPE_LABELS } from '../schemas/order.schema';
import type { OrderNote, OrderNoteType } from '../types';

interface OrderNotesListProps {
  notes: OrderNote[];
  /** Giới hạn số dòng mỗi nhóm (mặc định không giới hạn). */
  max?: number;
}

const TYPE_ORDER: OrderNoteType[] = ['SELLER', 'WAREHOUSE'];

/**
 * Hiển thị ghi chú Order dạng danh sách bullet, gom nhóm theo loại:
 *   Seller • ...
 *   Warehouse • ...
 * Chỉ đọc — dùng cho Order List (thêm/sửa/xóa ở trang chi tiết).
 */
export function OrderNotesList({ notes, max }: OrderNotesListProps) {
  if (!notes || notes.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-1.5 text-xs">
      {TYPE_ORDER.map((type) => {
        const group = notes.filter((n) => n.type === type);
        if (group.length === 0) return null;
        const shown = max ? group.slice(0, max) : group;
        const hidden = group.length - shown.length;
        return (
          <div key={type}>
            <span className="font-medium text-foreground">{ORDER_NOTE_TYPE_LABELS[type]}</span>
            <ul className="mt-0.5 space-y-0.5">
              {shown.map((n) => (
                <li key={n.id} className="flex gap-1 text-muted-foreground">
                  <span aria-hidden>•</span>
                  <span className="whitespace-pre-wrap break-words">{n.content}</span>
                </li>
              ))}
              {hidden > 0 && (
                <li className="text-muted-foreground/70">+{hidden} ghi chú khác…</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
