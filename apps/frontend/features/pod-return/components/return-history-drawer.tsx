'use client';

import { AlertTriangle, Loader2, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { usePodReturnHistory } from '../hooks';
import type { PodReturn } from '../types';
import { STATUS_GROUP_VARIANT, humanizeCode, useReturnLabels } from './return-labels';

interface ReturnHistoryDrawerProps {
  request: PodReturn | null;
  onClose: () => void;
}

/**
 * Lịch sử xử lý của MỘT yêu cầu — đúng các bản ghi TikTok GetReturnRecords trả về, theo thời gian
 * tăng dần. Không có bản ghi ⇒ nói rõ là TikTok không trả, KHÔNG tự dựng lịch sử từ trạng thái.
 */
export function ReturnHistoryDrawer({ request, onClose }: ReturnHistoryDrawerProps) {
  const { t } = useTranslation('podReturn');
  const translateApiError = useApiError();
  const { formatDateTime, formatCurrency } = useLocaleFormat();
  const labels = useReturnLabels();
  const historyQuery = usePodReturnHistory(request?.id ?? null);
  const history = historyQuery.data;

  return (
    <Drawer
      open={Boolean(request)}
      onClose={onClose}
      title={t('history.title')}
      description={request ? t('history.description', { returnId: request.tiktokReturnId, orderId: request.tiktokOrderId }) : undefined}
      headerExtra={
        request && (
          <>
            <Badge variant={STATUS_GROUP_VARIANT[request.statusGroup]}>{labels.group(request.statusGroup)}</Badge>
            <span className="font-mono text-[11px] text-muted-foreground">{request.returnStatus}</span>
          </>
        )
      }
    >
      {request && (
        <div className="space-y-5">
          <DrawerSection title={t('history.summary')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('col.type')}</dt>
              <dd className="break-words">{labels.type(request.returnType)}</dd>
              <dt className="text-muted-foreground">{t('col.reason')}</dt>
              <dd className="break-words">{request.reasonText ?? humanizeCode(request.reasonCode)}</dd>
              <dt className="text-muted-foreground">{t('col.paid')}</dt>
              <dd>{request.paidAmount ? formatCurrency(request.paidAmount, request.currency) : t('notAvailable')}</dd>
              <dt className="text-muted-foreground">{t('amount.requested')}</dt>
              <dd>{request.requestedRefund ? formatCurrency(request.requestedRefund, request.currency) : t('notAvailable')}</dd>
              {request.partialRefundAmount && (
                <>
                  <dt className="text-muted-foreground">{t('amount.partial')}</dt>
                  <dd>{formatCurrency(request.partialRefundAmount, request.currency)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t('amount.settledOrder')}</dt>
              <dd>
                {request.orderSettledRefund
                  ? formatCurrency(request.orderSettledRefund, request.currency)
                  : t('amount.notSettled')}
              </dd>
              {request.returnTrackingNumber && (
                <>
                  <dt className="text-muted-foreground">{t('history.tracking')}</dt>
                  <dd className="break-all font-mono text-xs">{request.returnTrackingNumber}</dd>
                </>
              )}
            </dl>
          </DrawerSection>

          <DrawerSection title={t('history.timeline')}>
            {historyQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : historyQuery.isError ? (
              <p className="text-sm text-destructive">{translateApiError(historyQuery.error)}</p>
            ) : (
              <div className="space-y-3">
                {history?.errorCode && (
                  <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {t(`syncError.${history.errorCode}`, { defaultValue: t('history.liveFailed') })}
                  </p>
                )}
                {history && history.entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
                ) : (
                  <ol className="relative space-y-4 border-l pl-4">
                    {history?.entries.map((entry, index) => (
                      <li key={`${entry.time ?? 'none'}-${index}`} className="relative">
                        <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-medium">{humanizeCode(entry.event)}</span>
                          {entry.role && <span className="text-xs text-muted-foreground">· {labels.role(entry.role)}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {entry.time ? formatDateTime(entry.time) : t('history.noTime')}
                        </p>
                        {entry.description && <p className="mt-1 break-words text-sm">{entry.description}</p>}
                        {entry.reason && (
                          <p className="mt-1 break-words text-sm">
                            <span className="text-muted-foreground">{t('col.reason')}: </span>
                            {entry.reason}
                          </p>
                        )}
                        {entry.note && <p className="mt-1 break-words text-sm italic text-muted-foreground">{entry.note}</p>}
                        {entry.attachments > 0 && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Paperclip className="size-3" />
                            {t('history.attachments', { count: entry.attachments })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {history?.syncedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    {t(history.live ? 'history.fetchedNow' : 'history.cachedAt', { time: formatDateTime(history.syncedAt) })}
                  </p>
                )}
              </div>
            )}
          </DrawerSection>
        </div>
      )}
    </Drawer>
  );
}
