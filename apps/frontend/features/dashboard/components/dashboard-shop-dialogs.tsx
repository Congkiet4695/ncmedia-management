'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useDashboardHoldShops, useDashboardShops } from '../hooks/use-dashboard';
import type { DashboardFilters, DashboardShopStatus } from '../types';

const PAGE_SIZE = 20;

/** Nhãn trạng thái shop trên Dashboard (Live / Die / Mất uỷ quyền) — cùng nhãn với thẻ. */
export const SHOP_STATUS_LABEL_KEY: Record<DashboardShopStatus, string> = {
  ACTIVE: 'shop.live',
  INACTIVE: 'shop.inactive',
  DEAUTHORIZED: 'shop.deauthorized',
};

interface ListStateProps {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyMessage: string;
  onRetry: () => void;
  children: ReactNode;
}

/** Loading / Error (có thử lại) / Empty dùng chung cho các popup danh sách của Dashboard. */
function ListState({ loading, error, empty, emptyMessage, onRetry, children }: ListStateProps) {
  const { t } = useTranslation('dashboard');
  const translateApiError = useApiError();
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center text-sm">
        <p className="text-destructive">{translateApiError(error)}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (empty) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  return <>{children}</>;
}

/**
 * Popup "Tổng tiền đang hold" — hold theo TỪNG shop. Backend dùng CÙNG nguồn / phạm vi / đơn vị tiền
 * với thẻ ⇒ số shop (meta.total) và tổng tiền khớp số trên thẻ. Chỉ gọi API khi popup mở.
 */
export function HoldShopsDialog({
  open,
  onClose,
  filters,
}: {
  open: boolean;
  onClose: () => void;
  filters: DashboardFilters;
}) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const [page, setPage] = useState(1);
  const query = useDashboardHoldShops({ ...filters, page, limit: PAGE_SIZE }, open);
  const data = query.data;
  const currency = data?.currency ?? null;
  const close = () => {
    setPage(1);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      className="max-w-3xl"
      title={t('holdShops.title')}
      description={t('holdShops.description')}
    >
      <ListState
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        empty={(data?.items.length ?? 0) === 0}
        emptyMessage={t('holdShops.empty')}
        onRetry={() => void query.refetch()}
      >
        {data && currency && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t('holdShops.summary', { count: data.meta.total })}</span>
            <span className="font-semibold tabular-nums text-primary">{formatCurrency(data.totalAmount, currency)}</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dialog.connection')}</TableHead>
                <TableHead>{t('dialog.shop')}</TableHead>
                <TableHead className="text-right">{t('holdShops.amount', { currency: currency ?? '—' })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((row) => (
                <TableRow key={row.shopId}>
                  <TableCell className="text-sm">{row.accountName ?? '—'}</TableCell>
                  <TableCell className="text-sm font-medium">{row.shopName ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-primary">
                    {currency ? formatCurrency(row.amount, currency) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ListState>
      <DataPagination className="mt-3" meta={data?.meta} onPageChange={setPage} disabled={query.isFetching} />
    </Modal>
  );
}

/**
 * Popup "Trạng thái shop" — các shop của MỘT trạng thái (Live = ACTIVE, Die = INACTIVE). Backend dùng
 * CÙNG điều kiện với thẻ ⇒ số dòng khớp con số đã bấm.
 */
export function ShopStatusDialog({
  status,
  onClose,
  filters,
}: {
  status: DashboardShopStatus | null;
  onClose: () => void;
  filters: DashboardFilters;
}) {
  const { t } = useTranslation('dashboard');
  const [page, setPage] = useState(1);
  const open = status !== null;
  const query = useDashboardShops({ ...filters, status: status ?? 'ACTIVE', page, limit: PAGE_SIZE }, open);
  const data = query.data;
  const close = () => {
    setPage(1);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      className="max-w-2xl"
      title={t('shopList.title', { status: status ? t(SHOP_STATUS_LABEL_KEY[status]) : '' })}
      description={t('shopList.description')}
    >
      <ListState
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        empty={(data?.items.length ?? 0) === 0}
        emptyMessage={t('shopList.empty')}
        onRetry={() => void query.refetch()}
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dialog.connection')}</TableHead>
                <TableHead>{t('dialog.shop')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((row) => (
                <TableRow key={row.shopId}>
                  <TableCell className="text-sm">{row.accountName ?? '—'}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {row.shopName}
                    {row.region && <span className="ml-2 text-xs text-muted-foreground">{row.region}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ListState>
      <DataPagination className="mt-3" meta={data?.meta} onPageChange={setPage} disabled={query.isFetching} />
    </Modal>
  );
}
