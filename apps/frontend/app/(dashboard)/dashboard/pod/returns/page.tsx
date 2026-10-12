'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, History, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { DataPagination } from '@/components/ui/data-pagination';
import { Input } from '@/components/ui/input';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useClampedPage } from '@/hooks/use-clamped-page';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { LatestSyncStatusDialog } from '@/features/pod-tiktok/components/latest-sync-status-dialog';
import { OrderDateFilter } from '@/features/pod-tiktok/components/order-date-filter';
import { useLatestSyncStatus } from '@/features/pod-tiktok/hooks/use-pod-orders';
import { usePodTiktokAccounts } from '@/features/pod-tiktok/hooks/use-pod-tiktok';
import { ReturnHistoryDrawer } from '@/features/pod-return/components/return-history-drawer';
import { useReturnLabels } from '@/features/pod-return/components/return-labels';
import { ReturnTable } from '@/features/pod-return/components/return-table';
import {
  usePodReturnFilterOptions,
  usePodReturnSummary,
  usePodReturns,
  useSyncPodReturns,
} from '@/features/pod-return/hooks';
import {
  RETURN_STATUS_GROUPS,
  type PodReturn,
  type PodReturnFilter,
  type PodReturnQuery,
  type ReturnStatusGroup,
} from '@/features/pod-return/types';

/** Lỗi đồng bộ cần người dùng hành động (cấp scope / uỷ quyền lại) — hiện thành cảnh báo trên đầu trang. */
const ACTIONABLE_SYNC_ERRORS = new Set(['RETURN_SCOPE_MISSING', 'REAUTH_REQUIRED']);

export default function PodReturnsPage() {
  const { t } = useTranslation('podReturn');
  return (
    <RequirePermission permission="pod.tiktok.return.read" message={t('noPermission')}>
      {/* `useSearchParams` cần ranh giới Suspense khi build (Next 15). */}
      <Suspense fallback={null}>
        <PodReturnsView />
      </Suspense>
    </RequirePermission>
  );
}

function PodReturnsView() {
  const { t } = useTranslation(['podReturn', 'common', 'pod']);
  const translateApiError = useApiError();
  const { formatCurrency, formatDateTime, formatNumber } = useLocaleFormat();
  const labels = useReturnLabels();
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.tiktok.return.sync');
  // Link trong thông báo Telegram mở trang với `?search=<order id>`.
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') ?? '';

  const [query, setQuery] = useState<PodReturnQuery>({
    page: 1,
    limit: 20,
    sortBy: 'requestedAt',
    sortOrder: 'desc',
    dateField: 'requestedAt',
    search: initialSearch || undefined,
  });
  const [searchInput, setSearchInput] = useState(initialSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [historyFor, setHistoryFor] = useState<PodReturn | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const patchQuery = (patch: Partial<PodReturnQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch.trim() || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  // Thẻ tổng quan dùng ĐÚNG bộ lọc của bảng (bỏ phần phân trang / sắp xếp).
  const filter = useMemo<PodReturnFilter>(
    () => ({
      search: query.search,
      shopId: query.shopId,
      accountId: query.accountId,
      returnType: query.returnType,
      statusGroup: query.statusGroup,
      returnStatus: query.returnStatus,
      reason: query.reason,
      dateField: query.dateField,
      datePreset: query.datePreset,
      from: query.from,
      to: query.to,
    }),
    [query],
  );

  const listQuery = usePodReturns(query);
  const summaryQuery = usePodReturnSummary(filter);
  const optionsQuery = usePodReturnFilterOptions();
  const accountsQuery = usePodTiktokAccounts({ page: 1, limit: 100 });
  const syncStatusQuery = useLatestSyncStatus('RETURN');
  const syncMutation = useSyncPodReturns();

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const meta = listQuery.data?.meta;
  useClampedPage(meta, (next) => patchQuery({ page: next }));
  const summary = summaryQuery.data;

  const syncRows = syncStatusQuery.data ?? [];
  const lastSyncedAt = syncRows
    .map((row) => row.finishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const blockedShops = syncRows.filter((row) => row.errorCode && ACTIONABLE_SYNC_ERRORS.has(row.errorCode));

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync(undefined);
      const failed = result.shops.filter((shop) => shop.status === 'FAILED');
      const totals = result.shops.reduce(
        (acc, shop) => ({ created: acc.created + shop.created, updated: acc.updated + shop.updated }),
        { created: 0, updated: 0 },
      );
      if (result.shops.length === 0) {
        toast.warning(t('sync.noShops'));
      } else if (failed.length > 0) {
        // KHÔNG báo "thành công" khi có shop lỗi — nêu rõ shop và lý do.
        toast.warning(t('sync.partialTitle', { failed: failed.length, total: result.shops.length }), {
          description: failed
            .map((shop) => `${shop.shopName ?? shop.shopId}: ${t(`syncError.${shop.errorCode}`, { defaultValue: shop.errorMessage ?? '' })}`)
            .join('\n'),
        });
      } else {
        toast.success(t('sync.doneTitle'), {
          description: t('sync.summary', { shops: result.shops.length, ...totals }),
        });
      }
    } catch (error) {
      toast.error(t('sync.failedTitle'), { description: translateApiError(error) });
    }
  };

  const groupCard = (key: string, label: string, value: number | undefined) => (
    <Card key={key}>
      <CardContent className="p-4">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value === undefined ? '—' : formatNumber(value)}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {lastSyncedAt ? t('lastSynced', { time: formatDateTime(lastSyncedAt) }) : t('neverSynced')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setStatusOpen(true)}>
            <History className="size-4" />
            {t('pod:latestSync.action')}
          </Button>
          {canSync && (
            <Button onClick={() => void handleSync()} disabled={syncMutation.isPending}>
              {syncMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t('common:action.syncNow')}
            </Button>
          )}
        </div>
      </div>

      {blockedShops.length > 0 && (
        <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{t('scopeWarning.title')}</p>
            <ul className="space-y-0.5 text-xs">
              {blockedShops.map((row) => (
                <li key={row.shopId} className="break-words">
                  <span className="font-medium">{row.shopName ?? row.accountName ?? row.shopId}</span>:{' '}
                  {t(`syncError.${row.errorCode}`)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('scopeWarning.hint')}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {groupCard('total', t('summary.total'), summary?.totalRequests)}
        {groupCard('pending', t('group.PENDING'), summary?.byGroup.PENDING)}
        {groupCard('processing', t('group.PROCESSING'), summary?.byGroup.PROCESSING)}
        {groupCard('completed', t('group.COMPLETED'), summary?.byGroup.COMPLETED)}
        {groupCard(
          'closed',
          t('summary.rejectedCancelled'),
          summary ? summary.byGroup.REJECTED + summary.byGroup.CANCELLED : undefined,
        )}
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">{t('summary.refundAmount')}</p>
            {summary && summary.amounts.length === 0 && <p className="text-2xl font-bold">—</p>}
            {summary?.amounts.map((row) => (
              <div key={row.currency} className="text-xs">
                <p className="text-lg font-bold tabular-nums">{formatCurrency(row.settledRefund, row.currency)}</p>
                <p className="text-muted-foreground">{t('summary.settledHint')}</p>
                <p className="mt-1 tabular-nums">
                  {t('summary.refundedByRequest')}: {formatCurrency(row.refundedByRequest, row.currency)}
                </p>
                <p className="tabular-nums">
                  {t('summary.requested')}: {formatCurrency(row.requestedRefund, row.currency)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {summary && (
        <p className="-mt-3 text-xs text-muted-foreground">
          {t('summary.orders', { orders: summary.orders, refunded: summary.refundedOrders, quantity: summary.itemQuantity })}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Combobox
              value={query.accountId ?? ''}
              onChange={(value) => patchQuery({ accountId: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('filter.allAccounts') },
                ...(accountsQuery.data?.items ?? []).map((account) => ({
                  value: account.id,
                  label:
                    account.shopName && account.shopName !== account.accountName
                      ? `${account.accountName} (${account.shopName})`
                      : account.accountName,
                })),
              ]}
              className="w-[220px]"
            />
            <Combobox
              value={query.returnType ?? ''}
              onChange={(value) => patchQuery({ returnType: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('filter.allTypes') },
                ...(optionsQuery.data?.returnTypes ?? []).map((type) => ({ value: type, label: labels.type(type) })),
              ]}
              className="w-[180px]"
            />
            <Combobox
              value={query.statusGroup ?? ''}
              onChange={(value) =>
                patchQuery({ statusGroup: (value || undefined) as ReturnStatusGroup | undefined, returnStatus: undefined, page: 1 })
              }
              options={[
                { value: '', label: t('filter.allStatuses') },
                ...RETURN_STATUS_GROUPS.map((group) => ({ value: group, label: labels.group(group) })),
              ]}
              className="w-[170px]"
            />
            <Combobox
              value={query.returnStatus ?? ''}
              onChange={(value) => patchQuery({ returnStatus: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('filter.allRawStatuses') },
                ...(optionsQuery.data?.returnStatuses ?? []).map((status) => ({ value: status, label: labels.status(status) })),
              ]}
              className="w-[220px]"
            />
            <Combobox
              value={query.reason ?? ''}
              onChange={(value) => patchQuery({ reason: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('filter.allReasons') },
                ...(optionsQuery.data?.reasons ?? []).map((reason) => ({ value: reason.value, label: reason.label ?? reason.value })),
              ]}
              className="w-[220px]"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Combobox
              value={query.dateField ?? 'requestedAt'}
              onChange={(value) => patchQuery({ dateField: (value || 'requestedAt') as PodReturnQuery['dateField'], page: 1 })}
              options={[
                { value: 'requestedAt', label: t('filter.dateRequested') },
                { value: 'updatedAt', label: t('filter.dateUpdated') },
              ]}
              className="w-[190px]"
            />
            <OrderDateFilter
              preset={query.datePreset}
              from={query.from}
              to={query.to}
              onChange={({ preset, from, to }) => patchQuery({ datePreset: preset, from, to, page: 1 })}
            />
            <Combobox
              value={`${query.sortBy}:${query.sortOrder}`}
              onChange={(value) => {
                const [sortBy, sortOrder] = value.split(':') as [PodReturnQuery['sortBy'], PodReturnQuery['sortOrder']];
                patchQuery({ sortBy, sortOrder, page: 1 });
              }}
              options={[
                { value: 'requestedAt:desc', label: t('sort.requestedDesc') },
                { value: 'requestedAt:asc', label: t('sort.requestedAsc') },
                { value: 'tiktokUpdatedAt:desc', label: t('sort.updatedDesc') },
                { value: 'refundTotal:desc', label: t('sort.amountDesc') },
              ]}
              className="w-[200px]"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {listQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">{translateApiError(listQuery.error)}</p>
          ) : (
            <ReturnTable items={items} loading={listQuery.isLoading} onViewHistory={setHistoryFor} />
          )}
          <DataPagination
            meta={meta}
            onPageChange={(next) => patchQuery({ page: next })}
            onPageSizeChange={(next) => patchQuery({ limit: next, page: 1 })}
          />
        </CardContent>
      </Card>

      <ReturnHistoryDrawer request={historyFor} onClose={() => setHistoryFor(null)} />
      <LatestSyncStatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} syncType="RETURN" />
    </div>
  );
}
