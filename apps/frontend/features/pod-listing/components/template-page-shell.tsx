'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownAZ, ArrowUpAZ, ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { POD_TEMPLATE_SORT_FIELDS, type PodTemplateSortField } from '../types';

interface SortConfig {
  by: PodTemplateSortField;
  order: 'asc' | 'desc';
  onChange: (by: PodTemplateSortField, order: 'asc' | 'desc') => void;
}

interface TemplatePageShellProps {
  title: string;
  subtitle: string;
  /** Nút tạo mới — ẩn khi người dùng không có quyền ghi. */
  onCreate?: () => void;
  createLabel?: string;
  /** Nút phụ bên cạnh (Import / Export / Đồng bộ kho…). */
  actions?: ReactNode;
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyMessage?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Bộ lọc riêng của từng màn hình (vd Market của Category Template). */
  filters?: ReactNode;
  sort?: SortConfig;
  /** Lọc theo trạng thái bật/tắt — dùng chung cho cả sáu màn hình. */
  status?: { value: 'ALL' | 'ACTIVE' | 'DEFAULT'; onChange: (value: 'ALL' | 'ACTIVE' | 'DEFAULT') => void };
  meta?: { page: number; totalPages: number; total: number } | null;
  onPageChange?: (page: number) => void;
  children: ReactNode;
}

/**
 * Khung dùng chung cho MỌI màn hình template.
 *
 * Sáu màn hình template có cùng bộ khung: tiêu đề, tìm kiếm, lọc, sắp xếp, bảng, phân
 * trang, nút tạo, Import/Export. Gom vào một component để sáu màn hình không trôi dạt về
 * cách hiển thị trạng thái rỗng, lỗi hay phân trang — và sửa một chỗ là cả sáu đổi theo.
 */
export function TemplatePageShell({
  title,
  subtitle,
  onCreate,
  createLabel,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
  onSearchChange,
  searchPlaceholder,
  filters,
  sort,
  status,
  meta,
  onPageChange,
  children,
}: TemplatePageShellProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const [searchInput, setSearchInput] = useState('');
  const debounced = useDebouncedValue(searchInput, 350);

  useEffect(() => {
    onSearchChange?.(debounced);
    // `onSearchChange` là hàm inline ở trang cha; đưa vào deps sẽ chạy lại mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const hasToolbar = Boolean(onSearchChange || filters || sort || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {onCreate && (
            <Button onClick={onCreate}>
              <Plus className="size-4" />
              {createLabel ?? t('common:action.create')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        {hasToolbar && (
          <CardHeader>
            <div className="flex flex-wrap items-end gap-2">
              {onSearchChange && (
                <div className="relative min-w-[220px] flex-1 sm:max-w-md">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={searchPlaceholder ?? t('common:action.search')}
                    className="pl-9"
                  />
                </div>
              )}

              {filters}

              {status && (
                <Combobox
                  value={status.value}
                  onChange={(value) => status.onChange(value as 'ALL' | 'ACTIVE' | 'DEFAULT')}
                  options={[
                    { value: 'ALL', label: t('listing.filters.statusAll') },
                    { value: 'ACTIVE', label: t('listing.filters.statusActive') },
                    { value: 'DEFAULT', label: t('listing.filters.statusDefault') },
                  ]}
                  className="w-[150px]"
                />
              )}

              {sort && (
                <div className="flex items-end gap-1">
                  <Combobox
                    value={sort.by}
                    onChange={(value) => sort.onChange(value as PodTemplateSortField, sort.order)}
                    options={POD_TEMPLATE_SORT_FIELDS.map((field) => ({
                      value: field,
                      label: t(`listing.filters.sort.${field}`),
                    }))}
                    className="w-[170px]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    title={t('listing.filters.toggleOrder')}
                    onClick={() => sort.onChange(sort.by, sort.order === 'asc' ? 'desc' : 'asc')}
                  >
                    {sort.order === 'asc' ? (
                      <ArrowDownAZ className="size-4" />
                    ) : (
                      <ArrowUpAZ className="size-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
        )}

        <CardContent className="space-y-4">
          {error ? (
            <p className="py-10 text-center text-sm text-destructive">{translateApiError(error)}</p>
          ) : loading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : empty ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {emptyMessage ?? t('listing.common.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">{children}</div>
          )}

          {meta && meta.totalPages > 1 && onPageChange && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t('common:pagination.pageWithTotal', {
                  page: meta.page,
                  totalPages: meta.totalPages,
                  total: meta.total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => onPageChange(meta.page - 1)}
                >
                  <ChevronLeft className="size-4" />
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => onPageChange(meta.page + 1)}
                >
                  {t('common:action.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Hàng thao tác cuối bảng (Sửa / Nhân bản / Xoá) — dùng chung để mọi bảng template giống nhau. */
export function TemplateRowActions({
  onEdit,
  onClone,
  onDelete,
  extra,
}: {
  onEdit?: () => void;
  onClone?: () => void;
  onDelete?: () => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation(['pod', 'common']);
  return (
    <div className="flex justify-end gap-2">
      {extra}
      {onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t('common:action.edit')}
        </Button>
      )}
      {onClone && (
        <Button variant="outline" size="sm" onClick={onClone}>
          {t('listing.common.clone')}
        </Button>
      )}
      {onDelete && (
        <Button variant="outline" size="sm" onClick={onDelete}>
          {t('common:action.delete')}
        </Button>
      )}
    </div>
  );
}
