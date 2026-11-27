'use client';

import { CloudDownload, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { useSyncSelectedPodOrders } from '../../hooks/use-pod-orders';

/**
 * "Sync Order" ở trang chi tiết đơn — kéo lại ĐÚNG đơn này từ TikTok.
 *
 * Dùng chung endpoint với "Sync N Orders" của danh sách (`POST /pod/tiktok/orders/sync-selected`):
 * backend tự kiểm tổ chức + phạm vi shop, ghi qua cửa ingest duy nhất (idempotent). Thành công ⇒
 * mutation làm mới mọi query đơn (gồm chi tiết này) nên trạng thái mới hiện ngay.
 */
export function OrderDetailSyncButton({ orderId }: { orderId: string }) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const sync = useSyncSelectedPodOrders();

  const run = async (): Promise<void> => {
    if (sync.isPending) return;
    try {
      const result = await sync.mutateAsync([orderId]);
      const item = result.results[0];
      if (item?.status === 'SYNCED') {
        toast.success(t('orders.actions.syncOrderDone'));
        return;
      }
      toast.error(t('orders.actions.syncOrdersFailed'), {
        description: item?.errorMessage ?? item?.errorCode,
      });
    } catch (error) {
      toast.error(t('orders.actions.syncOrdersFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void run()}
      disabled={sync.isPending}
      title={t('orders.actions.syncOrdersHint')}
    >
      {sync.isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <CloudDownload className="size-4" aria-hidden />
      )}
      {t('orders.actions.syncOrder')}
    </Button>
  );
}
