'use client';

import { useEffect, useRef, useState } from 'react';
import { createPageScrollGate, shouldScrollToTableTop } from '@/lib/pagination';

/**
 * Cuộn tới ĐẦU BẢNG (không phải đầu trang) khi người dùng chuyển trang bằng điều khiển phân trang.
 *
 * ```tsx
 * const { ref, arm } = usePageChangeScroll<HTMLDivElement>(query.page);
 * <div ref={ref} className="scroll-mt-20">…bảng…</div>
 * <DataPagination onPageChange={(next) => { arm(next); patchQuery({ page: next }); }} />
 * ```
 *
 * - Trang dùng window scroll (layout không có vùng `overflow-y-auto` riêng) ⇒ `scrollIntoView` trên chính phần tử;
 *   `scroll-margin-top` của phần tử chừa chỗ cho header sticky.
 * - Cuộn trong effect SAU khi trang mới đã commit — dữ liệu trang mới về chậm thì bảng vẫn giữ hàng cũ
 *   (keepPreviousData) và người dùng đã đứng sẵn ở đầu bảng khi hàng mới hiện ra; không phụ thuộc thời điểm API trả.
 * - Không ref ⇒ không làm gì (không dùng selector DOM toàn cục). Tôn trọng `prefers-reduced-motion`.
 */
export function usePageChangeScroll<T extends HTMLElement>(page: number | undefined) {
  const ref = useRef<T>(null);
  const [gate] = useState(createPageScrollGate);

  useEffect(() => {
    if (page === undefined || !gate.consume(page)) return;
    const node = ref.current;
    if (!node) return;
    const margin = Number.parseFloat(window.getComputedStyle(node).scrollMarginTop) || 0;
    if (!shouldScrollToTableTop(node.getBoundingClientRect().top, margin, window.innerHeight)) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [page, gate]);

  return { ref, arm: gate.arm };
}
