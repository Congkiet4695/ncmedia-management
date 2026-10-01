'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { DataPagination } from '@/components/ui/data-pagination';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { useDashboardSellers } from '../hooks/use-dashboard';
import type { DashboardRange, DashboardSellerRow, SellerSortField } from '../types';
import { WidgetCard, WidgetEmpty } from './widget-card';

type MoneyColumn = Exclude<SellerSortField, 'name' | 'orders'>;
const MONEY_COLUMNS: MoneyColumn[] = ['estRevenue', 'revenue', 'baseCost', 'profit', 'paid', 'processing', 'hold'];

/**
 * Thống kê seller — sắp xếp / tìm kiếm / phân trang đều ở BACKEND (SQL), không tải toàn bộ đơn về.
 * Dùng khoảng ngày + đơn vị tiền + shop + seller của bộ lọc chung; "On hold" là ảnh chụp hiện tại.
 */
export function SellerStatsTable({ range, enabled }: { range: DashboardRange; enabled: boolean }) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SellerSortField>('orders');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  // Đổi bộ lọc chung (khoảng ngày / tiền / shop / seller) ⇒ về trang 1.
  const rangeKey = JSON.stringify(range);
  useEffect(() => setPage(1), [rangeKey]);

  const query = useDashboardSellers(
    { ...range, activeOnly, search: search.trim() || undefined, sort, order, page, limit },
    enabled,
  );
  const currency = query.data?.currency ?? null;
  const money = (value: number) => (currency ? formatCurrency(value, currency) : '—');
  const rows = query.data?.items ?? [];

  const toggleSort = (field: SellerSortField) => {
    if (sort === field) setOrder(order === 'desc' ? 'asc' : 'desc');
    else {
      setSort(field);
      setOrder(field === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  return (
    <WidgetCard
      title={t('sellers.title')}
      icon={BarChart3}
      hint={t('sellers.hint')}
      loading={query.isLoading}
      error={query.isError ? query.error : undefined}
      onRetry={() => void query.refetch()}
      contentClassName="p-0"
      toolbar={
        <>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={activeOnly}
              onChange={(event) => {
                setActiveOnly(event.target.checked);
                setPage(1);
              }}
            />
            {t('sellers.activeOnly')}
          </label>
          <Input
            className="h-8 w-48 text-xs"
            placeholder={t('sellers.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <WidgetEmpty message={t('sellers.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <SortHeader field="name" label={t('sellers.col.name')} sort={sort} order={order} onSort={toggleSort} align="left" />
                <SortHeader field="orders" label={t('sellers.col.orders')} sort={sort} order={order} onSort={toggleSort} />
                <th className="px-3 py-2 text-right font-medium">
                  <Tooltip content={t('sellers.returnsUnavailable')}>
                    <span>{t('sellers.col.returns')}</span>
                  </Tooltip>
                </th>
                {MONEY_COLUMNS.map((field) => (
                  <SortHeader
                    key={field}
                    field={field}
                    label={t(`sellers.col.${field}`)}
                    hint={t(`sellers.colHint.${field}`)}
                    sort={sort}
                    order={order}
                    onSort={toggleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <SellerRow
                  key={row.sellerId ?? 'unassigned'}
                  index={(page - 1) * limit + index + 1}
                  row={row}
                  money={money}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-2">
        <DataPagination
          meta={query.data?.meta}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setLimit(next);
            setPage(1);
          }}
          disabled={query.isFetching}
        />
      </div>
    </WidgetCard>
  );
}

function SellerRow({ index, row, money }: { index: number; row: DashboardSellerRow; money: (v: number) => string }) {
  const { t } = useTranslation('dashboard');
  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="px-3 py-2 text-muted-foreground tabular-nums">{index}</td>
      <td className="px-3 py-2">
        <span className={cn('font-medium', !row.active && 'text-muted-foreground')}>
          {row.sellerName ?? t('unassigned')}
        </span>
        {!row.active && <span className="ml-2 text-[10px] uppercase text-muted-foreground">{t('sellers.inactive')}</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.orders}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.estRevenue)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.revenue)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.baseCost)}</td>
      <td className={cn('px-3 py-2 text-right font-medium tabular-nums', row.profit < 0 && 'text-destructive')}>
        {money(row.profit)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.paid)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.processing)}</td>
      <td className="px-3 py-2 text-right font-medium tabular-nums text-primary">{money(row.hold)}</td>
    </tr>
  );
}

function SortHeader({
  field,
  label,
  hint,
  sort,
  order,
  onSort,
  align = 'right',
}: {
  field: SellerSortField;
  label: string;
  hint?: string;
  sort: SellerSortField;
  order: 'asc' | 'desc';
  onSort: (field: SellerSortField) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  const button = (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn('inline-flex items-center gap-1 font-medium hover:text-foreground', active && 'text-foreground')}
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
  return (
    <th
      className={cn('whitespace-nowrap px-3 py-2', align === 'left' ? 'text-left' : 'text-right')}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {hint ? <Tooltip content={hint}>{button}</Tooltip> : button}
    </th>
  );
}
