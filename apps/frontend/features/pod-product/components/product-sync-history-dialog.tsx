'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { usePodProductSyncHistory } from '../hooks/use-pod-products';
import type { PodProductSyncHistoryItem } from '../types';

interface ProductSyncHistoryDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Lịch sử đồng bộ sản phẩm.
 *
 * Trả lời đúng ba câu hỏi vận hành: lượt chạy lúc nào, lấy về bao nhiêu, có gì lỗi không.
 * Số `apiCalls` hiển thị vì quota TikTok là tài nguyên dùng chung — biết một lượt "full"
 * tốn bao nhiêu call giúp người vận hành cân nhắc trước khi bấm lại.
 */
export function ProductSyncHistoryDialog({ open, onClose }: ProductSyncHistoryDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();
  const [page, setPage] = useState(1);

  const historyQuery = usePodProductSyncHistory({ page, limit: 10 });
  const items = historyQuery.data?.items ?? [];
  const meta = historyQuery.data?.meta;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('products.syncHistory.title')}
      description={t('products.syncHistory.description')}
    >
      <div className="space-y-3">
        {historyQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('products.syncHistory.empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} formatDateTime={formatDateTime} />
            ))}
          </ul>
        )}

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t('common:pagination.page', { page: meta.page, totalPages: meta.totalPages })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft className="size-4" />
                {t('common:action.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common:action.next')}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function HistoryRow({
  item,
  formatDateTime,
}: {
  item: PodProductSyncHistoryItem;
  formatDateTime: (value: string) => string;
}) {
  const { t } = useTranslation('pod');

  const variant =
    item.status === 'SUCCESS'
      ? 'success'
      : item.status === 'PARTIAL'
        ? 'warning'
        : item.status === 'FAILED'
          ? 'destructive'
          : 'muted';

  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={variant}>{item.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {item.scope} · {item.trigger}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDateTime(item.startedAt)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {item.shopName ?? item.accountName ?? '—'} ·{' '}
        {t('products.syncHistory.counters', {
          fetched: item.productsFetched,
          created: item.productsCreated,
          updated: item.productsUpdated,
          skipped: item.productsSkipped,
          failed: item.productsFailed,
        })}{' '}
        · {t('products.syncHistory.apiCalls', { count: item.apiCalls })}
        {item.durationMs !== null && ` · ${Math.round(item.durationMs / 1000)}s`}
      </p>

      {item.errorMessage && (
        <p className="text-xs text-destructive">
          {item.errorCode ? `[${item.errorCode}] ` : ''}
          {item.errorMessage}
        </p>
      )}
    </li>
  );
}
