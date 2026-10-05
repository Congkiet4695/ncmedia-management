'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DataPagination } from '@/components/ui/data-pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { EmployeeWorkPage, EmployeeWorkRow, EmployeeWorkSortField } from '../types';

const COLUMN_COUNT = 7;

interface EmployeeWorkTableProps {
  data?: EmployeeWorkPage;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  sortField: EmployeeWorkSortField;
  sortOrder: 'asc' | 'desc';
  onSortChange: (field: EmployeeWorkSortField) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (limit: number) => void;
}

/** Ô tiêu đề bấm được để đổi cột sắp xếp. */
function SortableHead({
  field,
  label,
  sortField,
  sortOrder,
  onSort,
  className,
}: {
  field: EmployeeWorkSortField;
  label: string;
  sortField: EmployeeWorkSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: EmployeeWorkSortField) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const active = sortField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          active && 'font-semibold text-foreground',
        )}
        aria-label={t('table.sortBy', { column: label })}
      >
        {label}
        {active &&
          (sortOrder === 'desc' ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUp className="size-3" />
          ))}
      </button>
    </TableHead>
  );
}

/**
 * Bảng theo nhân viên — bấm một dòng để mở chi tiết từng shop "Tên shop (Tên account)".
 *
 * 🔴 Không hiển thị UUID: `userId` / `shopId` chỉ dùng làm khoá React.
 * Đơn / lợi nhuận của một dòng là của các SHOP gắn với người đó (shop họ listing + shop họ phụ trách).
 */
export function EmployeeWorkTable({
  data,
  loading,
  error,
  onRetry,
  sortField,
  sortOrder,
  onSortChange,
  onPageChange,
  onPageSizeChange,
}: EmployeeWorkTableProps) {
  const { t } = useTranslation(['report', 'common']);
  const translateApiError = useApiError();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const items = data?.items ?? [];
  const showSkeleton = loading && !data;

  const toggle = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const sortProps = { sortField, sortOrder, onSort: onSortChange };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">{t('employeeWork.table.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('employeeWork.table.description')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <p className="text-sm text-destructive">{translateApiError(error)}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common:action.retry')}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <SortableHead
                    field="name"
                    label={t('employeeWork.table.employee')}
                    {...sortProps}
                  />
                  <TableHead className="text-right">{t('employeeWork.table.accounts')}</TableHead>
                  <SortableHead
                    field="listings"
                    label={t('employeeWork.table.listings')}
                    className="text-right"
                    {...sortProps}
                  />
                  <SortableHead
                    field="orders"
                    label={t('employeeWork.table.orders')}
                    className="text-right"
                    {...sortProps}
                  />
                  <SortableHead
                    field="profit"
                    label={t('employeeWork.table.profit')}
                    className="text-right"
                    {...sortProps}
                  />
                  <TableHead className="text-right">
                    {t('employeeWork.table.profitPerOrder')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showSkeleton &&
                  Array.from({ length: 5 }, (_, row) => (
                    <TableRow key={row}>
                      {Array.from({ length: COLUMN_COUNT }, (_, col) => (
                        <TableCell key={col}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}

                {!showSkeleton &&
                  items.map((row) => (
                    <EmployeeRow
                      key={row.userId}
                      row={row}
                      currency={data?.currency ?? null}
                      open={expanded.has(row.userId)}
                      onToggle={() => toggle(row.userId)}
                    />
                  ))}

                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMN_COUNT}>
                      <div className="flex flex-col items-center gap-2 py-12 text-center">
                        <Inbox className="size-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{t('employeeWork.empty')}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <DataPagination
          meta={data?.meta}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          disabled={loading}
        />
      </CardContent>
    </Card>
  );
}

function EmployeeRow({
  row,
  currency,
  open,
  onToggle,
}: {
  row: EmployeeWorkRow;
  currency: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('report');
  const { formatCurrency, formatNumber } = useLocaleFormat();
  const expandable = row.accountDetails.length > 0;

  return (
    <Fragment>
      <TableRow
        className={cn(expandable && 'cursor-pointer')}
        onClick={expandable ? onToggle : undefined}
      >
        <TableCell>
          {expandable && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={t(open ? 'employeeWork.table.collapse' : 'employeeWork.table.expand')}
              className="text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          )}
        </TableCell>
        <TableCell className="max-w-[280px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{row.name}</span>
            {!row.active && <Badge variant="muted">{t('employeeWork.badge.inactive')}</Badge>}
            {!row.isEmployee && (
              <Badge variant="default">{t('employeeWork.badge.notEmployee')}</Badge>
            )}
          </div>
          {row.email !== row.name && (
            <p className="truncate text-xs text-muted-foreground">{row.email}</p>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(row.accounts)}</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {formatNumber(row.listings)}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(row.orders)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(row.profit, currency)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(row.profitPerOrder, currency)}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={COLUMN_COUNT - 1} className="py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('employeeWork.detail.shop')}</TableHead>
                  <TableHead className="text-right">{t('employeeWork.detail.listings')}</TableHead>
                  <TableHead className="text-right">{t('employeeWork.detail.orders')}</TableHead>
                  <TableHead className="text-right">{t('employeeWork.detail.profit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.accountDetails.map((account) => (
                  <TableRow key={account.shopId}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>
                          {account.shopName}{' '}
                          <span className="text-muted-foreground">({account.accountName})</span>
                        </span>
                        {account.assigned && (
                          <Badge variant="success">{t('employeeWork.badge.assigned')}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(account.listings)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(account.orders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(account.profit, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
