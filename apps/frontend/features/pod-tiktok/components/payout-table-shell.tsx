'use client';

import { type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import type { PaginationMeta } from '@/types/api';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';

interface PayoutTableShellProps {
  title: string;
  description: string;
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  error: unknown;
  isEmpty: boolean;
  meta?: PaginationMeta;
  onPageChange: (page: number) => void;
  /** Số cột — để khung xương và ô trống trải đúng chiều rộng bảng. */
  columnCount: number;
  header: ReactNode;
  children: ReactNode;
}

/**
 * Khung dùng chung cho hai bảng Payout (Seller và Account).
 *
 * Gom về một chỗ: tiêu đề, ô tìm kiếm, trạng thái Loading / Empty / Error và phân trang —
 * hai bảng chỉ khác nhau ở phần cột nên không nhân bản logic.
 * Bảng cuộn ngang trong khung riêng để màn hình hẹp không bị vỡ layout.
 */
export function PayoutTableShell({
  title,
  description,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  loading,
  error,
  isEmpty,
  meta,
  onPageChange,
  columnCount,
  header,
  children,
}: PayoutTableShellProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatNumber } = useLocaleFormat();
  const showSkeleton = loading && isEmpty;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
            aria-label={searchPlaceholder}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <p className="text-sm text-destructive">
              {translateApiError(error)}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              {header}
              <TableBody>
                {showSkeleton
                  ? Array.from({ length: 5 }, (_, row) => (
                      <TableRow key={row}>
                        {Array.from({ length: columnCount }, (_, col) => (
                          <TableCell key={col}>
                            <div className="h-4 w-full animate-pulse rounded bg-muted" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : children}

                {!loading && isEmpty && (
                  <TableRow>
                    <TableCell colSpan={columnCount}>
                      <div className="flex flex-col items-center gap-2 py-12 text-center">
                        <Inbox className="size-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{t('payout.empty')}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {t('common:pagination.pageWithRows', {
                page: meta.page,
                totalPages: meta.totalPages,
                total: formatNumber(meta.total),
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
  );
}
