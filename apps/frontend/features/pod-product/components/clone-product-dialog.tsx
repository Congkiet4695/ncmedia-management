'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
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
import { useBulkClonePodProducts, useClonePodProduct, usePodProductFilters } from '../hooks/use-pod-products';
import { buildProductGallery } from '../product-images';
import { CLONE_MAX_ITEMS, type PodProductListItem } from '../types';

interface CloneProductDialogProps {
  open: boolean;
  /**
   * Sản phẩm NGUỒN — một hoặc nhiều, cùng MỘT shop (trang cha đã chặn chọn lẫn shop; backend kiểm lại).
   * Một sản phẩm ⇒ API nhân bản đơn có sẵn; nhiều sản phẩm ⇒ API nhân bản hàng loạt.
   */
  products: PodProductListItem[];
  /**
   * Đóng dialog. `hadResult = true` khi đã có lượt chạy (kể cả đang chạy) — trang cha làm
   * mới danh sách; sản phẩm mới chỉ về sau lượt đồng bộ được hẹn, nhưng trạng thái hàng đợi
   * và Publish History đã đổi.
   */
  onClose: (hadResult: boolean) => void;
}

/** Trần số item tải về cho màn kết quả — bằng trần thao tác một lượt ở backend. */
const RESULT_PAGE_SIZE = CLONE_MAX_ITEMS;

const RUNNING: ReadonlySet<PodListingItemStatus> = new Set(['PENDING', 'PROCESSING', 'RETRYING']);

/**
 * **Nhân bản sản phẩm** — 1..N sản phẩm của MỘT shop nguồn → NHIỀU shop đích.
 *
 * ```
 *   Bước 1: nguồn (shop + sản phẩm) + chọn nhiều shop đích (tìm, chọn tất cả, bỏ chọn)
 *   Bước 2: xem lại — shop nguồn · số sản phẩm × số shop = số thao tác
 *   Bước 3: xác nhận ⇒ backend tạo MỘT Listing Job type CLONE (mỗi cặp sản phẩm/shop một item) ⇒ theo dõi
 *           TỪNG cặp (✓ thành công · ⊘ bỏ qua · ✕ thất bại · ⏳ đang xử lý) qua polling — lượt chạy ở SERVER,
 *           đóng dialog không dừng gì.
 * ```
 *
 * 🔴 Danh sách shop chỉ gồm shop người dùng được thấy (API `filters` đã lọc theo phạm vi) —
 * tiện lợi, KHÔNG phải hàng rào: backend kiểm lại shop nguồn, từng shop đích và từng sản phẩm.
 *
 * 🔴 Chống bấm đúp: nút khoá khi mutation đang chạy VÀ hàm submit tự thoát nếu đang chạy;
 * backend còn khoá (409) và item trùng cặp chờ item cũ rồi bị SKIPPED — không tạo bản trùng.
 */
export function CloneProductDialog({ open, products, onClose }: CloneProductDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const filters = usePodProductFilters();
  const cloneOne = useClonePodProduct();
  const cloneMany = useBulkClonePodProducts();
  const pending = cloneOne.isPending || cloneMany.isPending;

  const sourceShopId = products[0]?.shopId ?? '';
  const sourceShopName = products[0]?.shopName ?? null;
  const single = products.length === 1;

  const [shopIds, setShopIds] = useState<string[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  /** Job vừa tạo — có giá trị ⇒ đang ở màn kết quả. */
  const [jobId, setJobId] = useState<string | null>(null);

  // Shop nguồn bị loại khỏi lựa chọn: nhân bản vào chính nó là tạo sản phẩm trùng (backend chặn 400 ở lượt
  // hàng loạt, bỏ qua ở lượt đơn) — không mời người dùng chọn một thứ chắc chắn không chạy.
  const shopOptions = useMemo(
    () =>
      (filters.data?.shops ?? [])
        .filter((shop) => shop.id !== sourceShopId)
        .map((shop) => ({
          id: shop.id,
          name: shop.name,
          connectionName: shop.connectionName,
          region: shop.region ?? undefined,
        })),
    [filters.data?.shops, sourceShopId],
  );
  const shopLabel = useMemo(
    () => new Map(shopOptions.map((shop) => [shop.id, `${shop.connectionName} · ${shop.name}`])),
    [shopOptions],
  );

  const totalOps = products.length * shopIds.length;
  const tooMany = totalOps > CLONE_MAX_ITEMS;

  const goReview = () => {
    if (shopIds.length === 0) {
      setValidation(t('products.clone.needShop'));
      return;
    }
    if (tooMany) return;
    setValidation(null);
    setReviewing(true);
  };

  const submit = async () => {
    // Lớp 1 chống bấm đúp: mutation đang bay thì lần bấm thứ hai không làm gì.
    if (pending || shopIds.length === 0 || tooMany) return;
    try {
      const job = single
        ? await cloneOne.mutateAsync({ id: products[0].id, payload: { targetShopIds: shopIds } })
        : await cloneMany.mutateAsync({
            sourceShopId,
            productIds: products.map((product) => product.id),
            targetShopIds: shopIds,
          });
      setJobId(job.id);
      toast.success(
        single
          ? t('products.clone.started', { count: shopIds.length })
          : t('products.clone.bulk.started', { count: totalOps }),
      );
    } catch (error) {
      toast.error(t('products.clone.failed'), { description: translateApiError(error) });
    }
  };

  const close = () => onClose(jobId !== null);

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : close}
      title={single ? t('products.clone.title') : t('products.clone.bulk.title', { count: products.length })}
      description={jobId ? undefined : single ? t('products.clone.description') : t('products.clone.bulk.description')}
      className="max-w-2xl"
      footer={
        jobId ? (
          <div className="flex items-center justify-between gap-3">
            {/* Lượt chạy tiếp tục ở server — theo dõi & chạy lại cặp lỗi ở màn Clone Products. */}
            <Button variant="outline" asChild>
              <Link href="/dashboard/pod/clone-products" onClick={close}>
                <ExternalLink className="size-4" />
                {t('products.clone.result.track')}
              </Link>
            </Button>
            <Button onClick={close}>{t('common:action.close')}</Button>
          </div>
        ) : reviewing ? (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setReviewing(false)} disabled={pending}>
              <ArrowLeft className="size-4" />
              {t('products.clone.bulk.back')}
            </Button>
            <Button onClick={() => void submit()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Copy />}
              {t('products.clone.bulk.confirm', { count: totalOps })}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('products.clone.publishHint')}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={close}>
                {t('common:action.cancel')}
              </Button>
              <Button onClick={goReview} disabled={filters.isLoading || tooMany}>
                {t('products.clone.bulk.review')}
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {/* ---------- Nguồn ---------- */}
        <section className="space-y-2">
          <Label>{single ? t('products.clone.source') : t('products.clone.bulk.sourceProducts', { count: products.length })}</Label>
          {single ? (
            <SourceCard product={products[0]} />
          ) : (
            <div className="rounded-md border bg-muted/40">
              <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                {t('products.clone.bulk.sourceShop')}: <span className="font-medium text-foreground">{sourceShopName ?? '—'}</span>
              </p>
              <ul className="max-h-40 divide-y overflow-y-auto">
                {products.map((product) => (
                  <li key={product.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <Thumb product={product} className="size-8" />
                    <span className="min-w-0 flex-1 truncate">{product.title?.trim() || product.tiktokProductId}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{product.tiktokProductId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {jobId ? (
          <CloneResult jobId={jobId} shopLabel={shopLabel} showProduct={!single} />
        ) : reviewing ? (
          <ReviewSummary
            sourceShopName={sourceShopName}
            productCount={products.length}
            shops={shopIds.map((id) => shopLabel.get(id) ?? id)}
          />
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
            {shopIds.length > 0 && (
              <p className={cn('text-sm', tooMany ? 'text-destructive' : 'text-muted-foreground')}>
                {t('products.clone.bulk.formula', {
                  products: products.length,
                  shops: shopIds.length,
                  total: totalOps,
                })}
                {tooMany && ` — ${t('products.clone.bulk.tooMany', { max: CLONE_MAX_ITEMS })}`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('products.clone.copyHint')}</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Thumb({ product, className }: { product: PodProductListItem; className: string }) {
  const thumb = buildProductGallery(product.mainImages)[0]?.thumb;
  return thumb ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumb} alt="" className={cn('shrink-0 rounded-md border object-cover', className)} />
  ) : (
    <div className={cn('flex shrink-0 items-center justify-center rounded-md border bg-muted', className)}>
      <ImageOff className="size-4 text-muted-foreground" />
    </div>
  );
}

function SourceCard({ product }: { product: PodProductListItem }) {
  const { t } = useTranslation('pod');
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
      <Thumb product={product} className="size-16" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="line-clamp-2 font-medium leading-snug">{product.title?.trim() || product.tiktokProductId}</p>
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
  );
}

/** Bước xem lại: đúng những gì sẽ được gửi — không có thao tác nào chạy trước khi bấm Xác nhận. */
function ReviewSummary({
  sourceShopName,
  productCount,
  shops,
}: {
  sourceShopName: string | null;
  productCount: number;
  shops: string[];
}) {
  const { t } = useTranslation('pod');
  return (
    <section className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <SummaryStat label={t('products.clone.bulk.sourceShop')} value={sourceShopName ?? '—'} />
        <SummaryStat label={t('products.clone.bulk.productCount')} value={String(productCount)} />
        <SummaryStat label={t('products.clone.bulk.shopCount')} value={String(shops.length)} />
        <SummaryStat label={t('products.clone.bulk.totalOps')} value={String(productCount * shops.length)} strong />
      </dl>
      <div className="space-y-1">
        <Label>{t('products.clone.targets')}</Label>
        <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
          {shops.map((shop) => (
            <li key={shop} className="truncate border-b px-3 py-1.5 last:border-b-0">
              {shop}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{t('products.clone.bulk.reviewHint')}</p>
    </section>
  );
}

function SummaryStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border p-2">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate tabular-nums', strong ? 'text-base font-semibold' : 'font-medium')} title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Màn kết quả: tiến độ + trạng thái TỪNG cặp (sản phẩm, shop), cập nhật 2 giây/lần khi còn item đang chạy.
 *
 * 🔴 Job sống ở SERVER — đóng dialog không dừng gì; lượt chạy vẫn xem lại được ở màn Clone Products.
 */
function CloneResult({
  jobId,
  shopLabel,
  showProduct,
}: {
  jobId: string;
  shopLabel: Map<string, string>;
  showProduct: boolean;
}) {
  const { t } = useTranslation('pod');
  const job = useListingJob(jobId);
  const running = job.data ? job.data.status === 'PENDING' || job.data.status === 'PROCESSING' : true;
  const items = useListingJobItems(jobId, { limit: RESULT_PAGE_SIZE }, running);
  const rows = useMemo(() => items.data?.items ?? [], [items.data?.items]);
  const [onlyProblems, setOnlyProblems] = useState(false);

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
  const finished = counts.total - counts.running;
  const percent = counts.total === 0 ? 0 : Math.round((finished / counts.total) * 100);
  const visible = onlyProblems
    ? rows.filter((row) => row.status === 'FAILED' || row.status === 'CANCELLED' || row.status === 'SKIPPED')
    : rows;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {done ? <CheckCircle2 className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {done ? t('products.clone.result.done') : t('products.clone.result.running')}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {finished}/{counts.total}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="muted">{t('products.clone.result.total', { count: counts.total })}</Badge>
          <Badge variant="success">{t('products.clone.result.success', { count: counts.success })}</Badge>
          <Badge variant="warning">{t('products.clone.result.skipped', { count: counts.skipped })}</Badge>
          <Badge variant="destructive">{t('products.clone.result.failed', { count: counts.failed })}</Badge>
        </div>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>

      {(counts.failed > 0 || counts.skipped > 0) && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} />
          {t('products.clone.bulk.onlyProblems')}
        </label>
      )}

      <div className="max-h-[45vh] divide-y overflow-y-auto rounded-md border">
        {items.isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('products.clone.result.loading')}
          </div>
        ) : (
          visible.map((row) => {
            const shop = shopLabel.get(row.shop?.id ?? '') ?? row.shop?.name ?? '—';
            const product = row.product?.title?.trim() || row.product?.tiktokProductId;
            return (
              <CloneResultRow
                key={row.id}
                item={row}
                label={showProduct && product ? `${product} → ${shop}` : shop}
              />
            );
          })
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
  SUCCESS: { Icon: CheckCircle2, className: 'text-success' },
  SKIPPED: { Icon: MinusCircle, className: 'text-warning' },
  FAILED: { Icon: XCircle, className: 'text-destructive' },
  CANCELLED: { Icon: XCircle, className: 'text-muted-foreground' },
  PENDING: { Icon: Loader2, className: 'animate-spin text-muted-foreground' },
  PROCESSING: { Icon: Loader2, className: 'animate-spin text-muted-foreground' },
  RETRYING: { Icon: Loader2, className: 'animate-spin text-warning' },
};

/** Một dòng = một cặp (sản phẩm, shop đích). Lỗi/lý do bỏ qua mở rộng được — không nhét cả câu vào bảng. */
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
        <span className="min-w-0 flex-1 truncate font-medium" title={label}>
          {label}
        </span>
        <span
          className={cn(
            'shrink-0 text-xs',
            item.status === 'SUCCESS' && 'text-success',
            item.status === 'SKIPPED' && 'text-warning',
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
            className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
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
