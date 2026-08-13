'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Factory,
  History,
  Loader2,
  RefreshCw,
  RotateCw,
  Link2,
  Send,
  Truck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { useApiError } from '@/hooks/use-api-error';
import { MappingFormDialog } from './mapping-form-dialog';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useFulfillmentActions,
  useFulfillmentErrors,
  useFulfillmentHistory,
  useFulfillmentState,
  useProductMappingActions,
} from '../hooks/use-fulfillment';
import type { FulfillmentIssue, FulfillmentStatus } from '../types';

interface FulfillmentPanelProps {
  podOrderId: string;
  /** Quyền gửi/gửi lại đơn. */
  canFulfill: boolean;
  /** Quyền huỷ đơn ở xưởng in. */
  canCancel: boolean;
}

/** Màu badge theo nhóm trạng thái — thất bại/huỷ nổi bật để không bị bỏ sót. */
const STATUS_VARIANT: Record<FulfillmentStatus, 'default' | 'muted' | 'destructive' | 'success'> = {
  DRAFT: 'muted',
  SUBMITTING: 'muted',
  SUBMITTED: 'default',
  IN_PRODUCTION: 'default',
  ON_HOLD: 'muted',
  SHIPPED: 'default',
  DELIVERED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
  FAILED: 'destructive',
  UNKNOWN: 'muted',
};

/**
 * Bảng điều khiển Fulfillment của một đơn POD.
 *
 * Hiển thị trạng thái, nhà cung cấp, mã đơn, thời điểm đồng bộ, vận đơn; và các nút
 * Fulfill / Retry / Sync / Cancel — nút chỉ bật khi BACKEND xác nhận cho phép
 * (`canFulfill`/`canCancel`), tránh việc UI cho bấm rồi server từ chối.
 *
 * Đơn chưa gửi được thì liệt kê CHÍNH XÁC thiếu gì thay vì chỉ báo "không hợp lệ".
 */
export function FulfillmentPanel({ podOrderId, canFulfill, canCancel }: FulfillmentPanelProps) {
  const { t } = useTranslation('fulfillment');
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const [historyOpen, setHistoryOpen] = useState(false);
  // Lỗi thiếu ánh xạ đang được xử lý — mở dialog ánh xạ nhanh với SKU điền sẵn.
  const [mappingIssue, setMappingIssue] = useState<FulfillmentIssue | null>(null);
  const mappingActions = useProductMappingActions();
  const stateQuery = useFulfillmentState(podOrderId);
  const historyQuery = useFulfillmentHistory(podOrderId, historyOpen);
  const errorsQuery = useFulfillmentErrors(podOrderId, historyOpen);
  const actions = useFulfillmentActions(podOrderId);

  const state = stateQuery.data;
  const record = state?.fulfillment ?? null;
  const busy =
    actions.fulfill.isPending ||
    actions.retry.isPending ||
    actions.sync.isPending ||
    actions.cancel.isPending;

  /**
   * Chạy một hành động và báo kết quả.
   *
   * @param actionKey Khoá dịch TÊN hành động (vd `action.fulfill`) — ghép vào câu thông báo
   *   qua tham số nội suy thay vì nối chuỗi, để dịch được sang ngôn ngữ có trật tự từ khác.
   */
  const run = async (
    actionKey: string,
    action: { mutateAsync: (arg?: never) => Promise<unknown> },
  ) => {
    const name = t(actionKey);
    try {
      await action.mutateAsync(undefined);
      toast.success(t('action.succeeded', { action: name }));
    } catch (error) {
      toast.error(t('action.failed', { action: name }), { description: translateApiError(error) });
    }
  };

  if (stateQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loadingState')}
      </div>
    );
  }

  if (stateQuery.isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {translateApiError(stateQuery.error)}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Factory className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t('title')}</span>
          {/* Trạng thái cấu hình nhà cung cấp — vàng khi chưa gán, xanh khi sẵn sàng. */}
          {state?.provider ? (
            <>
              <Badge variant={state.provider.isActive ? 'success' : 'warning'}>
                {state.provider.isActive
                  ? t('readiness.ready')
                  : t('readiness.notConfigured')}
              </Badge>
              <span className="text-xs text-muted-foreground">{state.provider.name}</span>
            </>
          ) : (
            <Badge variant="warning" title={t('readiness.notConfiguredHint')}>
              {t('readiness.notConfigured')}
            </Badge>
          )}
          {record ? (
            <>
              <Badge variant={STATUS_VARIANT[record.status]}>
                {t(`status.${record.status}`)}
              </Badge>
              {/* Trạng thái gốc của nhà cung cấp — cần khi đối soát với xưởng in. */}
              {record.providerStatus && (
                <span className="font-mono text-xs text-muted-foreground">
                  {record.providerStatus}
                </span>
              )}
              <Badge variant="muted">{record.provider}</Badge>
            </>
          ) : (
            <Badge variant="muted">{t('notSubmitted')}</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canFulfill && state?.canFulfill && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  record?.status === 'FAILED' ? 'action.resend' : 'action.fulfill',
                  record?.status === 'FAILED' ? actions.retry : actions.fulfill,
                )
              }
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : record?.status === 'FAILED' ? (
                <RotateCw className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {record?.status === 'FAILED' ? t('action.resend') : t('fulfillNow')}
            </Button>
          )}

          {record && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run('action.syncStatus', actions.sync)}
            >
              <RefreshCw className="size-4" />
              {t('action.syncStatus')}
            </Button>
          )}

          {canCancel && state?.canCancel && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run('action.cancelOrder', actions.cancel)}
            >
              <XCircle className="size-4" />
              {t('cancel')}
            </Button>
          )}

          {record && (
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" />
              {t('history')}
            </Button>
          )}
        </div>
      </div>

      {/* Thông tin định danh + vận đơn */}
      {record && (
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('externalOrderId')}</dt>
            <dd className="font-mono">{record.externalOrderId}</dd>
          </div>
          {record.providerOrderId && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('providerOrderId')}</dt>
              <dd className="font-mono">{record.providerOrderId}</dd>
            </div>
          )}
          {record.submittedAt && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('submittedAt')}</dt>
              <dd>{formatDateTime(record.submittedAt)}</dd>
            </div>
          )}
          {record.completedAt && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('completedAt')}</dt>
              <dd>{formatDateTime(record.completedAt)}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('syncedAt')}</dt>
            <dd>{formatDateTime(record.lastSyncedAt)}</dd>
          </div>
          {record.trackingNumber && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('tracking')}</dt>
              <dd className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                <span className="font-mono">{record.trackingNumber}</span>
                {record.carrier && <span className="text-muted-foreground">({record.carrier})</span>}
              </dd>
            </div>
          )}
          {record.attemptCount > 1 && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('attempts')}</dt>
              <dd>{record.attemptCount}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Lỗi gần nhất */}
      {record?.lastErrorMessage && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {record.lastErrorCode && <strong>{record.lastErrorCode}: </strong>}
            {record.lastErrorMessage}
          </span>
        </div>
      )}

      {/* Lý do chưa gửi được — nêu cụ thể để người dùng biết phải sửa gì */}
      {state && !state.ready && state.issues.length > 0 && (
        <div className="space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-medium">{t('notReady')}</p>
          <ul className="list-inside list-disc space-y-0.5">
            {state.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="flex flex-wrap items-center gap-2">
                <span>{issue.message}</span>
                {/* Ánh xạ nhanh: chỉ hiện đúng ở lỗi thiếu ánh xạ và khi có ngữ cảnh SKU. */}
                {issue.code === 'MAPPING_MISSING' && (issue.sellerSku ?? issue.tiktokSkuId) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMappingIssue(issue)}
                  >
                    <Link2 className="size-3.5" />
                    {t('mapping.quickMap')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ánh xạ nhanh ngay trong màn hình đơn — không phải sang màn hình Product Mapping. */}
      <MappingFormDialog
        open={Boolean(mappingIssue)}
        presetAccountId={state?.provider?.id ?? null}
        presetTiktok={
          mappingIssue
            ? {
                tiktokProductId: mappingIssue.tiktokProductId ?? null,
                tiktokSkuId: mappingIssue.tiktokSkuId ?? null,
                sellerSku: mappingIssue.sellerSku ?? null,
                productName: mappingIssue.productName ?? null,
                skuName: mappingIssue.skuName ?? null,
                productCategory: mappingIssue.productCategory ?? null,
                skuImage: null,
                mapped: false,
              }
            : null
        }
        submitting={mappingActions.create.isPending}
        onClose={() => setMappingIssue(null)}
        onSubmit={(_accountId, input) => {
          void mappingActions.create
            .mutateAsync(input)
            .then(() => {
              toast.success(t('mapping.createSuccess'), { description: input.providerSku });
              setMappingIssue(null);
            })
            .catch((error: unknown) =>
              toast.error(t('mapping.createSuccess'), { description: translateApiError(error) }),
            );
        }}
        onRefreshCatalog={(accountId) => void mappingActions.refreshCatalog.mutateAsync(accountId)}
      />

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('historyTitle')}
        description={t('historySubtitle')}
        className="max-w-3xl"
      >
        <div className="max-h-[60vh] space-y-4 overflow-auto">
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ol className="space-y-2">
              {(historyQuery.data ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    'rounded-md border p-2 text-xs',
                    !entry.success && 'border-destructive/40 bg-destructive/5',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{entry.eventType}</span>
                    <Badge variant="muted">{entry.trigger}</Badge>
                    {entry.fromStatus && entry.toStatus && (
                      <span className="text-muted-foreground">
                        {entry.fromStatus} → {entry.toStatus}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                  {entry.message && <p className="mt-1">{entry.message}</p>}
                  {(entry.durationMs !== null || entry.requestId) && (
                    <p className="mt-1 text-muted-foreground">
                      {entry.durationMs !== null && `${entry.durationMs}ms`}
                      {entry.requestId && ` · request_id: ${entry.requestId}`}
                    </p>
                  )}
                </li>
              ))}
              {(historyQuery.data ?? []).length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('noHistory')}
                </p>
              )}
            </ol>
          )}

          {(errorsQuery.data ?? []).length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-destructive">{t('errorDetail')}</h3>
              {errorsQuery.data?.map((error) => (
                <div
                  key={error.id}
                  className="rounded-md border border-destructive/40 p-2 text-xs"
                >
                  <div className="flex flex-wrap gap-2">
                    <span className="font-mono">{error.operation}</span>
                    <Badge variant="destructive">{error.errorClass}</Badge>
                    {error.httpStatus && <span>HTTP {error.httpStatus}</span>}
                    {error.providerCode && <span className="font-mono">{error.providerCode}</span>}
                    {error.retryable && <Badge variant="muted">{t('retryable')}</Badge>}
                  </div>
                  <p className="mt-1">{error.message}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </Modal>
    </div>
  );
}
