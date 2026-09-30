'use client';

import { useState } from 'react';
import { AlertTriangle, Factory, RotateCcw, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { FulfillOrderDrawer } from '@/features/fulfillment/components/fulfill-order-drawer';
import { useFulfillmentState } from '@/features/fulfillment/hooks/use-fulfillment';
import type { FulfillmentCancellation, FulfillmentStatus } from '@/features/fulfillment/types';
import { SUBMITTABLE_STATUSES } from '@/features/fulfillment/product-config';
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
 *   chưa gửi       →  "Not Fulfilled" + nút [Fulfill]
 *   đã gửi         →  Provider · Fulfilled By · Fulfilled At · Mã NCC · Base Cost · Tracking
 *   đã huỷ / hỏng  →  như trên + nút [Fulfill lại] / [Gửi lại] (lần thử mới do backend quyết)
 * ```
 *
 * 🔴 Nút Fulfill **mở Drawer** (`FulfillOrderDrawer`) chứ không POST thẳng: gửi sản xuất là
 * quyết định cần đọc đơn, ánh xạ, design và chọn phương thức vận chuyển — bấm một phát rồi
 * "hy vọng mặc định đúng" là cách tạo ra những đơn in sai. Toàn bộ nghiệp vụ vẫn nằm ở
 * service/hook cũ, drawer chỉ là nơi hiển thị và thu thập lựa chọn.
 *
 * 🔴 **Lý do chặn phải HIỆN RA, không giấu trong tooltip.** Bản trước bọc nút bị `disabled`
 * trong `<Tooltip>`: nút disabled không phát sự kiện chuột, nên tooltip mang lý do KHÔNG BAO
 * GIỜ hiện — người dùng chỉ thấy một nút xám chết, không biết thiếu gì. Đó chính là triệu
 * chứng "bấm Fulfill không có tác dụng" được báo. Nay danh sách thiếu sót in thẳng dưới nút
 * (§7), và phần hover được chuyển sang một `<span>` bao ngoài để tooltip vẫn hoạt động.
 *
 * 🔴 Mỗi dòng tự hỏi trạng thái fulfillment của mình (`GET /fulfillment/:orderId/state`) —
 * hệ thống không có endpoint lấy hàng loạt. Đây đúng bằng số request mà màn hình cũ đã tạo
 * (mỗi thẻ đơn một bảng fulfillment riêng), nên không phải bước lùi về hiệu năng.
 */
export function FulfillmentCell({ podOrderId, enabled, canFulfill }: FulfillmentCellProps) {
  const { t } = useTranslation(['pod', 'fulfillment']);
  const { formatCurrency } = useLocaleFormat();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const state = useFulfillmentState(podOrderId, enabled);

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

  const drawer = (
    <FulfillOrderDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      podOrderId={podOrderId}
    />
  );

  // ----------------------------------------------------------------- Chưa gửi
  if (!fulfillment) {
    const issues = data?.issues ?? [];
    const blocked = !data?.canFulfill;

    return (
      <div className="space-y-1">
        {drawer}
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
                {/* 🔴 Mở được KỂ CẢ khi đang bị chặn: drawer là nơi nói rõ thiếu gì và sửa
                    ngay tại chỗ (khai ánh xạ nhanh). Nút xám chết không dạy người dùng điều gì. */}
                <Button
                  variant={blocked ? 'outline' : 'default'}
                  size="sm"
                  className="h-6 w-full px-2 text-[11px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDrawerOpen(true);
                  }}
                >
                  {blocked ? (
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
  // Đã huỷ (nhà cung cấp xác nhận) / gửi hỏng ⇒ vẫn gửi (lại) được — hiện nút ngay tại cột,
  // không bắt người dùng phải biết mở drawer bằng cách bấm vào badge trạng thái.
  const resubmittable = canFulfill && SUBMITTABLE_STATUSES.includes(fulfillment.status);
  const costCurrency = orderCurrency(fulfillment.currency);
  // 🔴 Base cost = Σ giá vốn SẢN PHẨM (backend tính theo mọi dòng × số lượng) — KHÔNG phải `total`
  // của nhà cung cấp (đã gồm phí ship). Chưa được nhà cung cấp xác nhận ⇒ "chờ báo giá", không
  // hiển thị số tạm như thể là giá thật.
  const costPending = fulfillment.baseCostPending || !fulfillment.productCostConfirmed;
  const baseCostValue =
    fulfillment.status === 'CANCELLED' || fulfillment.status === 'FAILED'
      ? EMPTY
      : costPending
        ? t('pod:orders.fulfillment.baseCostPending')
        : fulfillment.productCost === null
          ? EMPTY
          : formatCurrency(fulfillment.productCost, costCurrency);
  const costBreakdown = [
    fulfillment.shippingFee === null
      ? null
      : `${t('pod:orders.fulfillment.providerShipping')}: ${formatCurrency(fulfillment.shippingFee, costCurrency)}`,
    fulfillment.tax === null
      ? null
      : `${t('pod:orders.fulfillment.providerTax')}: ${formatCurrency(fulfillment.tax, costCurrency)}`,
    fulfillment.total === null
      ? null
      : `${t('pod:orders.fulfillment.providerTotal')}: ${formatCurrency(fulfillment.total, costCurrency)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-0.5 text-[11px] leading-tight">
      {drawer}
      <div className="flex items-center gap-1">
        <Factory className="size-3 shrink-0 text-muted-foreground" />
        {/* Đã gửi vẫn mở được drawer — để xem kết quả, giá vốn và lý do lỗi (không gửi lại được). */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDrawerOpen(true);
          }}
          title={t('pod:orders.fulfillment.openDetail')}
        >
          <Badge
            variant={STATUS_VARIANT[fulfillment.status] ?? 'muted'}
            className="h-5 whitespace-nowrap px-1.5 text-[10px]"
          >
            {t(`fulfillment:status.${fulfillment.status}`)}
          </Badge>
        </button>
      </div>

      <Row
        label={t('pod:orders.fulfillment.provider')}
        value={t(`fulfillment:provider.typeValue.${fulfillment.provider}`)}
      />
      {/* 🔴 Nhà cung cấp THỰC SỰ nhận đơn (tài khoản của chính bản ghi) — không phải nhà cung cấp
          mặc định của kết nối TikTok. */}
      <Row
        label={t('pod:orders.fulfillment.fulfilledBy')}
        value={fulfillment.fulfilledBy ?? EMPTY}
      />
      <Row
        label={t('pod:orders.fulfillment.fulfilledAt')}
        value={formatOrderDateTime(fulfillment.submittedAt)}
        mono
      />
      {fulfillment.providerOrderId && (
        <Row
          label={t('pod:orders.fulfillment.providerOrderId')}
          value={fulfillment.providerOrderId}
          mono
        />
      )}
      <Row
        label={t('pod:orders.fulfillment.baseCost')}
        value={baseCostValue}
        hint={costPending ? t('pod:orders.fulfillment.baseCostPendingHint') : costBreakdown || undefined}
        mono
      />
      {fulfillment.trackingNumber && (
        <Row
          label={t('pod:orders.fulfillment.tracking')}
          value={fulfillment.trackingNumber}
          mono
        />
      )}

      {fulfillment.status === 'CANCELLED' && data?.cancellation && (
        <CancellationLine cancellation={data.cancellation} />
      )}

      {resubmittable && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 h-6 w-full px-2 text-[11px]"
          onClick={(event) => {
            event.stopPropagation();
            setDrawerOpen(true);
          }}
        >
          <RotateCcw className="size-3" />
          {fulfillment.status === 'CANCELLED'
            ? t('pod:orders.fulfillment.refulfill')
            : t('pod:orders.fulfillment.retry')}
        </Button>
      )}

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

/** "Huỷ bởi X · lúc Y" + lý do (tooltip) — truy vết được ai đã huỷ, kể cả Seller. */
function CancellationLine({ cancellation }: { cancellation: FulfillmentCancellation }) {
  const { t } = useTranslation('pod');
  const text = t('orders.fulfillment.cancelledBy', {
    who: cancellation.cancelledBy ?? EMPTY,
    at: formatOrderDateTime(cancellation.cancelledAt),
  });
  const body = <p className="line-clamp-2 text-[10px] text-muted-foreground">{text}</p>;
  return cancellation.reason ? (
    <Tooltip content={t('orders.fulfillment.cancelReason', { reason: cancellation.reason })}>{body}</Tooltip>
  ) : (
    body
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
