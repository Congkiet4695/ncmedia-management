'use client';

import { useEffect } from 'react';
import { clampPage } from '@/lib/pagination';
import type { PaginationMeta } from '@/types/api';

/**
 * Đưa trang hiện tại về khoảng hợp lệ khi tổng số trang CO LẠI.
 *
 * 🔴 Trường hợp thật: người dùng đang ở trang 3, xoá nốt record cuối cùng của trang đó.
 * Backend trả `totalPages = 2`, danh sách rỗng, còn giao diện vẫn ghi "Page 3 of 2" — bảng
 * trống trơn mà chẳng có gì sai để bấm. Hook này bắt đúng khoảnh khắc đó và lùi về trang 2.
 *
 * Không đụng tới trường hợp `total = 0`: danh sách rỗng thật thì `clampPage` trả về 1 và
 * empty state của màn hình lo phần còn lại.
 *
 * Dùng ngay sau query:
 *
 * ```ts
 * const meta = query.data?.meta;
 * useClampedPage(meta, (page) => patchQuery({ page }));
 * ```
 */
export function useClampedPage(
  meta: PaginationMeta | null | undefined,
  onPageChange: (page: number) => void,
): void {
  const page = meta?.page;
  const totalPages = meta?.totalPages;

  useEffect(() => {
    if (page === undefined || totalPages === undefined) return;

    const next = clampPage(page, totalPages);
    if (next !== page) onPageChange(next);
    // `onPageChange` thường là hàm inline ở trang cha, đưa vào deps sẽ chạy lại mỗi render.
    // Chỉ `meta` mới là tín hiệu thật sự cần phản ứng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages]);
}
