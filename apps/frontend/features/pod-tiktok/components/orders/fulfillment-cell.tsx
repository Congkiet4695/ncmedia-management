'use client';

import { AlertTriangle, Factory, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useFulfillmentActions,
  useFulfillmentState,
} from '@/features/fulfillment/hooks/use-fulfillment';
import type { FulfillmentStatus } from '@/features/fulfillment/types';
import { EMPTY, formatOrderDateTime, orderCurrency } from '../../order-view-model';

interface FulfillmentCellProps {
  podOrderId: string;
  /** Có quyền `fulfillment.read` — không có thì KHÔNG gọi API. */
  enabled: boolean;
  /** Có quyền `fulfillment.create` — quyết định hiện nút Fulfill. */
  canFulfill: boolean;
}

const STATUS_VARIANT: Record<FulfillmentStatus, 'default' | 'muted' | 'destructive' | 'success'> = {
  DRAFT: 'muted',
  SUBMITTING: 'muted',
  SUBMITTED: 'default',
  IN_PRODUCTION: 'default',
  ON_HOLD: 'muted',
  SHIPPED: 'default',
  DELIVERED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
  FAILED: 'destructive',
  UNKNOWN: 'muted',
};

/**
 * Cột **Fulfillment Info** (§6).
 *
 * ```
 *   chưa gửi  →  "Not Fulfilled" + nút [Fulfill]
 *   đã gửi    →  Provider · Fulfilled At · Fulfilled By · Base Cost   (KHÔNG còn nút Fulfill)
 * ```
 *
 * 🔴 Nút Fulfill gọi ĐÚNG `fulfillmentService.fulfill(podOrderId)` đang có — không có logic
 * fulfillment mới nào ở tầng giao diện. Nút chỉ bật khi **backend** xác nhận `canFulfill`:
 * cho bấm rồi để server từ chối là dạy người dùng bỏ qua thông báo lỗi.
 *
 * 🔴 **Lý do chặn phải HIỆN RA, không giấu trong tooltip.** Bản trước bọc nút bị `disabled`
 * trong `<Tooltip>`: nút disabled không phát sự kiện chuột, nên tooltip mang lý do KHÔNG BAO
 * GIỜ hiện — người dùng chỉ thấy một nút xám chết, không biết thiếu gì. Đó chính là triệu
 * chứng "bấm Fulfill không có tác dụng" được báo. Nay danh sách thiếu sót in thẳng dưới nút
 * (§7), và phần hover được chuyển sang một `<span>` bao ngoài để tooltip vẫn hoạt động.
 *
 * 🔴 Mỗi dòng tự hỏi trạng thái fulfillment của mình (`GET /fulfillment/:orderId/state`) —
 * hệ thống không có endpoint lấy hàng loạt. Đây đúng bằng số request mà màn hình cũ đã tạo
 * (mỗi thẻ đơn một `FulfillmentPanel`), nên không phải bước lùi về hiệu năng.
 */
export function FulfillmentCell({ podOrderId, enabled, canFulfill }: FulfillmentCellProps) {
  const { t } = useTranslation(['pod', 'fulfillment']);
  const translateApiError = useApiError();
  const { formatCurrency } = useLocaleFormat();

  const state = useFulfillmentState(podOrderId, enabled);
  const actions = useFulfillmentActions(podOrderId);

  if (!enabled) {
    return <span className="text-xs text-muted-foreground">{EMPTY}</span>;
  }

  if (state.isLoading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  const data = state.data;
  const fulfillment = data?.fulfillment ?? null;

  // ----------------------------------------------------------------- Chưa gửi
  if (!fulfillment) {
    const issues = data?.issues ?? [];
    const blocked = !data?.canFulfill;

    return (
      <div className="space-y-1">
        <Badge variant="muted" className="h-5 whitespace-nowrap px-1.5 text-[10px]">
          {t('pod:orders.fulfillment.notFulfilled')}
        </Badge>

        {canFulfill && (
          <>
            {/* Bọc trong <span>: nút disabled không phát sự kiện chuột nên tooltip gắn
                thẳng vào nút sẽ không bao giờ hiện. */}
            <Tooltip
              content={
                blocked
                  ? t('pod:orders.fulfillment.blockedHint')
                  : t('pod:orders.fulfillment.fulfillHint')
              }
            >
              <span className="block">
                <Button
                  variant={blocked ? 'outline' : 'default'}
                  size="sm"
                  disabled={blocked || actions.fulfill.isPending}
                  className="h-6 w-full px-2 text-[11px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    void actions.fulfill
                      .mutateAsync()
                      .then(() => toast.success(t('fulfillment:action.fulfillSuccess')))
                      .catch((error: unknown) => toast.error(translateApiError(error)));
                  }}
                >
                  {actions.fulfill.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : blocked ? (
                    <AlertTriangle className="size-3" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  {t('pod:orders.fulfillment.fulfill')}
                </Button>
              </span>
            </Tooltip>

            {/* §7 — nói CHÍNH XÁC thiếu gì: thiếu Product Mapping / thiếu Design / thiếu nhà
                cung cấp / thiếu ánh xạ biến thể. Backend đã trả từng câu cụ thể, việc ở đây
                chỉ là ĐỪNG giấu chúng đi. */}
            {issues.length > 0 && (
              <ul className="space-y-0.5">
                {issues.map((issue) => (
                  <li
                    key={issue.code}
                    className="flex gap-1 text-[10px] leading-tight text-destructive"
                  >
                    <AlertTriangle className="mt-px size-2.5 shrink-0" />
                    <span className="line-clamp-2" title={issue.message}>
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------------- Đã gửi
  return (
    <div className="space-y-0.5 text-[11px] leading-tight">
      <div className="flex items-center gap-1">
        <Factory className="size-3 shrink-0 text-muted-foreground" />
        <Badge
          variant={STATUS_VARIANT[fulfillment.status] ?? 'muted'}
          className="h-5 whitespace-nowrap px-1.5 text-[10px]"
        >
          {t(`fulfillment:status.${fulfillment.status}`)}
        </Badge>
      </div>

      <Row
        label={t('pod:orders.fulfillment.provider')}
        value={data?.provider?.name ?? fulfillment.provider}
      />
      <Row
        label={t('pod:orders.fulfillment.fulfilledAt')}
        value={formatOrderDateTime(fulfillment.submittedAt)}
        mono
      />
      {/* 🔴 `fulfilledBy` chưa có trong DTO fulfillment — xem "Khoảng trống dữ liệu" ở báo cáo.
          Hiện `—` kèm giải thích, không bịa ra một cái tên. */}
      <Row
        label={t('pod:orders.fulfillment.fulfilledBy')}
        value={EMPTY}
        hint={t('pod:orders.fulfillment.fulfilledByHint')}
      />
      <Row
        label={t('pod:orders.fulfillment.baseCost')}
        value={
          fulfillment.total === null
            ? EMPTY
            : // Cùng quy ước với cột Price: thiếu mã tiền tệ thì mặc định USD, không rơi về
              // định dạng của ngôn ngữ đang chọn (§3 — không dùng VND).
              formatCurrency(fulfillment.total, orderCurrency(fulfillment.currency))
        }
        mono
      />

      {fulfillment.lastErrorMessage && (
        <Tooltip content={fulfillment.lastErrorMessage}>
          <p className="line-clamp-1 text-[10px] text-destructive">
            {fulfillment.lastErrorMessage}
          </p>
        </Tooltip>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-1.5">
      <span className="shrink-0 text-muted-foreground opacity-80">{label}</span>
      <span className={mono ? 'truncate tabular-nums' : 'truncate'}>{value}</span>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
