'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { ELLIPSIS, PAGE_SIZE_OPTIONS, buildPageRange, getShowingRange } from '@/lib/pagination';
import type { PaginationMeta } from '@/types/api';

interface DataPaginationProps {
  /**
   * `meta` nguyên vẹn từ API (ADR-023). Nhận cả `null`/`undefined` để trang gọi khỏi phải
   * tự chặn lúc query chưa xong.
   */
  meta: PaginationMeta | null | undefined;
  onPageChange: (page: number) => void;
  /**
   * Bỏ trống ⇒ **ẩn ô chọn số dòng**. Dùng cho những chỗ số dòng mỗi trang là cố định
   * theo thiết kế (vd dialog nhỏ chỉ đủ chỗ cho 10 dòng).
   */
  onPageSizeChange?: (limit: number) => void;
  /** Khoá mọi nút trong lúc request đang chạy. */
  disabled?: boolean;
  className?: string;
}

/**
 * DataPagination — thanh phân trang dùng chung cho MỌI bảng/danh sách.
 *
 * ```
 * Showing 1–20 of 42 records          Rows per page [20 ▼]   ‹  1  2  3  ›
 * ```
 *
 * 🔴 Vì sao gom về một component: trước sprint này có **15 khối phân trang chép tay** rải
 * khắp app, mỗi khối chỉ có Previous/Next và mỗi khối một cách hiển thị tổng số. Sửa hành
 * vi phân trang nghĩa là sửa 15 chỗ và chắc chắn bỏ sót vài chỗ.
 *
 * 🔴 Component này KHÔNG chứa nghiệp vụ. Nó không biết đang phân trang cái gì, không tự gọi
 * API, không giữ state. Trang cha sở hữu `page`/`limit` và quyết định điều gì xảy ra khi
 * chúng đổi — đó là chỗ duy nhất biết còn phải reset search/filter gì kèm theo.
 *
 * 🔴 `total === 0` ⇒ **không render gì**. Danh sách rỗng đã có empty state riêng của từng
 * màn hình; thêm "Page 1 of 0" bên dưới chỉ làm người dùng tưởng giao diện hỏng.
 */
export function DataPagination({
  meta,
  onPageChange,
  onPageSizeChange,
  disabled,
  className,
}: DataPaginationProps) {
  const { t } = useTranslation('common');

  if (!meta || meta.total <= 0) return null;

  const { page, limit, total, totalPages } = meta;
  const { from, to } = getShowingRange(page, limit, total);
  const pages = buildPageRange(page, totalPages);

  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  /** Chặn ở ngay đây để không có request nào ra ngoài khoảng `[1, totalPages]`. */
  const goTo = (next: number) => {
    if (disabled) return;
    if (next < 1 || next > totalPages || next === page) return;
    onPageChange(next);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {/* Tổng quan — luôn hiện, kể cả khi chỉ có một trang. */}
      <p className="text-muted-foreground">{t('pagination.showing', { from, to, total })}</p>

      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-muted-foreground">
            <span className="whitespace-nowrap">{t('pagination.perPage')}</span>
            <NativeSelect
              value={limit}
              disabled={disabled}
              // Đổi số dòng LUÔN kèm trang 1: trang 7 của cỡ 10 không tồn tại ở cỡ 100, và
              // giữ lại số trang cũ chỉ dẫn tới một trang rỗng. Trang cha nhận đúng `limit`
              // mới và tự đặt `page = 1`.
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-9 w-[76px]"
              aria-label={t('pagination.perPage')}
            >
              {/* Cỡ trang hiện tại có thể không nằm trong danh sách chuẩn (một vài dialog
                  đặt cỡ riêng) — thêm vào để `select` không hiện giá trị rỗng. */}
              {(PAGE_SIZE_OPTIONS.includes(limit as (typeof PAGE_SIZE_OPTIONS)[number])
                ? [...PAGE_SIZE_OPTIONS]
                : [...PAGE_SIZE_OPTIONS, limit].sort((a, b) => a - b)
              ).map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}

        {/* Một trang thì không cần điều hướng — chỉ giữ dòng "Showing…" bên trái. */}
        {totalPages > 1 && (
          <nav className="flex items-center gap-1" aria-label={t('pagination.navLabel')}>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || atFirst}
              onClick={() => goTo(page - 1)}
              aria-label={t('action.previous')}
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">{t('action.previous')}</span>
            </Button>

            {/* Màn hình nhỏ: dải nút chiếm quá nhiều chỗ và làm vỡ bố cục bảng ⇒ thay bằng
                "Trang x / y". Desktop mới hiện đủ nút bấm được. */}
            <span className="px-2 text-muted-foreground sm:hidden">
              {t('pagination.page', { page, totalPages })}
            </span>

            <div className="hidden items-center gap-1 sm:flex">
              {pages.map((item, index) =>
                item === ELLIPSIS ? (
                  <span
                    key={`gap-${index}`}
                    className="px-1.5 text-muted-foreground"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    variant={item === page ? 'default' : 'outline'}
                    size="sm"
                    disabled={disabled}
                    onClick={() => goTo(item)}
                    aria-label={t('pagination.goToPage', { page: item })}
                    aria-current={item === page ? 'page' : undefined}
                    className="min-w-9 tabular-nums"
                  >
                    {item}
                  </Button>
                ),
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={disabled || atLast}
              onClick={() => goTo(page + 1)}
              aria-label={t('action.next')}
            >
              <span className="hidden sm:inline">{t('action.next')}</span>
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
