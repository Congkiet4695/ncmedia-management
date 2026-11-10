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
  const cancelTarget = state?.fulfillment ?? null;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

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

        {/* Chỉ hiện khi CÓ quyền và bản ghi đang ở trạng thái huỷ được (backend tính `canCancel`):
            đơn chưa gửi / đã vào sản xuất / đã huỷ thì không có thao tác này. */}
        {canCancel && state?.canCancel && (
          <DropdownMenuItem
            destructive
            disabled={actions.cancel.isPending}
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
        // Đang gửi yêu cầu huỷ ⇒ không cho đóng: đóng giữa chừng rồi mở lại là đường bấm Huỷ lần hai.
        onClose={() => !actions.cancel.isPending && setCancelOpen(false)}
        title={t('pod:orders.actions.cancelFulfillment')}
        className="max-w-sm"
      >
        <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
          {/* Người dùng phải thấy ĐÚNG đơn nào ở xưởng nào sắp bị huỷ (bản ghi hiện hành, không phải
              nhà cung cấp gán cho kết nối TikTok — hai thứ có thể khác nhau sau khi đổi xưởng). */}
          {cancelTarget && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <dt className="text-muted-foreground">{t('fulfillment:provider.type')}</dt>
              <dd className="font-medium">
                {cancelTarget.provider
                  ? t(`fulfillment:provider.typeValue.${cancelTarget.provider}`, {
                      defaultValue: cancelTarget.provider,
                    })
                  : '—'}
              </dd>
              <dt className="text-muted-foreground">{t('fulfillment:externalOrderId')}</dt>
              <dd className="break-all font-mono">{cancelTarget.externalOrderId}</dd>
              {cancelTarget.providerOrderId && (
                <>
                  <dt className="text-muted-foreground">{t('fulfillment:providerOrderId')}</dt>
                  <dd className="break-all font-mono">{cancelTarget.providerOrderId}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t('fulfillment:statusLabel')}</dt>
              <dd>
                {t(`fulfillment:status.${cancelTarget.status}`, { defaultValue: cancelTarget.status })}
                {cancelTarget.providerStatus ? ` · ${cancelTarget.providerStatus}` : ''}
              </dd>
            </dl>
          )}
          <p className="text-sm text-muted-foreground">{t('pod:orders.actions.cancelConfirm')}</p>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('pod:orders.actions.cancelReasonPlaceholder')}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelOpen(false)}
              disabled={actions.cancel.isPending}
            >
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actions.cancel.isPending}
              onClick={() =>
                void actions.cancel
                  .mutateAsync(reason.trim() || undefined)
                  .then((record) => {
                    // 🔴 Chỉ báo "đã huỷ" khi nhà cung cấp XÁC NHẬN (CANCELLED) — đó cũng là điều
                    // kiện để Fulfill lại. Đã nhận yêu cầu nhưng chưa xác nhận ⇒ nói rõ là đang chờ.
                    if (record.status === 'CANCELLED') {
                      toast.success(t('fulfillment:action.cancelSuccess'), {
                        description: t('pod:orders.actions.cancelRefulfillHint'),
                      });
                    } else {
                      toast.info(t('pod:orders.actions.cancelRequested'), {
                        description: t('pod:orders.actions.cancelPendingHint', {
                          status: record.providerStatus ?? record.status,
                        }),
                      });
                    }
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
