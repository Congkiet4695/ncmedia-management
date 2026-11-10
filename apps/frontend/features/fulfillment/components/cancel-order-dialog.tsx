'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { cancelOrderOutcome, classifyCancelOrderError } from '../cancel-order';
import { useFulfillmentActions } from '../hooks/use-fulfillment';
import type { FulfillmentOrder } from '../types';

interface CancelOrderDialogProps {
  open: boolean;
  onClose: () => void;
  podOrderId: string;
  /** Bản ghi fulfillment HIỆN HÀNH sắp bị huỷ — để người dùng thấy đúng đơn nào ở xưởng nào. */
  target: FulfillmentOrder | null;
  /** Mã đơn TikTok — hiện kèm khi nơi gọi có sẵn (drawer). */
  tiktokOrderId?: string | null;
  /** Gọi sau khi backend trả về thành công (đã huỷ hoặc đang chờ nhà cung cấp xác nhận). */
  onCancelled?: (record: FulfillmentOrder) => void;
}

/**
 * Xác nhận **Cancel Order** — dialog DUY NHẤT cho mọi nơi huỷ đơn ở xưởng in (menu Action của dòng
 * đơn và drawer Fulfill Order).
 *
 * ```
 *   [Cancel Order] ─▶ dialog (nhà cung cấp · mã đơn · trạng thái · lý do)
 *        ─▶ POST /fulfillment/orders/{podOrderId}/cancel   (useFulfillmentActions().cancel)
 *        ─▶ CANCELLED  ⇒ toast thành công, Fulfill lại được
 *           chưa xác nhận ⇒ toast "đang chờ nhà cung cấp"
 *           timeout   ⇒ "có thể vẫn đang xử lý" + đọc lại trạng thái (KHÔNG báo thất bại)
 *           409 đang chờ / đang chạy ⇒ "đang được xử lý"
 *           bị từ chối ⇒ toast lỗi, dialog GIỮ NGUYÊN để thử lại, trạng thái không đổi
 * ```
 *
 * 🔴 Không có trạng thái "đã huỷ" do giao diện tự đặt: mutation làm mới `fulfillment` (kể cả khi
 * lỗi) và màn hình đọc lại trạng thái thật từ backend.
 *
 * 🔴 Chống bấm hai lần ở hai lớp: nút khoá khi `isPending`, và `submittingRef` chặn lần bấm thứ hai
 * lọt vào trước khi React kịp vẽ lại. Backend còn khoá phân tán theo đơn.
 */
export function CancelOrderDialog({
  open,
  onClose,
  podOrderId,
  target,
  tiktokOrderId,
  onCancelled,
}: CancelOrderDialogProps) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const translateApiError = useApiError();
  const { cancel } = useFulfillmentActions(podOrderId);
  const [reason, setReason] = useState('');
  const submittingRef = useRef(false);
  const pending = cancel.isPending;

  // Mỗi lần mở là một lần huỷ mới: không giữ lý do của lần trước.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  // Đang gửi yêu cầu huỷ ⇒ không cho đóng: đóng giữa chừng rồi mở lại là đường bấm Huỷ lần hai.
  const close = () => {
    if (!pending && !submittingRef.current) onClose();
  };

  const confirm = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const record = await cancel.mutateAsync(reason.trim() || undefined);
      // Chỉ báo "đã huỷ" khi nhà cung cấp XÁC NHẬN — đó cũng là điều kiện để Fulfill lại.
      if (cancelOrderOutcome(record) === 'CANCELLED') {
        toast.success(t('fulfillment:action.cancelSuccess'), {
          description: t('fulfillment:cancelDialog.refulfillHint'),
        });
      } else {
        toast.info(t('fulfillment:cancelDialog.requested'), {
          description: t('fulfillment:cancelDialog.pendingHint', {
            status: record.providerStatus ?? record.status,
          }),
        });
      }
      submittingRef.current = false;
      onCancelled?.(record);
      onClose();
    } catch (error) {
      submittingRef.current = false;
      const failure = classifyCancelOrderError(error);
      if (failure === 'UNKNOWN_OUTCOME') {
        // 🔴 Không có phản hồi ≠ bị từ chối: backend có thể vẫn đang chạy và nhà cung cấp có thể đã nhận
        // yêu cầu. KHÔNG báo "không huỷ được"; đóng dialog (không mời bấm lại) — mutation tự đọc lại
        // trạng thái, và backend chặn yêu cầu huỷ thứ hai.
        toast.info(t('fulfillment:cancelDialog.timeoutTitle'), {
          description: t('fulfillment:cancelDialog.timeoutHint'),
        });
        onClose();
        return;
      }
      if (failure === 'ALREADY_PENDING') {
        toast.info(t('fulfillment:cancelDialog.alreadyPendingTitle'), {
          description: t('fulfillment:cancelDialog.alreadyPendingHint'),
        });
        onClose();
        return;
      }
      // Bị từ chối thật ⇒ GIỮ dialog để thử lại; trạng thái do backend quyết, không đổi ở đây.
      toast.error(t('fulfillment:cancelDialog.failed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal open={open} onClose={close} title={t('fulfillment:cancelDialog.title')} className="max-w-sm">
      {/* Dialog nằm trong dòng bảng có thể bấm để mở rộng ⇒ chặn sự kiện lan ra ngoài. */}
      <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
        {target && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            {tiktokOrderId && (
              <>
                <dt className="text-muted-foreground">{t('fulfillment:cancelDialog.order')}</dt>
                <dd className="break-all font-mono">{tiktokOrderId}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('fulfillment:provider.type')}</dt>
            <dd className="font-medium">
              {target.provider
                ? t(`fulfillment:provider.typeValue.${target.provider}`, { defaultValue: target.provider })
                : '—'}
            </dd>
            <dt className="text-muted-foreground">{t('fulfillment:externalOrderId')}</dt>
            <dd className="break-all font-mono">{target.externalOrderId}</dd>
            {target.providerOrderId && (
              <>
                <dt className="text-muted-foreground">{t('fulfillment:providerOrderId')}</dt>
                <dd className="break-all font-mono">{target.providerOrderId}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('fulfillment:statusLabel')}</dt>
            <dd>
              {t(`fulfillment:status.${target.status}`, { defaultValue: target.status })}
              {target.providerStatus ? ` · ${target.providerStatus}` : ''}
            </dd>
          </dl>
        )}
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {t('fulfillment:cancelDialog.warning')}
        </p>
        <textarea
          rows={3}
          value={reason}
          maxLength={500}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('fulfillment:cancelDialog.reasonPlaceholder')}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={close} disabled={pending}>
            {t('fulfillment:cancelDialog.keep')}
          </Button>
          <Button variant="destructive" size="sm" disabled={pending} onClick={() => void confirm()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            {t('fulfillment:action.cancelOrder')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
