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
  Search,
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
import { DataPagination } from '@/components/ui/data-pagination';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { FlashSaleLogPanel } from '@/features/pod-flash-sale/components/flash-sale-log-panel';
import { PublishProgressCard } from '@/features/pod-flash-sale/components/publish-progress-card';
import { groupIssues, type GroupedIssue } from '@/features/pod-flash-sale/issue-grouping';
import { FLASH_SALE_MAX_ITEMS } from '@/features/pod-flash-sale/types';
import { ProductSelectorDialog } from '@/features/pod-flash-sale/components/product-selector-dialog';
import { SaveTemplateDialog } from '@/features/pod-flash-sale/components/save-template-dialog';
import {
  useFlashSaleProducts,
  useAddFlashSaleItems,
  useBatchUpdateFlashSaleItems,
  useCancelFlashSale,
  useDeleteFlashSaleItems,
  useDuplicateFlashSale,
  useFlashSale,
  useFlashSalePublishStatus,
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
  // Chỉ hỏi tiến độ khi đợt sale đã từng chạy — DRAFT/READY thì không có gì để hỏi.
  const publishStatus = useFlashSalePublishStatus(
    id,
    data?.status === 'PUBLISHING' || data?.status === 'FAILED' || data?.status === 'RUNNING',
  );
  const retry = useRetryFlashSale();
  const cancel = useCancelFlashSale();
  const sync = useSyncFlashSale();
  const saveTemplate = useSaveFlashSaleTemplate();
  const duplicate = useDuplicateFlashSale();

  const [form, setForm] = useState<FlashSaleFormValue | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ---------------------------------------------------------------- Bảng sản phẩm
  //
  // 🔴 Bảng đọc từ endpoint RIÊNG có phân trang theo SẢN PHẨM, không đọc `data.items`.
  // `GET /:id` trả về TOÀN BỘ dòng — với một đợt 10.000 SKU đó là vài MB mỗi lần tải màn hình.
  const [productPage, setProductPage] = useState(1);
  const [productLimit, setProductLimit] = useState(20);
  const [productSearchInput, setProductSearchInput] = useState('');
  const productSearch = useDebouncedValue(productSearchInput, 350);

  /**
   * Sản phẩm đang ĐÓNG.
   *
   * 🔴 Lưu tập ĐÓNG chứ không phải tập MỞ. Sản phẩm vừa thêm phải mở sẵn (yêu cầu sprint);
   * với một tập "đang mở", mọi sản phẩm mới sẽ mặc định đóng cho tới khi có ai đó nhớ thêm
   * nó vào — tức là mặc định sai theo đúng nghĩa đen.
   *
   * Sống ngoài component bảng nên đóng/mở KHÔNG mất khi lật trang.
   */
  const [collapsedProductIds, setCollapsedProductIds] = useState<string[]>([]);

  // Đổi từ khoá ⇒ về trang 1, nếu không người dùng đứng ở trang 7 của một kết quả 2 trang.
  useEffect(() => setProductPage(1), [productSearch]);

  const productGroups = useFlashSaleProducts(id, {
    page: productPage,
    limit: productLimit,
    search: productSearch || undefined,
  });
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

  /**
   * Dòng đã bị xoá không được nằm lại trong danh sách chọn — thanh Batch sẽ báo "3 dòng"
   * trong khi bảng chỉ còn 2.
   *
   * 🔴 Chỉ dọn trong phạm vi những SẢN PHẨM của TRANG HIỆN TẠI. Lựa chọn được phép trải qua
   * nhiều trang, nên dọn theo "mọi id không thấy trên trang này" sẽ xoá sạch những gì người
   * dùng đã tick ở trang khác. Với sản phẩm có trên trang này thì ta biết chắc dòng nào còn
   * tồn tại; với sản phẩm ở trang khác thì không biết, nên không đụng tới.
   */
  useEffect(() => {
    const groups = productGroups.data?.items;
    if (!groups) return;
    const productsOnPage = new Set(groups.map((group) => group.productId));
    const aliveOnPage = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
    const productOfItem = new Map(
      groups.flatMap((group) => group.items.map((item) => [item.id, group.productId] as const)),
    );

    setSelectedIds((current) =>
      current.filter((itemId) => {
        const owner = productOfItem.get(itemId);
        // Không rõ dòng này thuộc sản phẩm nào ⇒ nó ở trang khác ⇒ để nguyên.
        if (owner === undefined) return true;
        return productsOnPage.has(owner) && aliveOnPage.has(itemId);
      }),
    );
  }, [productGroups.data]);

  const errors = useMemo(
    () => data?.validation.issues.filter((issue) => issue.level === 'ERROR') ?? [],
    [data],
  );
  const warnings = useMemo(
    () => data?.validation.issues.filter((issue) => issue.level === 'WARNING') ?? [],
    [data],
  );
  // 🔴 Gom để HIỂN THỊ. `errors`/`warnings` ở trên vẫn giữ đủ từng bản ghi — bảng sản phẩm
  // và các phép đếm khác đọc chúng, không đọc bản đã gom.
  const errorGroups = useMemo(() => groupIssues(errors), [errors]);
  const warningGroups = useMemo(() => groupIssues(warnings), [warnings]);

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
            <ListingStatusBadge status={data.status} label={t(`flashSale.status.${data.status}`)} />
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
                  .then((result) => {
                    // Retry gửi tiếp phần chưa lên sàn trên CÙNG hoạt động khuyến mãi.
                    toast.success(
                      t('flashSale.toast.publishStarted', { count: result.totalBatches }),
                    );
                    void publishStatus.refetch();
                  })
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
                  .then((result) => {
                    // 🔴 Publish trả về khi hoạt động khuyến mãi đã tạo, các lô còn đang gửi
                    // nền. Báo "đã publish N dòng" ở đây là nói một kết quả chưa xảy ra.
                    toast.success(
                      t('flashSale.toast.publishStarted', { count: result.totalBatches }),
                    );
                    void publishStatus.refetch();
                  })
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

      {/* --------------------------------------------------------------- Tiến độ Publish */}
      {publishStatus.data && <PublishProgressCard status={publishStatus.data} />}

      {/* ------------------------------------------------------------------ Lỗi & cảnh báo */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errorGroups.length > 0 && (
            <GroupedIssueBox
              tone="error"
              // 🔴 Đếm NHÓM, không đếm bản ghi: "3 vấn đề" là số thao tác sửa thật sự, còn
              // "602 vấn đề" khiến người vận hành tưởng có 602 việc phải làm.
              title={t('flashSale.detail.errorsTitle', { count: errorGroups.length })}
              groups={errorGroups}
            />
          )}
          {warningGroups.length > 0 && (
            <GroupedIssueBox
              tone="warning"
              title={t('flashSale.detail.warningsTitle', { count: warningGroups.length })}
              groups={warningGroups}
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
                {/* 🔴 Trần hiển thị là trần LỰA CHỌN của hệ thống (10.000), KHÔNG phải trần
                    300 mục của một lượt gọi TikTok. Việc chia lô là chuyện của backend và
                    người vận hành không cần biết tới nó khi đang chọn hàng. */}
                {t('flashSale.detail.itemQuota', {
                  total: data.counts.TOTAL,
                  max: FLASH_SALE_MAX_ITEMS,
                })}
              </p>
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
          {/* Tìm sản phẩm trong đợt sale — server-side, cùng nhịp debounce với bộ chọn. */}
          <div className="relative mb-3 max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={productSearchInput}
              onChange={(event) => setProductSearchInput(event.target.value)}
              placeholder={t('flashSale.items.searchPlaceholder')}
              className="pl-9"
            />
          </div>

          {productGroups.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <FlashSaleItemTable
              groups={productGroups.data?.items ?? []}
              productLevel={data.productLevel}
              editable={editable}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              collapsedProductIds={collapsedProductIds}
              onToggleProduct={(productId) =>
                setCollapsedProductIds((current) =>
                  current.includes(productId)
                    ? current.filter((value) => value !== productId)
                    : [...current, productId],
                )
              }
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
              onDeleteProduct={(productId) => {
                // 🔴 Gỡ CẢ sản phẩm = gỡ mọi dòng SKU của nó trong một lượt. Gỡ từng dòng
                // sẽ để lại dòng mồ côi nếu có dòng nào hỏng giữa chừng.
                const group = productGroups.data?.items.find(
                  (item) => item.productId === productId,
                );
                if (!group) return;
                if (
                  !window.confirm(t('flashSale.confirm.deleteItems', { count: group.items.length }))
                ) {
                  return;
                }
                const itemIds = group.items.map((item) => item.id);
                void deleteItems
                  .mutateAsync({ id, itemIds })
                  .then(() => {
                    // Bỏ luôn khỏi lựa chọn và khỏi tập đóng — không giữ id đã biến mất.
                    setSelectedIds((current) =>
                      current.filter((value) => !itemIds.includes(value)),
                    );
                    setCollapsedProductIds((current) =>
                      current.filter((value) => value !== productId),
                    );
                    toast.success(t('flashSale.toast.itemsDeleted'));
                  })
                  .catch(onError);
              }}
            />
          )}

          <DataPagination
            meta={productGroups.data?.meta}
            onPageChange={setProductPage}
            onPageSizeChange={(next) => {
              setProductLimit(next);
              setProductPage(1);
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
        // 🔴 Sản phẩm đã có trong đợt sale (ở CẢ hai mức áp dụng): bộ chọn đánh dấu "đã
        // thêm" và khoá dòng lại, nên không tạo được bản ghi trùng.
        existingProductIds={data.productIds}
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
        currency={data.currency}
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

/**
 * Khối lỗi đã GOM NHÓM.
 *
 * 🔴 600 dòng "% giảm phải nằm trong khoảng (0, 100)" trở thành MỘT dòng kèm "600 SKU".
 * Danh sách 600 dòng giống hệt không nói thêm được điều gì, mà lại che mất hai lỗi thật sự
 * khác nằm lẫn bên trong.
 *
 * 🔴 Chỉ TẦNG HIỂN THỊ gom lại — `data.validation.issues` vẫn giữ đủ từng bản ghi kèm
 * `itemId`, nên bảng sản phẩm bên dưới vẫn chỉ ra chính xác dòng nào hỏng. Nhóm có nhiều
 * câu chữ khác nhau thì mở ra xem được vài ví dụ.
 */
function GroupedIssueBox({
  tone,
  title,
  groups,
}: {
  tone: 'error' | 'warning';
  title: string;
  groups: GroupedIssue[];
}) {
  const { t } = useTranslation('pod');
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
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {groups.map((group) => (
          <li key={group.key}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span>• {group.message}</span>
              {/* Số dòng bị ảnh hưởng — thứ mà một danh sách lặp 600 lần không nói rõ được. */}
              {group.affectedItems > 0 && (
                <span className="tabular-nums opacity-70">
                  {t('flashSale.detail.issueAffected', { count: group.affectedItems })}
                </span>
              )}
            </div>
            {/* Nhiều câu chữ khác nhau trong cùng một mã ⇒ cho xem vài ví dụ cụ thể. */}
            {group.samples.length > 1 && (
              <details className="ml-3 mt-0.5">
                <summary className="cursor-pointer opacity-70">
                  {t('flashSale.detail.issueSamples')}
                </summary>
                <ul className="ml-3 list-inside list-disc space-y-0.5 pt-0.5">
                  {group.samples.map((sample, index) => (
                    <li key={`${group.key}-${index}`}>{sample}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
