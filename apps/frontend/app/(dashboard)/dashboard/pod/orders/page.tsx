'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Combobox } from '@/components/ui/combobox';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useApiError } from '@/hooks/use-api-error';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { OrderDateFilter } from '@/features/pod-tiktok/components/order-date-filter';
import { BulkToolbar } from '@/features/pod-tiktok/components/orders/bulk-toolbar';
import { PodOrderTable } from '@/features/pod-tiktok/components/pod-order-table';
import { UploadDesignDialog } from '@/features/pod-tiktok/components/upload-design-dialog';
import { MappingFormDialog } from '@/features/fulfillment/components/mapping-form-dialog';
import { useProductMappingActions } from '@/features/fulfillment/hooks/use-fulfillment';
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
  type PodOrderListItem,
  type PodOrderQuery,
  type PodOrderStatus,
} from '@/features/pod-tiktok/order-types';
import type { LightboxRequest, OrderProductRow } from '@/features/pod-tiktok/order-view-model';
import { usePodTiktokAccounts } from '@/features/pod-tiktok/hooks/use-pod-tiktok';
import { useQueryClient } from '@tanstack/react-query';

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
  /**
   * Dòng sản phẩm đang được khai ánh xạ, kèm nhà cung cấp của chính đơn chứa nó.
   *
   * Giữ cả `accountId` chứ không chỉ `row`: cùng một sản phẩm có thể xuất hiện ở hai đơn của
   * hai kết nối TikTok gán hai nhà cung cấp khác nhau, nên nhà cung cấp phải lấy từ ĐƠN đang
   * mở, không phải đoán từ danh sách nhà cung cấp của tổ chức.
   */
  const [mapTarget, setMapTarget] = useState<{ row: OrderProductRow; accountId: string } | null>(
    null,
  );
  /**
   * Bộ ảnh đang xem — dùng CHUNG cho ảnh sản phẩm và ảnh design.
   *
   * Giữ cả danh sách chứ không chỉ một URL: nhờ vậy lightbox đi tới/lui được giữa các ảnh
   * trong cùng một đơn, thay vì phải đóng ra mở lại từng ảnh.
   */
  const [lightbox, setLightbox] = useState<LightboxRequest | null>(null);
  /** Đơn đang tick (Bulk Action) và đơn đang mở rộng — hai tập độc lập nhau. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();

  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.tiktok.order.sync');
  // Quyền của module Fulfillment — tách riêng để ẩn/hiện đúng từng nút.
  const canViewFulfillment = hasPermission('fulfillment.read');
  const canFulfill = hasPermission('fulfillment.create');
  const canCancelFulfillment = hasPermission('fulfillment.cancel');

  const ordersQuery = usePodOrders(query);
  /**
   * 🔴 Thẻ thống kê nhận ĐÚNG bộ lọc đang áp cho danh sách.
   *
   * Trước đây hook này không nhận tham số nào, nên lọc "hôm qua" xong bảng còn 3 đơn mà thẻ
   * vẫn ghi 1.240 — hai con số mâu thuẫn nhau trên cùng một màn hình. Truyền `query` cũng làm
   * cache key đổi theo bộ lọc, nên đổi filter là thẻ tự tải lại, không cần F5.
   */
  const statsQuery = usePodOrderStats(query);
  // Danh sách shop để lọc — lấy từ các kết nối đã link (Sprint 1).
  const accountsQuery = usePodTiktokAccounts({ page: 1, limit: 100 });
  const syncMutation = useTriggerPodSync();

  const patchQuery = (patch: Partial<PodOrderQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  /**
   * Đổi bộ lọc hoặc sang trang ⇒ **xoá lựa chọn**.
   *
   * 🔴 Giữ lại là nguy hiểm thật: người dùng tick 10 đơn ở trang 1, chuyển sang trang 2 rồi
   * bấm Fulfill — thanh công cụ chỉ thao tác trên các đơn CÒN hiển thị, nên phần đã tick ở
   * trang trước hoặc bị bỏ quên, hoặc bị gửi đi mà không ai nhìn thấy. Không cho lựa chọn
   * sống qua ranh giới trang là cách duy nhất để "đang chọn" luôn khớp với "đang thấy".
   */
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedIds(new Set());
  }, [query]);

  /**
   * 🔴 `useMemo` chứ không phải `?? []` trần: mảng rỗng mới mỗi lần render sẽ làm
   * `toggleSelectAll` và `selectedOrders` tính lại liên tục — và với 50 dòng, mỗi lần tính
   * lại là 50 dòng render theo.
   */
  const items = useMemo(() => ordersQuery.data?.items ?? [], [ordersQuery.data]);

  const mappingActions = useProductMappingActions();

  /**
   * Mở dialog khai ánh xạ cho một dòng sản phẩm.
   *
   * Tìm ngược ra đơn chứa dòng này để lấy nhà cung cấp của nó. Chưa gán nhà cung cấp thì
   * KHÔNG mở dialog — ô sản phẩm đã hiện trạng thái `NO_PROVIDER` không có nút, nên nhánh
   * này chỉ là hàng rào cuối.
   */
  const openMapProduct = useCallback(
    (row: OrderProductRow) => {
      const sourceIds = new Set(row.sources.map((source) => source.id));
      const order = items.find((candidate: PodOrderListItem) =>
        candidate.items.some((item) => sourceIds.has(item.id)),
      );
      if (!order?.fulfillmentAccountId) return;
      setMapTarget({ row, accountId: order.fulfillmentAccountId });
    },
    [items],
  );

  /** Tạo ánh xạ rồi đóng dialog. Cache đơn hàng được làm mới trong `useProductMappingActions`. */
  const handleCreateMapping = async (input: Parameters<typeof mappingActions.create.mutateAsync>[0]) => {
    try {
      await mappingActions.create.mutateAsync(input);
      toast.success(t('product.mapProductSuccess'), { description: input.providerSku });
      setMapTarget(null);
    } catch (error) {
      toast.error(t('product.mapProductFailed'), { description: translateApiError(error) });
    }
  };
  const meta = ordersQuery.data?.meta;
  const stats = statsQuery.data;

  /**
   * `shopName` → id kết nối TikTok.
   *
   * 🔴 Endpoint danh sách đơn KHÔNG trả `accountId`, mà §1 yêu cầu bấm được vào tên shop.
   * Danh sách kết nối đã được tải sẵn cho bộ lọc, nên tra ngược ở phía giao diện là cách
   * duy nhất có link mà không phải đổi API. Trùng tên shop ⇒ lấy kết nối đầu tiên.
   */
  const accountIdByShopName = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accountsQuery.data?.items ?? []) {
      const name = account.shopName ?? account.accountName;
      if (name && !map.has(name)) map.set(name, account.id);
    }
    return map;
  }, [accountsQuery.data]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /** Tick/bỏ tick toàn bộ đơn của TRANG hiện tại. */
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((order) => prev.has(order.id));
      if (allSelected) {
        const next = new Set(prev);
        for (const order of items) next.delete(order.id);
        return next;
      }
      return new Set([...prev, ...items.map((order) => order.id)]);
    });
  }, [items]);

  const selectedOrders = useMemo(
    () => items.filter((order) => selectedIds.has(order.id)),
    [items, selectedIds],
  );

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
            <Combobox
              value={query.status ?? ''}
              onChange={(value) =>
                patchQuery({ status: (value || undefined) as PodOrderStatus | undefined, page: 1 })
              }
              options={[
                { value: '', label: t('common:filter.allStatuses') },
                ...POD_ORDER_STATUSES.map((status) => ({
                  value: status,
                  label: statusLabel(status),
                })),
              ]}
              className="w-[190px]"
            />
            {/* Lọc theo KẾT NỐI (account) — danh sách lấy từ Sprint 1. */}
            <Combobox
              value={query.accountId ?? ''}
              onChange={(value) => patchQuery({ accountId: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('orders.allAccounts') },
                ...(accountsQuery.data?.items ?? []).map((account) => ({
                  value: account.id,
                  label: account.shopName ?? account.accountName,
                })),
              ]}
              className="w-[200px]"
            />
            <Combobox
              value={query.hasPodItem === undefined ? '' : String(query.hasPodItem)}
              onChange={(value) =>
                patchQuery({ hasPodItem: value === '' ? undefined : value === 'true', page: 1 })
              }
              options={[
                { value: '', label: t('orders.allProducts') },
                { value: 'true', label: t('orders.onlyPod') },
                { value: 'false', label: t('orders.notPod') },
              ]}
              className="w-[170px]"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ordersQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(ordersQuery.error)}
            </p>
          ) : (
            <>
              <BulkToolbar
                selected={selectedOrders}
                canFulfill={canFulfill}
                canViewFulfillment={canViewFulfillment}
                onClear={() => setSelectedIds(new Set())}
                onUploadDesign={setDesignItem}
                onRefresh={() => {
                  void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-orders'] });
                  void queryClient.invalidateQueries({ queryKey: ['fulfillment'] });
                }}
              />
              <PodOrderTable
                orders={items}
                accountIdByShopName={accountIdByShopName}
                selectedIds={selectedIds}
                expandedIds={expandedIds}
                canViewFulfillment={canViewFulfillment}
                canFulfill={canFulfill}
                canCancelFulfillment={canCancelFulfillment}
                loading={ordersQuery.isLoading}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onToggleExpand={toggleExpand}
                onUploadDesign={setDesignItem}
                onMapProduct={openMapProduct}
                onPreviewImages={setLightbox}
              />
            </>
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

      {/* Khai Product Mapping NGAY TẠI màn hình đơn.
          🔴 Sản phẩm TikTok và nhà cung cấp đều điền sẵn từ chính dòng hàng đang xem — người
          dùng không phải rời đơn đi tìm lại đúng dòng ở màn hình Product Mapping. Ứng viên do
          ánh xạ tự động tìm được (nếu có) hiện ngay trên cùng để chọn một phát. */}
      <MappingFormDialog
        open={Boolean(mapTarget)}
        presetAccountId={mapTarget?.accountId ?? null}
        presetTiktok={
          mapTarget
            ? {
                tiktokProductId: mapTarget.row.productId,
                tiktokSkuId: mapTarget.row.sources[0]?.skuId ?? null,
                sellerSku: mapTarget.row.sellerSku,
                productName: mapTarget.row.productName,
                skuName: mapTarget.row.skuName,
                productCategory: mapTarget.row.productCategory,
                skuImage: mapTarget.row.skuImage,
                mapped: false,
              }
            : null
        }
        candidates={mapTarget?.row.mappingCandidates ?? []}
        submitting={mappingActions.create.isPending}
        onClose={() => setMapTarget(null)}
        onSubmit={(_accountId, input) => void handleCreateMapping(input)}
        onSyncCatalog={(accountId) => void mappingActions.syncCatalog.mutateAsync(accountId)}
        syncingCatalog={mappingActions.syncCatalog.isPending}
      />

      <ImageLightbox
        open={Boolean(lightbox)}
        images={lightbox?.images}
        startIndex={lightbox?.index ?? 0}
        onClose={() => setLightbox(null)}
      />

      <SyncHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
