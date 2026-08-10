'use client';

import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  DownloadCloud,
  History,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useApiError } from '@/hooks/use-api-error';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { OrderDateFilter } from '@/features/pod-tiktok/components/order-date-filter';
import { PodOrderTable } from '@/features/pod-tiktok/components/pod-order-table';
import { UploadDesignDialog } from '@/features/pod-tiktok/components/upload-design-dialog';
import { usePodOrderStatusLabel } from '@/features/pod-tiktok/components/pod-order-status-badge';
import { SyncHistoryDialog } from '@/features/pod-tiktok/components/sync-history-dialog';
import {
  usePodOrderStats,
  usePodOrders,
  useTriggerPodSync,
} from '@/features/pod-tiktok/hooks/use-pod-orders';
import {
  POD_ORDER_STATUSES,
  type PodOrderItem,
  type PodOrderQuery,
  type PodOrderStatus,
} from '@/features/pod-tiktok/order-types';
import { usePodTiktokAccounts } from '@/features/pod-tiktok/hooks/use-pod-tiktok';

export default function PodOrdersPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.tiktok.order.read" message={t('orders.noPermission')}>
      <PodOrdersView />
    </RequirePermission>
  );
}

function PodOrdersView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const statusLabel = usePodOrderStatusLabel();
  const [query, setQuery] = useState<PodOrderQuery>({
    page: 1,
    limit: 20,
    sortBy: 'orderedAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [designItem, setDesignItem] = useState<PodOrderItem | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.tiktok.order.sync');
  // Quyền của module Fulfillment — tách riêng để ẩn/hiện đúng từng nút.
  const canViewFulfillment = hasPermission('fulfillment.read');
  const canFulfill = hasPermission('fulfillment.create');
  const canCancelFulfillment = hasPermission('fulfillment.cancel');

  const ordersQuery = usePodOrders(query);
  const statsQuery = usePodOrderStats();
  // Danh sách shop để lọc — lấy từ các kết nối đã link (Sprint 1).
  const accountsQuery = usePodTiktokAccounts({ page: 1, limit: 100 });
  const syncMutation = useTriggerPodSync();

  const patchQuery = (patch: Partial<PodOrderQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const items = ordersQuery.data?.items ?? [];
  const meta = ordersQuery.data?.meta;
  const stats = statsQuery.data;

  /**
   * `backfill = true` kéo lại TOÀN BỘ lịch sử đơn theo `create_time`; mặc định chỉ
   * đồng bộ phần thay đổi gần đây theo `update_time`.
   */
  const handleSync = async (backfill = false) => {
    try {
      const result = await syncMutation.mutateAsync(backfill ? { backfill: true } : {});
      if (result.skippedByLock) {
        toast.warning(t('orders.sync.busyTitle'), {
          description: t('orders.sync.busyDescription'),
        });
        return;
      }
      toast.success(t(backfill ? 'orders.sync.backfillDoneTitle' : 'orders.sync.doneTitle'), {
        description:
          t('orders.sync.summary', {
            succeeded: result.shopsSucceeded,
            total: result.shopsTotal,
            created: result.ordersCreated,
            updated: result.ordersUpdated,
            skipped: result.ordersSkipped,
          }) +
          (result.ordersFailed > 0
            ? t('orders.sync.summaryFailed', { failed: result.ordersFailed })
            : ''),
      });
    } catch (error) {
      toast.error(t(backfill ? 'orders.sync.backfillFailedTitle' : 'orders.sync.failedTitle'), {
        description: translateApiError(error),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('orders.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('orders.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" />
            {t('orders.syncHistory')}
          </Button>
          {canSync && (
            <>
              <Button
                variant="outline"
                onClick={() => void handleSync(true)}
                disabled={syncMutation.isPending}
                title={t('orders.backfillHint')}
              >
                <DownloadCloud className="size-4" />
                {t('orders.backfill')}
              </Button>
              <Button onClick={() => void handleSync()} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t('common:action.syncNow')}
              </Button>
            </>
          )}
        </div>
      </div>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{t('orders.totalOrders')}</p>
              <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
            </CardContent>
          </Card>
          {POD_ORDER_STATUSES.filter((s) => (stats.byStatus[s] ?? 0) > 0)
            .slice(0, 4)
            .map((status) => (
              <Card key={status}>
                <CardContent className="p-4">
                  <p className="truncate text-xs text-muted-foreground">
                    {statusLabel(status)}
                  </p>
                  <p className="text-2xl font-bold tabular-nums">{stats.byStatus[status]}</p>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('orders.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <OrderDateFilter
              preset={query.datePreset}
              from={query.orderedFrom}
              to={query.orderedTo}
              onChange={({ preset, from, to }) =>
                patchQuery({ datePreset: preset, orderedFrom: from, orderedTo: to, page: 1 })
              }
            />
            <NativeSelect
              value={query.status ?? ''}
              onChange={(e) =>
                patchQuery({
                  status: (e.target.value || undefined) as PodOrderStatus | undefined,
                  page: 1,
                })
              }
              className="w-[190px]"
            >
              <option value="">{t('common:filter.allStatuses')}</option>
              {POD_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </NativeSelect>
            {/* Lọc theo KẾT NỐI (account) — danh sách lấy từ Sprint 1. */}
            <NativeSelect
              value={query.accountId ?? ''}
              onChange={(e) => patchQuery({ accountId: e.target.value || undefined, page: 1 })}
              className="w-[200px]"
            >
              <option value="">{t('orders.allAccounts')}</option>
              {(accountsQuery.data?.items ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.shopName ?? account.accountName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={query.hasPodItem === undefined ? '' : String(query.hasPodItem)}
              onChange={(e) =>
                patchQuery({
                  hasPodItem: e.target.value === '' ? undefined : e.target.value === 'true',
                  page: 1,
                })
              }
              className="w-[170px]"
            >
              <option value="">{t('orders.allProducts')}</option>
              <option value="true">{t('orders.onlyPod')}</option>
              <option value="false">{t('orders.notPod')}</option>
            </NativeSelect>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ordersQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(ordersQuery.error)}
            </p>
          ) : (
            <PodOrderTable
              orders={items}
              canViewFulfillment={canViewFulfillment}
              canFulfill={canFulfill}
              canCancelFulfillment={canCancelFulfillment}
              loading={ordersQuery.isLoading}
              onUploadDesign={setDesignItem}
              onPreviewDesign={setLightbox}
            />
          )}

          {meta && meta.total > 0 && (
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
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  {t('common:action.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDesignDialog
        open={Boolean(designItem)}
        item={designItem}
        onClose={() => setDesignItem(null)}
      />

      <ImageLightbox open={Boolean(lightbox)} src={lightbox} onClose={() => setLightbox(null)} />

      <SyncHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
