'use client';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useCatalogStatus, useProductMappingActions } from '../hooks/use-fulfillment';

/**
 * Tình trạng danh mục của nhà cung cấp đang chọn — hiện ở CHỖ người dùng chọn Provider Product.
 *
 * 🔴 Lý do tồn tại: nhà cung cấp mới thêm (vd Sellerwix) có danh mục TRỐNG cho tới khi được đồng bộ.
 * Trước đây ô Provider Product chỉ rỗng im lặng ⇒ không lưu được cấu hình sản phẩm ⇒ Sellerwix không
 * có SKU biến thể để hỏi phương thức vận chuyển ⇒ "Shipping method trống" mà không ai biết vì sao.
 *
 * - Đang đồng bộ (chạy nền ở backend) ⇒ báo đang chạy; `useCatalogStatus` tự hỏi lại và làm mới danh
 *   sách sản phẩm khi xong.
 * - Danh mục trống ⇒ nói rõ + nút đồng bộ (chỉ người có `fulfillment.config`; người khác được hướng
 *   dẫn nhờ Admin).
 * - Đã có dữ liệu ⇒ không hiện gì.
 */
export function CatalogSyncNotice({ accountId }: { accountId: string | null | undefined }) {
  const { t } = useTranslation('fulfillment');
  const { hasPermission } = useAuth();
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const status = useCatalogStatus(accountId ?? undefined);
  const actions = useProductMappingActions();
  const data = status.data;
  if (!accountId || !data) return null;

  const running = data.syncStatus === 'RUNNING';
  if (!running && data.products > 0) return null;

  const start = async () => {
    try {
      await actions.syncCatalog.mutateAsync(accountId);
      toast.info(t('catalogSync.started'), { description: t('catalogSync.startedHint') });
    } catch (error) {
      toast.error(t('catalogSync.failed'), { description: translateApiError(error) });
    }
  };

  if (running) {
    return (
      <p className="flex items-start gap-1.5 rounded-md bg-sky-50 p-2 text-[11px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
        <Loader2 className="mt-px size-3.5 shrink-0 animate-spin" />
        {t('catalogSync.running', {
          at: data.syncStartedAt ? formatDateTime(data.syncStartedAt) : '—',
        })}
      </p>
    );
  }

  const canSync = hasPermission('fulfillment.config');
  return (
    <div className="space-y-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="mt-px size-3.5 shrink-0" />
        <span>
          {t('catalogSync.empty')}
          {(data.syncStatus === 'FAILED' || data.syncStatus === 'INTERRUPTED') && data.syncError
            ? ` ${t('catalogSync.lastError', { error: data.syncError })}`
            : ''}
          {!canSync && ` ${t('catalogSync.askAdmin')}`}
        </span>
      </p>
      {canSync && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={actions.syncCatalog.isPending}
          onClick={() => void start()}
        >
          {actions.syncCatalog.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {t('catalogSync.start')}
        </Button>
      )}
    </div>
  );
}
