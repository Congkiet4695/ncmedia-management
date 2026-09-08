'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, Copy, Eye, Plus, Rocket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { shopOptionLabel } from '@/features/pod-tiktok/shop-label';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { DuplicateFlashSaleDialog } from '@/features/pod-flash-sale/components/duplicate-flash-sale-dialog';
import {
  useCancelFlashSale,
  useDeleteFlashSale,
  useDuplicateFlashSale,
  useFlashSales,
  usePublishFlashSale,
} from '@/features/pod-flash-sale/hooks';
import {
  POD_FLASH_SALE_STATUSES,
  type PodFlashSaleListItem,
  type PodFlashSaleStatus,
} from '@/features/pod-flash-sale/types';

export default function FlashSalesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.flashsale.read" message={t('flashSale.noPermission')}>
      <FlashSaleListView />
    </RequirePermission>
  );
}

/**
 * **POD → Flash Sales** — danh sách các đợt khuyến mãi giới hạn thời gian.
 *
 * 🔴 Màn hình này **chỉ đọc database**. Không dòng nào ở đây gọi TikTok, kể cả khi bảng tự
 * làm mới 30 giây một lần: trạng thái phía sàn do scheduler của backend kéo về. Đó là lý do
 * mở màn hình này cho 500 đợt sale không tốn một lượt quota nào.
 */
function FlashSaleListView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();

  const canWrite = hasPermission('pod.flashsale.write');
  const canPublish = hasPermission('pod.flashsale.publish');

  const [page, setPage] = useState(1);
  // Cỡ trang do người dùng chọn (ô "Số dòng mỗi trang"); đổi cỡ thì luôn về trang 1
  // vì trang cũ có thể không còn tồn tại ở cỡ mới.
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodFlashSaleStatus | ''>('');
  const [shopId, setShopId] = useState('');
  const [startFrom, setStartFrom] = useState('');
  const [startTo, setStartTo] = useState('');
  const [duplicating, setDuplicating] = useState<PodFlashSaleListItem | null>(null);

  const shops = usePodProductFilters().data?.shops ?? [];
  const flashSales = useFlashSales({
    page,
    limit,
    search: search || undefined,
    status: status || undefined,
    shopId: shopId || undefined,
    // `datetime-local` cho giờ treo tường của MÁY người dùng — bộ lọc theo ngày không cần
    // độ chính xác múi giờ như khung giờ của đợt sale, nên chuyển thẳng sang ISO là đủ.
    startFrom: startFrom ? new Date(startFrom).toISOString() : undefined,
    startTo: startTo ? new Date(startTo).toISOString() : undefined,
  });

  const remove = useDeleteFlashSale();
  const duplicate = useDuplicateFlashSale();
  const publish = usePublishFlashSale();
  const cancel = useCancelFlashSale();

  const items = flashSales.data?.items ?? [];

  const onError = (error: unknown): void => {
    toast.error(translateApiError(error));
  };

  return (
    <>
      <TemplatePageShell
        title={t('flashSale.title')}
        subtitle={t('flashSale.subtitle')}
        createLabel={t('flashSale.create')}
        onCreate={canWrite ? () => router.push('/dashboard/pod/flash-sales/new') : undefined}
        loading={flashSales.isLoading}
        error={flashSales.error}
        empty={items.length === 0}
        emptyMessage={t('flashSale.empty')}
        onSearchChange={setSearch}
        searchPlaceholder={t('flashSale.searchPlaceholder')}
        meta={flashSales.data?.meta ?? null}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setLimit(next);
          setPage(1);
        }}
        filters={
          <>
            <Combobox
              value={status}
              onChange={(value) => setStatus(value as PodFlashSaleStatus | '')}
              options={[
                { value: '', label: t('flashSale.allStatuses') },
                ...POD_FLASH_SALE_STATUSES.map((value) => ({
                  value,
                  label: t(`flashSale.status.${value}`),
                })),
              ]}
              className="w-[180px]"
            />
            <Combobox
              value={shopId}
              onChange={setShopId}
              options={[
                { value: '', label: t('flashSale.allShops') },
                ...shops.map((shop) => ({ value: shop.id, label: shopOptionLabel(shop) })),
              ]}
              className="w-[200px]"
            />
            <Input
              type="date"
              value={startFrom}
              onChange={(event) => setStartFrom(event.target.value)}
              className="w-[160px]"
              aria-label={t('flashSale.filterStartFrom')}
            />
            <Input
              type="date"
              value={startTo}
              onChange={(event) => setStartTo(event.target.value)}
              className="w-[160px]"
              aria-label={t('flashSale.filterStartTo')}
            />
          </>
        }
        actions={
          !canWrite ? undefined : (
            <Button variant="outline" onClick={() => router.push('/dashboard/pod/flash-sales/new')}>
              <Plus className="size-4" />
              {t('flashSale.create')}
            </Button>
          )
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('flashSale.columns.name')}</TableHead>
                <TableHead>{t('flashSale.columns.shop')}</TableHead>
                <TableHead>{t('flashSale.columns.status')}</TableHead>
                <TableHead>{t('flashSale.columns.start')}</TableHead>
                <TableHead>{t('flashSale.columns.end')}</TableHead>
                <TableHead className="text-right">{t('flashSale.columns.items')}</TableHead>
                <TableHead>{t('flashSale.columns.createdBy')}</TableHead>
                <TableHead>{t('flashSale.columns.updated')}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((flashSale) => (
                <TableRow key={flashSale.id}>
                  <TableCell className="max-w-[240px]">
                    <Link
                      href={`/dashboard/pod/flash-sales/${flashSale.id}`}
                      className="font-medium hover:underline"
                    >
                      {flashSale.name}
                    </Link>
                    {flashSale.lastErrorMessage && (
                      <p className="truncate text-xs text-destructive">
                        {flashSale.lastErrorCode ? `${flashSale.lastErrorCode} — ` : ''}
                        {flashSale.lastErrorMessage}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{flashSale.shop.name}</TableCell>
                  <TableCell>
                    <ListingStatusBadge
                      status={flashSale.status}
                      label={t(`flashSale.status.${flashSale.status}`)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(flashSale.startAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(flashSale.endAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{flashSale.itemCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {flashSale.createdByUser?.fullName ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(flashSale.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild title={t('common:action.view')}>
                        <Link href={`/dashboard/pod/flash-sales/${flashSale.id}`}>
                          <Eye className="size-4" />
                        </Link>
                      </Button>

                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('flashSale.actions.duplicate')}
                          onClick={() => setDuplicating(flashSale)}
                        >
                          <Copy className="size-4" />
                        </Button>
                      )}

                      {canPublish && flashSale.status !== 'RUNNING' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('flashSale.actions.publish')}
                          disabled={publish.isPending || flashSale.status === 'PUBLISHING'}
                          onClick={() => {
                            if (!window.confirm(t('flashSale.confirm.publish', { name: flashSale.name }))) return;
                            void publish
                              .mutateAsync({ id: flashSale.id })
                              .then((result) =>
                                toast.success(
                                  t('flashSale.toast.published', { count: result.publishedItems }),
                                ),
                              )
                              .catch(onError);
                          }}
                        >
                          <Rocket className="size-4" />
                        </Button>
                      )}

                      {canPublish && flashSale.status === 'RUNNING' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('flashSale.actions.cancel')}
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (!window.confirm(t('flashSale.confirm.cancel', { name: flashSale.name }))) return;
                            void cancel
                              .mutateAsync(flashSale.id)
                              .then(() => toast.success(t('flashSale.toast.cancelled')))
                              .catch(onError);
                          }}
                        >
                          <Ban className="size-4" />
                        </Button>
                      )}

                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('common:action.delete')}
                          onClick={() => {
                            if (!window.confirm(t('flashSale.confirm.delete', { name: flashSale.name }))) return;
                            void remove
                              .mutateAsync(flashSale.id)
                              .then(() => toast.success(t('flashSale.toast.deleted')))
                              .catch(onError);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TemplatePageShell>

      <DuplicateFlashSaleDialog
        open={duplicating !== null}
        onClose={() => setDuplicating(null)}
        source={duplicating}
        submitting={duplicate.isPending}
        onSubmit={(payload) => {
          if (!duplicating) return;
          void duplicate
            .mutateAsync({ id: duplicating.id, payload })
            .then((created) => {
              setDuplicating(null);
              toast.success(t('flashSale.toast.duplicated'));
              router.push(`/dashboard/pod/flash-sales/${created.id}`);
            })
            .catch(onError);
        }}
      />
    </>
  );
}
