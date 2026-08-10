'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { PodPayoutAccountListResult, PodPayoutSortField } from '../payout-types';
import { PayoutTableShell } from './payout-table-shell';

interface PayoutAccountTableProps {
  data?: PodPayoutAccountListResult;
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

/** Bảng thống kê Payout theo Account. Mặc định sắp xếp giảm dần theo Payout. */
export function PayoutAccountTable({
  data,
  loading,
  error,
  search,
  onSearchChange,
  sortField,
  sortOrder,
  onSortChange,
  onPageChange,
}: PayoutAccountTableProps) {
  const { t } = useTranslation('pod');
  const { formatCurrency, formatNumber } = useLocaleFormat();
  const items = data?.items ?? [];

  return (
    <PayoutTableShell
      title={t('payout.byAccount')}
      description={t('payout.accountTableDescription')}
      searchValue={search}
      searchPlaceholder={t('payout.accountSearchPlaceholder')}
      onSearchChange={onSearchChange}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      meta={data?.meta}
      onPageChange={onPageChange}
      columnCount={4}
      header={
        <TableHeader>
          <TableRow>
            <SortableHead
              field="name"
              label={t('payout.account')}
              active={sortField === 'name'}
              order={sortOrder}
              onSort={onSortChange}
            />
            <TableHead>{t('payout.seller')}</TableHead>
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
        <TableRow key={row.accountId}>
          <TableCell className="max-w-[260px]">
            <div className="truncate font-medium">{row.accountName}</div>
            {row.shopName && (
              <div className="truncate text-xs text-muted-foreground">{row.shopName}</div>
            )}
          </TableCell>
          <TableCell className="max-w-[240px]">
            {row.sellerEmail ? (
              <>
                <div className="truncate">{row.sellerName ?? row.sellerEmail}</div>
                {row.sellerName && (
                  <div className="truncate text-xs text-muted-foreground">{row.sellerEmail}</div>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{t('account.unassigned')}</span>
            )}
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
