'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataPagination } from '@/components/ui/data-pagination';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useNotificationEvents, useTelegramActions } from '../hooks/use-notification';
import {
  NOTIFICATION_EVENT_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventStatus,
  type NotificationEventType,
} from '../types';

const STATUS_VARIANT: Record<NotificationEventStatus, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  SENT: 'success',
  PENDING: 'warning',
  PROCESSING: 'default',
  FAILED: 'destructive',
  SKIPPED: 'muted',
};

/** Trạng thái được phép "Gửi lại" — khớp `REQUEUEABLE_NOTIFICATION_STATUSES` ở backend. */
const RETRYABLE: NotificationEventStatus[] = ['FAILED', 'SKIPPED'];

/** Nhật ký gửi thông báo của tổ chức — để admin tự tra lỗi (token sai, bot bị kick…). */
export function NotificationEventsTable() {
  const { t } = useTranslation(['notification', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const actions = useTelegramActions();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<NotificationEventStatus | ''>('');
  const [eventType, setEventType] = useState<NotificationEventType | ''>('');

  const query = useNotificationEvents({
    page,
    limit,
    status: status || undefined,
    eventType: eventType || undefined,
  });
  const items = query.data?.items ?? [];

  const retry = async (id: string) => {
    try {
      await actions.retryEvent.mutateAsync(id);
      toast.success(t('events.retryQueued'));
    } catch (error) {
      toast.error(t('events.retryFailed'), { description: translateApiError(error) });
    }
  };

  const retryAll = async () => {
    try {
      const { requeued } = await actions.retryFailed.mutateAsync();
      toast.success(t('events.retryAllQueued', { count: requeued }));
    } catch (error) {
      toast.error(t('events.retryFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{t('events.title')}</CardTitle>
          <CardDescription>{t('events.description')}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={t('events.filterType')}
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value as NotificationEventType | '');
              setPage(1);
            }}
          >
            <option value="">{t('events.allTypes')}</option>
            {NOTIFICATION_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`events.type.${type}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('events.filterStatus')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as NotificationEventStatus | '');
              setPage(1);
            }}
          >
            <option value="">{t('events.allStatuses')}</option>
            {NOTIFICATION_EVENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`events.status.${value}`)}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={() => void retryAll()} disabled={actions.retryFailed.isPending}>
            {actions.retryFailed.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {t('events.retryAll')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {query.isError ? (
          <p className="text-sm text-destructive">{translateApiError(query.error)}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('events.column.createdAt')}</TableHead>
                  <TableHead>{t('events.column.type')}</TableHead>
                  <TableHead>{t('events.column.order')}</TableHead>
                  <TableHead>{t('events.column.status')}</TableHead>
                  <TableHead className="text-right">{t('events.column.attempts')}</TableHead>
                  <TableHead>{t('events.column.detail')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {t('events.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(event.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{t(`events.type.${event.eventType}`)}</TableCell>
                      <TableCell className="font-mono text-xs">{event.tiktokOrderId ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[event.status]}>{t(`events.status.${event.status}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{event.attemptCount}</TableCell>
                      <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                        {event.status === 'SENT' && event.sentAt ? (
                          t('events.sentAt', { at: formatDateTime(event.sentAt) })
                        ) : event.status === 'PENDING' && event.attemptCount > 0 ? (
                          <Tooltip content={event.errorMessage ?? ''}>
                            <span>{t('events.nextAttempt', { at: formatDateTime(event.nextAttemptAt) })}</span>
                          </Tooltip>
                        ) : event.errorMessage ? (
                          <span className="line-clamp-2" title={event.errorMessage}>
                            {event.errorMessage}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {RETRYABLE.includes(event.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void retry(event.id)}
                            disabled={actions.retryEvent.isPending}
                          >
                            <RotateCcw className="size-4" />
                            {t('events.retry')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <DataPagination
          meta={query.data?.meta}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setLimit(next);
            setPage(1);
          }}
          disabled={query.isFetching}
        />
      </CardContent>
    </Card>
  );
}
