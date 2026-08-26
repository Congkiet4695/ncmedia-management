'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, ImageUp, Loader2, MoreHorizontal, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import {
  useFulfillmentActions,
  useFulfillmentState,
} from '@/features/fulfillment/hooks/use-fulfillment';
import { pendingDesignTargets } from '../../order-view-model';
import type { PodOrderItem } from '../../order-types';

interface OrderActionMenuProps {
  orderId: string;
  items: PodOrderItem[];
  /** Quyền `fulfillment.read` — quyết định có hỏi trạng thái xưởng in hay không. */
  canViewFulfillment: boolean;
  canFulfill: boolean;
  /** Quyền `fulfillment.cancel` — huỷ đơn đã gửi sang xưởng in. */
  canCancel: boolean;
  onUploadDesign: (item: PodOrderItem) => void;
}

/**
 * Cột **Action** — chỉ icon, tooltip đầy đủ.
 *
 * 🔴 Chỉ có những hành động mà **API hiện tại thực sự hỗ trợ**:
 *   - **View**          → `/dashboard/pod/orders/:id`
 *   - **Upload Design** → dialog upload của sản phẩm đầu tiên chưa có design
 *   - **Sync**          → `POST /fulfillment/:orderId/sync` (đồng bộ trạng thái từ xưởng in)
 *
 * **Edit** và **Delete** trong bản mô tả KHÔNG được dựng: hệ thống không có
 * `PATCH /orders/:id` hay `DELETE /orders/:id`, và sprint này cấm đổi API. Một nút mở ra rồi
 * báo lỗi 404 tệ hơn hẳn một nút không tồn tại. Chi tiết ở mục "Khoảng trống dữ liệu".
 *
 * 🔴 `Sync` ở đây là đồng bộ **fulfillment**, không phải kéo lại đơn từ TikTok: endpoint
 * `POST /orders/sync` chạy theo shop/tổ chức chứ không theo từng đơn. Tooltip nói đúng việc
 * nó làm để không ai bấm nhầm rồi tưởng đơn vừa được kéo mới từ sàn.
 *
 * 🔴 **Cancel** được giữ lại từ màn hình cũ (`FulfillmentPanel`). Bố cục mới gọn hơn nhưng
 * không được phép làm mất một thao tác nghiệp vụ đang có — huỷ đơn ở xưởng in là việc thật,
 * và bỏ nó đi chỉ để bảng đẹp hơn là đẩy người vận hành sang cổng quản trị của nhà cung cấp.
 */
export function OrderActionMenu({
  orderId,
  items,
  canViewFulfillment,
  canFulfill,
  canCancel,
  onUploadDesign,
}: OrderActionMenuProps) {
  const { t } = useTranslation(['pod', 'common', 'fulfillment']);
  const router = useRouter();
  const translateApiError = useApiError();
  const actions = useFulfillmentActions(orderId);
  // 🔴 KHÔNG thêm request: `FulfillmentCell` của cùng dòng đã hỏi đúng query key này, nên
  // react-query trả về từ cache thay vì gọi lần hai.
  const state = useFulfillmentState(orderId, canViewFulfillment);
  const hasFulfillment = Boolean(state.data?.fulfillment);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  // Ưu tiên sản phẩm còn thiếu mặt trước; không có thì mở sản phẩm đầu đã khai ánh xạ để
  // người dùng vẫn xem/thay được design đang dùng.
  const pendingDesign =
    pendingDesignTargets(items)[0] ?? items.find((item) => item.mappingId !== null) ?? items[0];

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Tooltip content={t('pod:orders.viewDetail')}>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          aria-label={t('pod:orders.viewDetail')}
          onClick={(event) => {
            event.stopPropagation();
            router.push(`/dashboard/pod/orders/${orderId}`);
          }}
        >
          <Eye className="size-4" />
        </Button>
      </Tooltip>

      <DropdownMenu
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label={t('common:action.more')}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      >
        <DropdownMenuItem onSelect={() => router.push(`/dashboard/pod/orders/${orderId}`)}>
          <Eye className="size-4" />
          {t('pod:orders.viewDetail')}
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!pendingDesign}
          onSelect={() => pendingDesign && onUploadDesign(pendingDesign)}
        >
          <ImageUp className="size-4" />
          {t('pod:product.uploadDesign')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!hasFulfillment || !canFulfill || actions.sync.isPending}
          onSelect={() =>
            void actions.sync
              .mutateAsync()
              .then(() => toast.success(t('pod:orders.actions.syncDone')))
              .catch((error: unknown) => toast.error(translateApiError(error)))
          }
        >
          {actions.sync.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t('pod:orders.actions.syncFulfillment')}
        </DropdownMenuItem>

        {canCancel && (
          <DropdownMenuItem
            destructive
            disabled={!state.data?.canCancel || actions.cancel.isPending}
            onSelect={() => {
              setReason('');
              setCancelOpen(true);
            }}
          >
            <XCircle className="size-4" />
            {t('pod:orders.actions.cancelFulfillment')}
          </DropdownMenuItem>
        )}
      </DropdownMenu>

      {/* Huỷ là thao tác một chiều ⇒ luôn hỏi lại, và cho ghi lý do để đối soát với xưởng in. */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('pod:orders.actions.cancelFulfillment')}
        className="max-w-sm"
      >
        <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
          <p className="text-sm text-muted-foreground">{t('pod:orders.actions.cancelConfirm')}</p>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('pod:orders.actions.cancelReasonPlaceholder')}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actions.cancel.isPending}
              onClick={() =>
                void actions.cancel
                  .mutateAsync(reason.trim() || undefined)
                  .then(() => {
                    toast.success(t('fulfillment:action.cancelSuccess'));
                    setCancelOpen(false);
                  })
                  .catch((error: unknown) => toast.error(translateApiError(error)))
              }
            >
              {actions.cancel.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('pod:orders.actions.cancelFulfillment')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
