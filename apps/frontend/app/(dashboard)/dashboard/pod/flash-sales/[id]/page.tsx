'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { DuplicateFlashSaleDialog } from '@/features/pod-flash-sale/components/duplicate-flash-sale-dialog';
import { FlashSaleBatchDialog } from '@/features/pod-flash-sale/components/flash-sale-batch-dialog';
import {
  FlashSaleForm,
  type FlashSaleFormValue,
} from '@/features/pod-flash-sale/components/flash-sale-form';
import { FlashSaleItemTable } from '@/features/pod-flash-sale/components/flash-sale-item-table';
import { FlashSaleLogPanel } from '@/features/pod-flash-sale/components/flash-sale-log-panel';
import { ProductSelectorDialog } from '@/features/pod-flash-sale/components/product-selector-dialog';
import { SaveTemplateDialog } from '@/features/pod-flash-sale/components/save-template-dialog';
import {
  useAddFlashSaleItems,
  useBatchUpdateFlashSaleItems,
  useCancelFlashSale,
  useDeleteFlashSaleItems,
  useDuplicateFlashSale,
  useFlashSale,
  usePublishFlashSale,
  useRetryFlashSale,
  useSaveFlashSaleTemplate,
  useSyncFlashSale,
  useUpdateFlashSale,
  useUpdateFlashSaleItem,
} from '@/features/pod-flash-sale/hooks';
import { localToUtcIso, utcIsoToLocal } from '@/features/pod-flash-sale/timezone';

export default function FlashSaleDetailPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.flashsale.read" message={t('flashSale.noPermission')}>
      <FlashSaleDetailView />
    </RequirePermission>
  );
}

/**
 * **Chi tiết Flash Sale** — nơi soạn, kiểm và đẩy một đợt khuyến mãi lên sàn.
 *
 * ```
 *   Thông tin ──▶ Sản phẩm (Add · Batch · Edit) ──▶ Kiểm tra ──▶ Publish
 *                                                       │
 *                                          Save as Template · Duplicate
 * ```
 *
 * 🔴 Đợt sale đang chạy trên sàn (`editable = false`) khoá TOÀN BỘ đường ghi — form, bảng
 * sản phẩm và thanh Batch. Quyền quyết định thuộc về server (`detail.editable`), giao diện
 * chỉ phản ánh; tự suy ra từ `status` ở đây là mở đường cho hai tầng lệch nhau.
 */
function FlashSaleDetailView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();

  const canWrite = hasPermission('pod.flashsale.write');
  const canPublish = hasPermission('pod.flashsale.publish');

  const detail = useFlashSale(id);
  const data = detail.data;

  const update = useUpdateFlashSale();
  const addItems = useAddFlashSaleItems();
  const updateItem = useUpdateFlashSaleItem();
  const batchUpdate = useBatchUpdateFlashSaleItems();
  const deleteItems = useDeleteFlashSaleItems();
  const publish = usePublishFlashSale();
  const retry = useRetryFlashSale();
  const cancel = useCancelFlashSale();
  const sync = useSyncFlashSale();
  const saveTemplate = useSaveFlashSaleTemplate();
  const duplicate = useDuplicateFlashSale();

  const [form, setForm] = useState<FlashSaleFormValue | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  // 🔴 Nạp form từ dữ liệu server ĐÚNG MỘT LẦN cho mỗi đợt sale. Đồng bộ lại ở mọi lần
  // `data` đổi sẽ xoá sạch những gì người dùng đang gõ mỗi 30 giây, khi bảng tự làm mới.
  // `formLoadedFor` ghi nhớ form đang thuộc về đợt nào, để điều hướng sang đợt khác vẫn nạp
  // lại đúng dữ liệu mới thay vì giữ form cũ.
  const [formLoadedFor, setFormLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!data || formLoadedFor === data.id) return;
    setForm({
      shopId: data.shop.id,
      name: data.name,
      description: data.description ?? '',
      startLocal: utcIsoToLocal(data.startAt, data.timezone),
      endLocal: utcIsoToLocal(data.endAt, data.timezone),
      timezone: data.timezone,
      productLevel: data.productLevel,
      templateId: '',
    });
    setFormLoadedFor(data.id);
  }, [data, formLoadedFor]);

  // Dòng đã bị xoá không được nằm lại trong danh sách chọn — thanh Batch sẽ báo "3 dòng"
  // trong khi bảng chỉ còn 2.
  useEffect(() => {
    if (!data) return;
    const alive = new Set(data.items.map((item) => item.id));
    setSelectedIds((current) => current.filter((itemId) => alive.has(itemId)));
  }, [data]);

  const errors = useMemo(
    () => data?.validation.issues.filter((issue) => issue.level === 'ERROR') ?? [],
    [data],
  );
  const warnings = useMemo(
    () => data?.validation.issues.filter((issue) => issue.level === 'WARNING') ?? [],
    [data],
  );

  const onError = (error: unknown): void => {
    toast.error(translateApiError(error));
  };

  if (detail.isLoading || !data || !form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const editable = canWrite && data.editable;

  const saveInfo = (): void => {
    const startAt = localToUtcIso(form.startLocal, form.timezone);
    const endAt = localToUtcIso(form.endLocal, form.timezone);
    void update
      .mutateAsync({
        id,
        payload: {
          name: form.name.trim(),
          description: form.description.trim(),
          startAt: startAt ?? undefined,
          endAt: endAt ?? undefined,
          timezone: form.timezone,
          productLevel: form.productLevel,
        },
      })
      .then(() => toast.success(t('flashSale.toast.saved')))
      .catch(onError);
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ Tiêu đề + thao tác */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
            {t('common:action.back')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
            <ListingStatusBadge
              status={data.status}
              label={t(`flashSale.status.${data.status}`)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {data.shop.name} · {formatDateTime(data.startAt)} → {formatDateTime(data.endAt)} ·{' '}
            {data.timezone}
          </p>
          {data.providerFlashSaleId && (
            <p className="text-xs text-muted-foreground">
              {t('flashSale.detail.activityId')}:{' '}
              <span className="select-all font-mono">{data.providerFlashSaleId}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void sync
                .mutateAsync(id)
                .then(() => toast.success(t('flashSale.toast.synced')))
                .catch(onError);
            }}
            disabled={sync.isPending || !data.providerFlashSaleId}
            title={t('flashSale.detail.syncHint')}
          >
            {sync.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('common:action.refresh')}
          </Button>

          {canWrite && (
            <Button variant="outline" onClick={() => setTemplateOpen(true)}>
              <Save className="size-4" />
              {t('flashSale.actions.saveTemplate')}
            </Button>
          )}

          {canWrite && (
            <Button variant="outline" onClick={() => setDuplicateOpen(true)}>
              <Copy className="size-4" />
              {t('flashSale.actions.duplicate')}
            </Button>
          )}

          {canPublish && data.status === 'RUNNING' && (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => {
                if (!window.confirm(t('flashSale.confirm.cancel', { name: data.name }))) return;
                void cancel
                  .mutateAsync(id)
                  .then(() => toast.success(t('flashSale.toast.cancelled')))
                  .catch(onError);
              }}
            >
              <Ban className="size-4" />
              {t('flashSale.actions.cancel')}
            </Button>
          )}

          {canPublish && data.status === 'FAILED' && (
            <Button
              disabled={retry.isPending}
              onClick={() => {
                void retry
                  .mutateAsync({ id })
                  .then((result) =>
                    toast.success(t('flashSale.toast.published', { count: result.publishedItems })),
                  )
                  .catch(onError);
              }}
            >
              {retry.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t('flashSale.actions.retry')}
            </Button>
          )}

          {canPublish && data.status !== 'FAILED' && data.status !== 'RUNNING' && (
            <Button
              disabled={!data.publishable || publish.isPending}
              title={data.publishable ? undefined : t('flashSale.detail.publishBlocked')}
              onClick={() => {
                if (!window.confirm(t('flashSale.confirm.publish', { name: data.name }))) return;
                void publish
                  .mutateAsync({ id })
                  .then((result) =>
                    toast.success(t('flashSale.toast.published', { count: result.publishedItems })),
                  )
                  .catch(onError);
              }}
            >
              {publish.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {t('flashSale.actions.publish')}
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ Lỗi & cảnh báo */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.length > 0 && (
            <IssueBox
              tone="error"
              title={t('flashSale.detail.errorsTitle', { count: errors.length })}
              issues={errors.map((issue) => issue.message)}
            />
          )}
          {warnings.length > 0 && (
            <IssueBox
              tone="warning"
              title={t('flashSale.detail.warningsTitle', { count: warnings.length })}
              issues={warnings.map((issue) => issue.message)}
            />
          )}
        </div>
      )}

      {data.lastErrorMessage && data.status === 'FAILED' && (
        <IssueBox
          tone="error"
          title={t('flashSale.detail.lastErrorTitle', {
            code: data.lastErrorCode ?? '—',
            attempt: data.retryCount,
          })}
          issues={[data.lastErrorMessage]}
        />
      )}

      {/* -------------------------------------------------------------------- Thông tin */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="font-semibold">{t('flashSale.detail.infoSection')}</h2>
          {editable && (
            <Button size="sm" onClick={saveInfo} disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('common:action.save')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <FlashSaleForm
            value={form}
            onChange={(next) => setForm((current) => (current ? { ...current, ...next } : current))}
            mode="edit"
            disabled={!editable || update.isPending}
          />
        </CardContent>
      </Card>

      {/* --------------------------------------------------------------------- Sản phẩm */}
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">{t('flashSale.detail.itemsSection')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('flashSale.detail.itemCounts', {
                  total: data.counts.TOTAL,
                  ready: data.counts.READY + data.counts.PUBLISHED,
                  pending: data.counts.PENDING,
                  failed: data.counts.FAILED,
                })}
              </p>
            </div>
            {editable && (
              <Button onClick={() => setSelectorOpen(true)} disabled={addItems.isPending}>
                <Plus className="size-4" />
                {t('flashSale.actions.addProducts')}
              </Button>
            )}
          </div>

          {/* Thanh Batch — chỉ hiện khi có dòng được chọn, đúng cách TikCRM làm. */}
          {editable && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-sm">
                {t('flashSale.detail.selected', { count: selectedIds.length })}
              </span>
              <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
                {t('flashSale.actions.batchEdit')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={deleteItems.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      t('flashSale.confirm.deleteItems', { count: selectedIds.length }),
                    )
                  ) {
                    return;
                  }
                  void deleteItems
                    .mutateAsync({ id, itemIds: selectedIds })
                    .then(() => {
                      setSelectedIds([]);
                      toast.success(t('flashSale.toast.itemsDeleted'));
                    })
                    .catch(onError);
                }}
              >
                <Trash2 className="size-4 text-destructive" />
                {t('common:action.delete')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                {t('flashSale.detail.clearSelection')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <FlashSaleItemTable
            items={data.items}
            editable={editable}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            savingItemId={updateItem.isPending ? updateItem.variables?.itemId : null}
            onSaveItem={(itemId, payload) => {
              void updateItem
                .mutateAsync({ id, itemId, payload })
                .then(() => toast.success(t('flashSale.toast.itemSaved')))
                .catch(onError);
            }}
            onDeleteItem={(itemId) => {
              if (!window.confirm(t('flashSale.confirm.deleteItems', { count: 1 }))) return;
              void deleteItems
                .mutateAsync({ id, itemIds: [itemId] })
                .then(() => toast.success(t('flashSale.toast.itemsDeleted')))
                .catch(onError);
            }}
          />
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------------- Nhật ký */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('flashSale.detail.historySection')}</h2>
          <p className="text-xs text-muted-foreground">{t('flashSale.detail.historyHint')}</p>
        </CardHeader>
        <CardContent>
          <FlashSaleLogPanel flashSaleId={id} />
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------------- Dialogs */}
      <ProductSelectorDialog
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        shopId={data.shop.id}
        existingProductIds={data.items.map((item) => item.productId)}
        submitting={addItems.isPending}
        onSubmit={(items) => {
          void addItems
            .mutateAsync({ id, items })
            .then((updated) => {
              setSelectorOpen(false);
              toast.success(t('flashSale.toast.itemsAdded', { count: updated.counts.TOTAL }));
            })
            .catch(onError);
        }}
      />

      <FlashSaleBatchDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        count={selectedIds.length}
        currency={data.items[0]?.currency ?? null}
        submitting={batchUpdate.isPending}
        onSubmit={(payload) => {
          void batchUpdate
            .mutateAsync({ id, payload: { ...payload, itemIds: selectedIds } })
            .then(() => {
              setBatchOpen(false);
              toast.success(t('flashSale.toast.batchApplied', { count: selectedIds.length }));
            })
            .catch(onError);
        }}
      />

      <SaveTemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        defaultName={data.name}
        itemCount={data.counts.TOTAL}
        submitting={saveTemplate.isPending}
        onSubmit={(payload) => {
          void saveTemplate
            .mutateAsync({ id, payload })
            .then(() => {
              setTemplateOpen(false);
              toast.success(t('flashSale.toast.templateSaved'));
            })
            .catch(onError);
        }}
      />

      <DuplicateFlashSaleDialog
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        source={data}
        submitting={duplicate.isPending}
        onSubmit={(payload) => {
          void duplicate
            .mutateAsync({ id, payload })
            .then((created) => {
              setDuplicateOpen(false);
              toast.success(t('flashSale.toast.duplicated'));
              router.push(`/dashboard/pod/flash-sales/${created.id}`);
            })
            .catch(onError);
        }}
      />
    </div>
  );
}

/** Khối lỗi/cảnh báo — hai tông màu, một bố cục. */
function IssueBox({
  tone,
  title,
  issues,
}: {
  tone: 'error' | 'warning';
  title: string;
  issues: string[];
}) {
  const isError = tone === 'error';
  return (
    <div
      className={
        isError
          ? 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2'
          : 'rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2'
      }
    >
      <p
        className={
          isError
            ? 'flex items-center gap-2 text-sm font-medium text-destructive'
            : 'flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400'
        }
      >
        <AlertTriangle className="size-4" />
        {title}
      </p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
        {issues.map((message, index) => (
          <li key={`${index}-${message}`}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
