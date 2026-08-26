'use client';

import { useState } from 'react';
import { Download, ImageUp, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { fulfillmentService } from '@/features/fulfillment/services/fulfillment.service';
import { buildOrdersCsv, downloadCsv, pendingDesignTargets } from '../../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../../order-types';

interface BulkToolbarProps {
  selected: PodOrderListItem[];
  canFulfill: boolean;
  canViewFulfillment: boolean;
  onClear: () => void;
  /** Mở dialog upload design cho một sản phẩm cụ thể (hàng đợi do thanh này điều khiển). */
  onUploadDesign: (item: PodOrderItem) => void;
  /** Làm mới danh sách sau khi chạy hàng loạt. */
  onRefresh: () => void;
}

/** Số đơn chạy song song — vừa đủ nhanh mà không dội request vào xưởng in. */
const CONCURRENCY = 3;

/**
 * Thanh **Bulk Action** nổi phía trên bảng.
 *
 * 🔴 Chỉ có những hành động API hiện tại làm được:
 *   - **Upload Design** → mở dialog cho sản phẩm CHƯA có design đầu tiên trong nhóm đã chọn.
 *     Upload thật vẫn theo từng sản phẩm (`/order-items/:id/designs/:placement`) vì mỗi sản
 *     phẩm cần một file in riêng — "một file cho tất cả" là sai nghiệp vụ POD.
 *   - **Fulfill**  → gọi `POST /fulfillment/:orderId/fulfill` lần lượt cho từng đơn.
 *   - **Sync**     → gọi `POST /fulfillment/:orderId/sync` lần lượt cho từng đơn.
 *   - **Export**   → dựng CSV **ngay trên trình duyệt** từ dữ liệu đã tải.
 *
 * **Delete** không được dựng: không có `DELETE /orders/:id`, và sprint này cấm đổi API. Xem
 * mục "Khoảng trống dữ liệu" trong báo cáo.
 *
 * 🔴 Chạy hàng loạt là **fail-soft**: một đơn hỏng không dừng phần còn lại, và kết quả báo về
 * dạng "x thành công / y thất bại". Dừng cả lượt vì một đơn thiếu Product Mapping là bắt
 * người vận hành làm lại từ đầu.
 */
export function BulkToolbar({
  selected,
  canFulfill,
  canViewFulfillment,
  onClear,
  onUploadDesign,
  onRefresh,
}: BulkToolbarProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const [running, setRunning] = useState<'fulfill' | 'sync' | null>(null);

  if (selected.length === 0) return null;

  /**
   * Hàng đợi Upload Design của nhóm đã chọn — mỗi Product Mapping đúng MỘT lần.
   * Xem `pendingDesignTargets`: design thuộc SKU, không thuộc từng đơn.
   */
  const pendingDesigns: PodOrderItem[] = pendingDesignTargets(
    selected.flatMap((order) => order.items),
  );

  const runBulk = async (
    mode: 'fulfill' | 'sync',
    action: (orderId: string) => Promise<unknown>,
  ): Promise<void> => {
    setRunning(mode);
    let ok = 0;
    const failures: string[] = [];

    // Chạy theo lô nhỏ: tuần tự thì 50 đơn mất vài phút, thả hết một lúc thì xưởng in nghẽn.
    const queue = [...selected];
    const worker = async (): Promise<void> => {
      for (;;) {
        const order = queue.shift();
        if (!order) return;
        try {
          await action(order.id);
          ok += 1;
        } catch (error) {
          failures.push(`${order.tiktokOrderId}: ${translateApiError(error)}`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () => worker()),
    );

    setRunning(null);
    onRefresh();

    if (failures.length === 0) {
      toast.success(t('pod:orders.bulk.done', { count: ok }));
      return;
    }
    toast.warning(t('pod:orders.bulk.partial', { ok, failed: failures.length }), {
      description: failures.slice(0, 3).join('\n'),
    });
  };

  const exportCsv = (): void => {
    const headers = [
      t('pod:orders.export.orderId'),
      t('pod:orders.export.orderedAt'),
      t('pod:orders.export.shop'),
      t('pod:orders.export.sellerEmail'),
      t('pod:orders.export.status'),
      t('pod:orders.export.itemCount'),
      t('pod:orders.export.subtotal'),
      t('pod:orders.export.buyerPaid'),
      t('pod:orders.export.currency'),
      t('pod:orders.export.tracking'),
      t('pod:orders.export.skus'),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(buildOrdersCsv(selected, headers), `pod-orders-${stamp}.csv`);
    toast.success(t('pod:orders.bulk.exported', { count: selected.length }));
  };

  const busy = running !== null;

  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
      <span className="px-1 text-sm font-medium">
        {t('pod:orders.bulk.selected', { count: selected.length })}
      </span>

      <div className="h-5 w-px bg-border" />

      <Tooltip
        content={
          pendingDesigns.length === 0
            ? t('pod:orders.bulk.allDesigned')
            : t('pod:orders.bulk.uploadDesignHint', { count: pendingDesigns.length })
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={pendingDesigns.length === 0 || busy}
          onClick={() => onUploadDesign(pendingDesigns[0])}
        >
          <ImageUp className="size-4" />
          {t('pod:product.uploadDesign')}
          {pendingDesigns.length > 0 && (
            <span className="tabular-nums opacity-70">({pendingDesigns.length})</span>
          )}
        </Button>
      </Tooltip>

      {canFulfill && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void runBulk('fulfill', (id) => fulfillmentService.fulfill(id))}
        >
          {running === 'fulfill' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {t('pod:orders.fulfillment.fulfill')}
        </Button>
      )}

      {canViewFulfillment && (
        <Tooltip content={t('pod:orders.actions.syncFulfillmentHint')}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runBulk('sync', (id) => fulfillmentService.sync(id))}
          >
            {running === 'sync' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('pod:orders.actions.syncFulfillment')}
          </Button>
        </Tooltip>
      )}

      <Tooltip content={t('pod:orders.bulk.exportHint')}>
        <Button variant="outline" size="sm" disabled={busy} onClick={exportCsv}>
          <Download className="size-4" />
          {t('common:action.export')}
        </Button>
      </Tooltip>

      <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={onClear}>
        <X className="size-4" />
        {t('pod:orders.bulk.clear')}
      </Button>
    </div>
  );
}
