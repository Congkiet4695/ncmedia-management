'use client';

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableHead } from '@/components/ui/table';
import { usePageSelection, type PageSelection } from '@/hooks/use-page-selection';
import type { PodTemplateQuery } from '../types';

/**
 * Chọn từng row của 4 tab template (Category · SKU · Description · Image) để Export CSV.
 *
 * - Không chọn sẵn gì; "chọn tất cả" chỉ là các row ĐANG HIỆN của trang (`usePageSelection`).
 * - 🔴 Đổi tìm kiếm / bộ lọc / trang / page size ⇒ BỎ HẾT lựa chọn: id cũ đang ẩn không được âm thầm nằm
 *   lại để rồi bị export cùng.
 * - Dữ liệu tải lại (refresh) mà row đã chọn biến mất ⇒ tự rơi khỏi `selectedIds` (chỉ tính row đang hiện).
 */
export function useTemplateRowSelection(
  items: Array<{ id: string }>,
  query: PodTemplateQuery,
): PageSelection {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const selection = usePageSelection(ids);
  const { clear } = selection;
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    clear();
  }, [queryKey, clear]);

  return selection;
}

/** Ô "chọn tất cả row của trang" ở đầu bảng. */
export function SelectAllRowsHead({ selection }: { selection: PageSelection }) {
  const { t } = useTranslation('pod');
  return (
    <TableHead className="w-10">
      <Checkbox
        checked={selection.allSelected}
        indeterminate={selection.someSelected}
        onChange={selection.togglePage}
        aria-label={t('listing.transfer.selectPage')}
      />
    </TableHead>
  );
}

/** Ô chọn một row. */
export function SelectRowCell({ selection, id, label }: { selection: PageSelection; id: string; label: string }) {
  const { t } = useTranslation('pod');
  return (
    <TableCell className="w-10">
      <Checkbox
        checked={selection.isSelected(id)}
        onChange={() => selection.toggleRow(id)}
        aria-label={t('listing.transfer.selectRow', { name: label })}
      />
    </TableCell>
  );
}
