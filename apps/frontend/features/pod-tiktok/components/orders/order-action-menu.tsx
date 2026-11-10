'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Eye, ImageUp, Loader2, MoreHorizontal, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { canShowCancelOrder, isCancelOrderPending } from '@/features/fulfillment/cancel-order';
import { isProviderOrderGone } from '@/features/fulfillment/provider-order';
import { CancelOrderDialog } from '@/features/fulfillment/components/cancel-order-dialog';
import {
  useFulfillmentActions,
} from '@/features/fulfillment/hooks/use-fulfillment';
import type { FulfillmentState } from '@/features/fulfillment/types';
import { pendingDesignTargets } from '../../order-view-model';
import type { PodOrderItem } from '../../order-types';

interface OrderActionMenuProps {
  orderId: string;
  items: PodOrderItem[];
  /** Quyền `fulfillment.read` — quyết định có hỏi trạng thái xưởng in hay không. */
  /** Trạng thái của đơn, do bảng tải theo lô cho cả trang. */
  state: FulfillmentState | undefined;
  canFulfill: boolean;
  /**
   * Quyền `fulfillment.cancel` — huỷ đơn đã gửi sang xưởng in (Admin, và Seller với đơn thuộc shop
   * được gán). Chỉ quyết định HIỆN nút; backend vẫn kiểm quyền + phạm vi shop ở mọi request.
   */
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
 * 🔴 **Cancel** được giữ lại từ bảng fulfillment của màn hình cũ. Bố cục mới gọn hơn nhưng
 * không được phép làm mất một thao tác nghiệp vụ đang có — huỷ đơn ở xưởng in là việc thật,
 * và bỏ nó đi chỉ để bảng đẹp hơn là đẩy người vận hành sang cổng quản trị của nhà cung cấp.
 */
export function OrderActionMenu({
  orderId,
  items,
  state,
  canFulfill,
  canCancel,
  onUploadDesign,
}: OrderActionMenuProps) {
  const { t } = useTranslation(['pod', 'common', 'fulfillment']);
  const router = useRouter();
  const translateApiError = useApiError();
  const actions = useFulfillmentActions(orderId);
  const hasFulfillment = Boolean(state?.fulfillment);
  // Bản ghi nhập tay (Import Excel) không có ở nhà cung cấp ⇒ không có gì để đồng bộ (backend cũng chặn).
  const manualRecord = state?.fulfillment?.source === 'MANUAL_IMPORT';
  // Cùng luật với drawer Fulfill Order (`canShowCancelOrder`): quyền + `canCancel` do backend tính.
  const showCancel = canShowCancelOrder({ allowed: canCancel, state });
  // Đã gửi yêu cầu huỷ, chờ nhà cung cấp xác nhận ⇒ nói rõ thay cho nút (không cho gửi lần hai).
  const cancelPending = isCancelOrderPending({ allowed: canCancel, state });
  const [cancelOpen, setCancelOpen] = useState(false);

  // Ưu tiên sản phẩm còn thiếu mặt trước; không có thì mở sản phẩm đầu đã khai ánh xạ để
  // người dùng vẫn xem/thay được design đang dùng.
  // Quà tặng không phải sản phẩm cần design: không mở dialog cho nó khi đơn còn sản phẩm chính.
  const mainItems = items.filter((item) => !item.isGift);
  const pendingDesign =
    pendingDesignTargets(mainItems)[0] ?? mainItems.find((item) => item.mappingId !== null) ?? mainItems[0];

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
          disabled={!hasFulfillment || manualRecord || !canFulfill || actions.sync.isPending}
          onSelect={() =>
            void actions.sync
              .mutateAsync()
              .then((record) =>
                // Nhà cung cấp không còn đơn (bị xoá) ⇒ backend đã mở lại Fulfill — nói rõ, không báo "đã đồng bộ" chung chung.
                isProviderOrderGone(record)
                  ? toast.warning(t('fulfillment:providerOrderGone.title'), {
                      description: t('fulfillment:providerOrderGone.short'),
                    })
                  : toast.success(t('pod:orders.actions.syncDone')),
              )
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

        {/* Chỉ hiện khi CÓ quyền và bản ghi đang ở trạng thái huỷ được (backend tính `canCancel`):
            đơn chưa gửi / đã vào sản xuất / đã huỷ thì không có thao tác này. */}
        {cancelPending && (
          <DropdownMenuItem disabled>
            <Clock className="size-4" />
            {t('fulfillment:cancelDialog.pendingBadge')}
          </DropdownMenuItem>
        )}
        {showCancel && (
          <DropdownMenuItem destructive onSelect={() => setCancelOpen(true)}>
            <XCircle className="size-4" />
            {t('fulfillment:action.cancelOrder')}
          </DropdownMenuItem>
        )}
      </DropdownMenu>

      {/* Dialog DÙNG CHUNG với drawer Fulfill Order — cùng xác nhận, cùng mutation, cùng thông báo. */}
      <CancelOrderDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        podOrderId={orderId}
        target={state?.fulfillment ?? null}
      />
    </div>
  );
}
