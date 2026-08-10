'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { PodPayoutSellerListResult, PodPayoutSortField } from '../payout-types';
import { PayoutTableShell } from './payout-table-shell';

interface PayoutSellerTableProps {
  data?: PodPayoutSellerListResult;
  loading: boolean;
  error: unknown;
  search: string;
  onSearchChange: (value: string) => void;
  sortField: PodPayoutSortField;
  sortOrder: 'asc' | 'desc';
  onSortChange: (field: PodPayoutSortField) => void;
  onPageChange: (page: number) => void;
}

/** Ô tiêu đề bấm được để đổi cột sắp xếp. */
function SortableHead({
  field,
  label,
  active,
  order,
  onSort,
  className,
}: {
  field: PodPayoutSortField;
  label: string;
  active: boolean;
  order: 'asc' | 'desc';
  onSort: (field: PodPayoutSortField) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
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
          (order === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </TableHead>
  );
}

/** Bảng thống kê Payout theo Seller. Mặc định sắp xếp giảm dần theo Payout. */
export function PayoutSellerTable({
  data,
  loading,
  error,
  search,
  onSearchChange,
  sortField,
  sortOrder,
  onSortChange,
  onPageChange,
}: PayoutSellerTableProps) {
  const { t } = useTranslation('pod');
  const { formatCurrency, formatNumber } = useLocaleFormat();
  const items = data?.items ?? [];

  return (
    <PayoutTableShell
      title={t('payout.bySeller')}
      description={t('payout.sellerTableDescription')}
      searchValue={search}
      searchPlaceholder={t('payout.sellerSearchPlaceholder')}
      onSearchChange={onSearchChange}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      meta={data?.meta}
      onPageChange={onPageChange}
      columnCount={5}
      header={
        <TableHeader>
          <TableRow>
            <SortableHead
              field="name"
              label={t('payout.sellerEmail')}
              active={sortField === 'name'}
              order={sortOrder}
              onSort={onSortChange}
            />
            <TableHead>{t('payout.sellerName')}</TableHead>
            <SortableHead
              field="accountCount"
              label={t('payout.accountCount')}
              active={sortField === 'accountCount'}
              order={sortOrder}
              onSort={onSortChange}
              className="text-right"
            />
            <SortableHead
              field="orderCount"
              label={t('payout.orderCount')}
              active={sortField === 'orderCount'}
              order={sortOrder}
              onSort={onSortChange}
              className="text-right"
            />
            <SortableHead
              field="totalPayout"
              label={t('payout.totalPayout')}
              active={sortField === 'totalPayout'}
              order={sortOrder}
              onSort={onSortChange}
              className="text-right"
            />
          </TableRow>
        </TableHeader>
      }
    >
      {items.map((row) => (
        <TableRow key={row.sellerId ?? 'unassigned'}>
          <TableCell className="max-w-[240px] truncate font-medium">
            {row.sellerEmail ?? (
              <span className="text-muted-foreground">{t('account.unassigned')}</span>
            )}
          </TableCell>
          <TableCell className="max-w-[200px] truncate">
            {row.sellerName ?? <span className="text-muted-foreground">—</span>}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatNumber(row.accountCount)}
          </TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(row.orderCount)}</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatCurrency(row.totalPayout, row.currency)}
          </TableCell>
        </TableRow>
      ))}
    </PayoutTableShell>
  );
}
