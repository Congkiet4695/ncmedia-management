'use client';

import { useCallback, useMemo, useState } from 'react';

export interface PageSelection {
  /** Id ĐANG được chọn trong số các dòng đang hiện và chọn được — chỉ tập này được gửi lên server. */
  selectedIds: string[];
  /** Mọi dòng chọn được của trang hiện tại đều đã được chọn. */
  allSelected: boolean;
  /** Đã chọn một phần (cho trạng thái "indeterminate" của ô chọn-tất-cả). */
  someSelected: boolean;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  /** Chọn / bỏ chọn MỌI dòng chọn được của TRANG HIỆN TẠI. */
  togglePage: () => void;
  /** Bỏ các id khỏi lựa chọn (vd sau khi đã xoá xong). */
  forget: (ids: string[]) => void;
}

/**
 * Lựa chọn nhiều dòng trên MỘT trang danh sách có phân trang / bộ lọc.
 *
 * 🔴 "Chọn tất cả" chỉ là tất cả dòng chọn được ĐANG HIỆN trên trang — không bao giờ là "mọi bản ghi
 * khớp bộ lọc" hay "cả database". Đổi trang / bộ lọc ⇒ dòng cũ không còn hiện thì không còn được tính,
 * nên một thao tác hàng loạt không thể vô tình chạm tới thứ người dùng không nhìn thấy.
 */
export function usePageSelection(selectableIds: string[]): PageSelection {
  const [selected, setSelected] = useState<string[]>([]);

  const selectedIds = useMemo(
    () => selected.filter((id) => selectableIds.includes(id)),
    [selected, selectableIds],
  );
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const visible = prev.filter((id) => selectableIds.includes(id));
      const everyVisibleSelected =
        selectableIds.length > 0 && visible.length === selectableIds.length;
      return everyVisibleSelected
        ? prev.filter((id) => !selectableIds.includes(id))
        : [...new Set([...prev, ...selectableIds])];
    });
  }, [selectableIds]);

  const forget = useCallback((ids: string[]) => {
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
  }, []);

  return {
    selectedIds,
    allSelected,
    someSelected: selectedIds.length > 0 && !allSelected,
    isSelected: (id: string) => selectedIds.includes(id),
    toggleRow,
    togglePage,
    forget,
  };
}
