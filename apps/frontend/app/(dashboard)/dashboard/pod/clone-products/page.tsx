'use client';

import { useMemo, useState } from 'react';
import { FileSearch, ImageOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { CloneBatchDetailDialog } from '@/features/pod-product/components/clone-batch-detail-dialog';
import { CloneProgress, CloneStatusBadge } from '@/features/pod-product/components/clone-status';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { useProductClones } from '@/features/pod-product/hooks/use-product-clones';
import { POD_PRODUCT_CLONE_STATUSES, type PodProductCloneStatus } from '@/features/pod-product/types';
import { shopOptionLabel } from '@/features/pod-tiktok/shop-label';
import { cn } from '@/lib/utils';

export default function CloneProductsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.clone" message={t('cloneProducts.noPermission')}>
      <CloneProductsView />
    </RequirePermission>
  );
}

/** Ngày chọn trên ô lọc → mốc ISO: `from` đầu ngày, `to` CUỐI ngày (để "đến 22/09" gồm cả 22/09). */
function dayStart(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}
function dayEnd(date: string): string | undefined {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}

/**
 * **POD → Clone Products** — sản phẩm đang được nhân bản và lịch sử các lượt nhân bản.
 *
 * Một dòng = một LƯỢT (1 sản phẩm nguồn → N shop đích): trạng thái tổng, tiến độ `3/5`, đếm
 * thành công / đang xử lý / thất bại; mở chi tiết thấy từng shop, TikTok id, lỗi, và chạy lại
 * riêng các shop FAILED.
 *
 * 🔴 Tự làm mới 2 giây/lần khi trang còn lượt đang chạy (hook), thêm nút Làm mới cho người
 * muốn xem ngay. Seller chỉ thấy lượt của mình; Admin thấy cả tổ chức và lọc được theo
 * người tạo (`creators` chỉ có trong response của Admin).
 */
function CloneProductsView() {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodProductCloneStatus | ''>('');
  const [sourceShopId, setSourceShopId] = useState('');
  const [targetShopId, setTargetShopId] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = usePodProductFilters();
  const shops = useMemo(() => filters.data?.shops ?? [], [filters.data?.shops]);

  const clones = useProductClones({
    page,
    limit,
    search: search || undefined,
    status: status || undefined,
    sourceShopId: sourceShopId || undefined,
    targetShopId: targetShopId || undefined,
    createdBy: createdBy || undefined,
    from: dayStart(from),
    to: dayEnd(to),
  });

  const items = clones.data?.items ?? [];
  const creators = clones.data?.creators ?? [];
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <>
      <TemplatePageShell
        title={t('cloneProducts.title')}
        subtitle={t('cloneProducts.subtitle')}
        loading={clones.isLoading}
        error={clones.error}
        empty={items.length === 0}
        emptyMessage={t('cloneProducts.empty')}
        meta={clones.data?.meta ?? null}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setLimit(next);
          setPage(1);
        }}
        searchPlaceholder={t('cloneProducts.searchPlaceholder')}
        onSearchChange={resetPage(setSearch)}
        actions={
          <Button variant="outline" disabled={clones.isFetching} onClick={() => void clones.refetch()}>
            <RefreshCw className={cn('size-4', clones.isFetching && 'animate-spin')} />
            {t('common:action.refresh')}
          </Button>
        }
        filters={
          <>
            <Combobox
              value={status}
              className="w-[170px]"
              onChange={resetPage((value: string) => setStatus(value as PodProductCloneStatus | ''))}
              options={[
                { value: '', label: t('cloneProducts.filters.allStatuses') },
                ...POD_PRODUCT_CLONE_STATUSES.map((value) => ({ value, label: t(`cloneProducts.status.${value}`) })),
              ]}
            />
            <Combobox
              value={sourceShopId}
              className="w-[200px]"
              onChange={resetPage(setSourceShopId)}
              options={[
                { value: '', label: t('cloneProducts.filters.allSourceShops') },
                ...shops.map((shop) => ({ value: shop.id, label: shopOptionLabel(shop) })),
              ]}
            />
            <Combobox
              value={targetShopId}
              className="w-[200px]"
              onChange={resetPage(setTargetShopId)}
              options={[
                { value: '', label: t('cloneProducts.filters.allTargetShops') },
                ...shops.map((shop) => ({ value: shop.id, label: shopOptionLabel(shop) })),
              ]}
            />
            {creators.length > 0 && (
              <Combobox
                value={createdBy}
                className="w-[180px]"
                onChange={resetPage(setCreatedBy)}
                options={[
                  { value: '', label: t('cloneProducts.filters.allCreators') },
                  ...creators.map((creator) => ({ value: creator.id, label: creator.name })),
                ]}
              />
            )}
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => resetPage(setFrom)(event.target.value)}
              className="w-[160px]"
              aria-label={t('cloneProducts.filters.from')}
            />
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => resetPage(setTo)(event.target.value)}
              className="w-[160px]"
              aria-label={t('cloneProducts.filters.to')}
            />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cloneProducts.columns.product')}</TableHead>
              <TableHead>{t('cloneProducts.columns.sourceShop')}</TableHead>
              <TableHead className="text-right">{t('cloneProducts.columns.targetShops')}</TableHead>
              <TableHead className="text-right">{t('cloneProducts.columns.success')}</TableHead>
              <TableHead className="text-right">{t('cloneProducts.columns.processing')}</TableHead>
              <TableHead className="text-right">{t('cloneProducts.columns.failed')}</TableHead>
              <TableHead>{t('cloneProducts.columns.status')}</TableHead>
              <TableHead className="w-[180px]">{t('cloneProducts.columns.progress')}</TableHead>
              <TableHead>{t('cloneProducts.columns.createdBy')}</TableHead>
              <TableHead>{t('cloneProducts.columns.createdAt')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell className="max-w-[300px]">
                  <div className="flex items-center gap-2">
                    {batch.product?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={batch.product.thumbnailUrl} alt="" className="size-10 shrink-0 rounded border object-cover" />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted">
                        <ImageOff className="size-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug">
                        {batch.product?.title?.trim() || batch.product?.tiktokProductId || batch.name}
                      </p>
                      {batch.product && (
                        <p className="font-mono text-xs text-muted-foreground">{batch.product.tiktokProductId}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[180px] text-sm">
                  <span className="line-clamp-2">{batch.sourceShop ? shopOptionLabel(batch.sourceShop) : '—'}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{batch.counts.total}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{batch.counts.success}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-600">
                  {batch.counts.processing + batch.counts.pending}
                </TableCell>
                <TableCell className="text-right tabular-nums text-destructive">{batch.counts.failed}</TableCell>
                <TableCell>
                  <CloneStatusBadge status={batch.status} />
                </TableCell>
                <TableCell>
                  <CloneProgress batch={batch} compact />
                </TableCell>
                <TableCell className="max-w-[160px] text-sm">
                  <span className="line-clamp-1" title={batch.createdBy?.email}>
                    {batch.createdBy?.name ?? '—'}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  <p>{formatDateTime(batch.createdAt)}</p>
                  {batch.updatedAt !== batch.createdAt && (
                    <p className="text-xs">
                      {t('cloneProducts.columns.updatedAt')}: {formatDateTime(batch.updatedAt)}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" title={t('cloneProducts.viewDetail')} onClick={() => setOpenId(batch.id)}>
                      <FileSearch className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TemplatePageShell>

      <CloneBatchDetailDialog batchId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
