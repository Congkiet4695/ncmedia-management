'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ImageOff,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { ShopMultiSelect } from '@/features/pod-listing-session/components/shop-multi-select';
import { useListingJob, useListingJobItems } from '@/features/pod-listing/hooks/use-pod-listing';
import type { PodListingItemStatus, PodListingJobItem } from '@/features/pod-listing/types';
import { cn } from '@/lib/utils';
import { useClonePodProduct, usePodProductFilters } from '../hooks/use-pod-products';
import { buildProductGallery } from '../product-images';
import type { PodProductListItem } from '../types';

interface CloneProductDialogProps {
  open: boolean;
  /** Sản phẩm NGUỒN — đúng một. Chọn nhiều sản phẩm thì trang cha đã chặn trước khi mở. */
  product: PodProductListItem;
  /**
   * Đóng dialog. `hadResult = true` khi đã có lượt chạy (kể cả đang chạy) — trang cha làm
   * mới danh sách; sản phẩm mới chỉ về sau lượt đồng bộ được hẹn, nhưng trạng thái hàng đợi
   * và Publish History đã đổi.
   */
  onClose: (hadResult: boolean) => void;
}

/** Trần số item tải về cho màn kết quả — bằng trần shop đích một lượt ở backend. */
const RESULT_PAGE_SIZE = 50;

const RUNNING: ReadonlySet<PodListingItemStatus> = new Set(['PENDING', 'PROCESSING', 'RETRYING']);

/**
 * **Nhân bản sản phẩm** — 1 sản phẩm nguồn → NHIỀU shop đích.
 *
 * ```
 *   Bước 1: nguồn (ảnh, tên, ID, SKU) + chọn nhiều shop (tìm, chọn tất cả, bỏ chọn)
 *   Bước 2: submit ⇒ backend tạo Listing Job type CLONE ⇒ dialog chuyển sang màn kết quả
 *           theo dõi TỪNG shop (✓ thành công · ⊘ bỏ qua · ✕ thất bại · ⏳ đang xử lý) qua polling
 * ```
 *
 * 🔴 Danh sách shop chỉ gồm shop người dùng được thấy (API `filters` đã lọc theo phạm vi) —
 * tiện lợi, KHÔNG phải hàng rào: backend kiểm lại từng shop đích và trả 403 nếu có shop lạ.
 *
 * 🔴 Chống bấm đúp: nút khoá khi mutation đang chạy VÀ hàm submit tự thoát nếu đang chạy;
 * backend còn khoá theo sản phẩm nguồn (409) — nút disable chỉ là lớp đầu tiên.
 */
export function CloneProductDialog({ open, product, onClose }: CloneProductDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const filters = usePodProductFilters();
  const cloneMutation = useClonePodProduct();

  const [shopIds, setShopIds] = useState<string[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  /** Job vừa tạo — có giá trị ⇒ đang ở màn kết quả. */
  const [jobId, setJobId] = useState<string | null>(null);

  // Shop nguồn bị loại khỏi lựa chọn: nhân bản vào chính nó là tạo sản phẩm trùng (backend
  // cũng bỏ qua, nhưng không nên mời người dùng chọn một thứ chắc chắn bị bỏ qua).
  const shopOptions = useMemo(
    () =>
      (filters.data?.shops ?? [])
        .filter((shop) => shop.id !== product.shopId)
        .map((shop) => ({
          id: shop.id,
          name: shop.name,
          connectionName: shop.connectionName,
          region: shop.region ?? undefined,
        })),
    [filters.data?.shops, product.shopId],
  );
  const shopLabel = useMemo(
    () => new Map(shopOptions.map((shop) => [shop.id, `${shop.connectionName} · ${shop.name}`])),
    [shopOptions],
  );

  const submit = async () => {
    // Lớp 1 chống bấm đúp: mutation đang bay thì lần bấm thứ hai không làm gì.
    if (cloneMutation.isPending) return;
    if (shopIds.length === 0) {
      setValidation(t('products.clone.needShop'));
      return;
    }
    setValidation(null);
    try {
      const job = await cloneMutation.mutateAsync({ id: product.id, payload: { targetShopIds: shopIds } });
      setJobId(job.id);
      toast.success(t('products.clone.started', { count: shopIds.length }));
    } catch (error) {
      toast.error(t('products.clone.failed'), { description: translateApiError(error) });
    }
  };

  const close = () => onClose(jobId !== null);
  const gallery = buildProductGallery(product.mainImages);
  const thumb = gallery[0]?.thumb;

  return (
    <Modal
      open={open}
      onClose={cloneMutation.isPending ? () => undefined : close}
      title={t('products.clone.title')}
      description={jobId ? undefined : t('products.clone.description')}
      className="max-w-2xl"
      footer={
        jobId ? (
          <div className="flex justify-end">
            <Button onClick={close}>{t('common:action.close')}</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('products.clone.publishHint')}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={close} disabled={cloneMutation.isPending}>
                {t('common:action.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={cloneMutation.isPending || filters.isLoading}>
                {cloneMutation.isPending ? <Loader2 className="animate-spin" /> : <Copy />}
                {t('products.clone.action')}
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {/* ---------- Sản phẩm nguồn ---------- */}
        <section className="space-y-2">
          <Label>{t('products.clone.source')}</Label>
          <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="size-16 shrink-0 rounded-md border object-cover" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-muted">
                <ImageOff className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 space-y-1 text-sm">
              <p className="line-clamp-2 font-medium leading-snug">
                {product.title?.trim() || product.tiktokProductId}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="text-muted-foreground/70">{t('products.meta.id')}: </span>
                <span className="font-mono">{product.tiktokProductId}</span>
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {product.sellerSku && (
                  <span>
                    <span className="text-muted-foreground/70">{t('products.meta.sku')}: </span>
                    <span className="font-mono">{product.sellerSku}</span>
                    {product.skuCount > 1 && ` ${t('products.meta.moreSkus', { count: product.skuCount - 1 })}`}
                  </span>
                )}
                {product.shopName && (
                  <span>
                    <span className="text-muted-foreground/70">{t('products.meta.shop')}: </span>
                    {product.shopName}
                  </span>
                )}
                {product.categoryName && (
                  <span className="truncate">
                    <span className="text-muted-foreground/70">{t('products.meta.category')}: </span>
                    {product.categoryName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {jobId ? (
          <CloneResult jobId={jobId} shopLabel={shopLabel} />
        ) : (
          <section className="space-y-2">
            <Label>
              {t('products.clone.targets')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <ShopMultiSelect
              options={shopOptions}
              value={shopIds}
              onChange={(next) => {
                setShopIds(next);
                if (next.length > 0) setValidation(null);
              }}
              loading={filters.isLoading}
            />
            {validation && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="size-4" />
                {validation}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('products.clone.copyHint')}</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

/**
 * Màn kết quả: tiến độ + trạng thái TỪNG shop, cập nhật 2 giây/lần khi còn item đang chạy.
 *
 * 🔴 Job sống ở SERVER — đóng dialog không dừng gì; lượt chạy vẫn xem lại được ở Publish History.
 */
function CloneResult({ jobId, shopLabel }: { jobId: string; shopLabel: Map<string, string> }) {
  const { t } = useTranslation('pod');
  const job = useListingJob(jobId);
  const running = job.data ? job.data.status === 'PENDING' || job.data.status === 'PROCESSING' : true;
  const items = useListingJobItems(jobId, { limit: RESULT_PAGE_SIZE }, running);
  const rows = useMemo(() => items.data?.items ?? [], [items.data?.items]);

  const counts = useMemo(() => {
    const summary = { total: rows.length, success: 0, skipped: 0, failed: 0, running: 0 };
    for (const row of rows) {
      if (row.status === 'SUCCESS') summary.success += 1;
      else if (row.status === 'SKIPPED') summary.skipped += 1;
      else if (row.status === 'FAILED' || row.status === 'CANCELLED') summary.failed += 1;
      else summary.running += 1;
    }
    return summary;
  }, [rows]);

  const done = !running && counts.running === 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {done ? t('products.clone.result.done') : t('products.clone.result.running')}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="muted">{t('products.clone.result.total', { count: counts.total })}</Badge>
          <Badge variant="success">{t('products.clone.result.success', { count: counts.success })}</Badge>
          <Badge variant="warning">{t('products.clone.result.skipped', { count: counts.skipped })}</Badge>
          <Badge variant="destructive">{t('products.clone.result.failed', { count: counts.failed })}</Badge>
        </div>
      </div>

      <div className="divide-y rounded-md border">
        {items.isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('products.clone.result.loading')}
          </div>
        ) : (
          rows.map((row) => <CloneResultRow key={row.id} item={row} label={shopLabel.get(row.shop?.id ?? '') ?? row.shop?.name ?? '—'} />)
        )}
      </div>

      {done && counts.success > 0 && (
        <p className="text-xs text-muted-foreground">{t('products.clone.result.syncHint')}</p>
      )}
      {job.data?.lastError && <p className="text-sm text-destructive">{job.data.lastError}</p>}
    </section>
  );
}

const STATUS_ICON: Record<PodListingItemStatus, { Icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { Icon: CheckCircle2, className: 'text-emerald-600' },
  SKIPPED: { Icon: MinusCircle, className: 'text-amber-600' },
  FAILED: { Icon: XCircle, className: 'text-destructive' },
  CANCELLED: { Icon: XCircle, className: 'text-muted-foreground' },
  PENDING: { Icon: Loader2, className: 'animate-spin text-muted-foreground' },
  PROCESSING: { Icon: Loader2, className: 'animate-spin text-muted-foreground' },
  RETRYING: { Icon: Loader2, className: 'animate-spin text-amber-600' },
};

/** Một dòng = một shop đích. Lỗi/lý do bỏ qua mở rộng được — không nhét cả câu vào bảng. */
function CloneResultRow({ item, label }: { item: PodListingJobItem; label: string }) {
  const { t } = useTranslation('pod');
  const [expanded, setExpanded] = useState(false);
  const { Icon, className } = STATUS_ICON[item.status] ?? STATUS_ICON.PENDING;
  const detail = item.error?.trim();
  const isRunning = RUNNING.has(item.status);

  return (
    <div className="px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', className)} />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span
          className={cn(
            'text-xs',
            item.status === 'SUCCESS' && 'text-emerald-600',
            item.status === 'SKIPPED' && 'text-amber-600',
            (item.status === 'FAILED' || item.status === 'CANCELLED') && 'text-destructive',
            isRunning && 'text-muted-foreground',
          )}
        >
          {t(`products.clone.status.${item.status}`)}
          {item.status === 'RETRYING' && item.retryCount > 0 && ` (${item.retryCount})`}
        </span>
        {detail && !isRunning && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {t('products.clone.result.detail')}
          </button>
        )}
      </div>
      {item.status === 'SUCCESS' && item.remoteProductId && (
        <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
          {t('products.clone.result.remoteId')}: <span className="font-mono">{item.remoteProductId}</span>
        </p>
      )}
      {expanded && detail && (
        <p className="mt-1 whitespace-pre-wrap break-words pl-6 text-xs text-muted-foreground">
          {item.errorCode && <span className="mr-1 font-mono">[{item.errorCode}]</span>}
          {detail}
        </p>
      )}
    </div>
  );
}
