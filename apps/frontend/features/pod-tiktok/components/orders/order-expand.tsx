'use client';

import { Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useFulfillmentErrors,
  useFulfillmentHistory,
} from '@/features/fulfillment/hooks/use-fulfillment';
import { usePodOrder } from '../../hooks/use-pod-orders';
import { EMPTY, formatOrderDateTime, orderCurrency } from '../../order-view-model';
import type { PodOrder } from '../../order-types';

interface OrderExpandProps {
  orderId: string;
  /** Có quyền `fulfillment.read` — không có thì không gọi API lịch sử/lỗi. */
  canViewFulfillment: boolean;
}

/**
 * Nội dung của dòng khi **mở rộng**.
 *
 * 🔴 **Chỉ tải khi mở.** Component này chỉ được render sau khi người dùng bấm nút Expand, nên
 * ba query bên trong (`usePodOrder`, lịch sử + lỗi fulfillment) không chạy ở trạng thái thu
 * gọn. Đây chính là điểm khiến bảng 50 dòng vẫn nhẹ: 50 dòng = 0 request chi tiết.
 *
 * Chỉ hiển thị những gì API ĐANG có. Ba mục trong bản mô tả không có nguồn dữ liệu —
 * *Warehouse Note*, *Internal Note* và *Sync History theo từng đơn* — được nêu rõ ở mục
 * "Khoảng trống dữ liệu" của báo cáo thay vì dựng ô trống cho đủ đầu mục.
 */
export function OrderExpand({ orderId, canViewFulfillment }: OrderExpandProps) {
  const { t } = useTranslation(['pod', 'fulfillment']);
  const translateApiError = useApiError();
  const { formatCurrency } = useLocaleFormat();

  const detail = usePodOrder(orderId);
  const history = useFulfillmentHistory(orderId, canViewFulfillment);
  const errors = useFulfillmentErrors(orderId, canViewFulfillment);

  if (detail.isLoading) {
    return (
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <p className="p-4 text-sm text-destructive">
        {detail.error ? translateApiError(detail.error) : t('pod:orders.detailFailed')}
      </p>
    );
  }

  const order: PodOrder = detail.data;
  const currency = orderCurrency(order.currency);

  return (
    <div className="space-y-4 bg-muted/30 p-4">
      <div className="grid gap-4 lg:grid-cols-4">
        {/* --- Buyer Information --- */}
        <Section title={t('pod:orders.expand.buyer')}>
          <Field label={t('pod:orders.expand.buyerNickname')} value={order.buyerNickname} />
          <Field label={t('pod:orders.expand.buyerEmail')} value={order.buyerEmail} />
          <Field label={t('pod:orders.expand.buyerMessage')} value={order.buyerMessage} wrap />
        </Section>

        {/* --- Shipping Address --- */}
        <Section
          title={t('pod:orders.expand.shipping')}
          badge={
            order.recipientMasked ? (
              // Địa chỉ người nhận được mã hoá phía backend (PII) — nói rõ để không ai đi tìm.
              <Tooltip content={t('pod:orders.expand.maskedHint')}>
                <Badge variant="muted" className="h-5 px-1.5 text-[10px]">
                  <ShieldCheck className="mr-0.5 size-2.5" />
                  {t('pod:orders.expand.masked')}
                </Badge>
              </Tooltip>
            ) : undefined
          }
        >
          <Field label={t('pod:orders.expand.region')} value={order.recipientRegionCode} />
          <Field label={t('pod:orders.expand.postalCode')} value={order.recipientPostalCode} />
          <Field label={t('pod:orders.expand.shippingType')} value={order.shippingType} />
          <Field label={t('pod:orders.expand.provider')} value={order.shippingProvider} />
        </Section>

        {/* --- Giá đầy đủ (chỉ endpoint chi tiết mới có tax/phí ship/giảm giá) --- */}
        <Section title={t('pod:orders.expand.priceBreakdown')}>
          <Field
            label={t('pod:orders.price.subtotal')}
            value={money(order.subTotal, currency, formatCurrency)}
          />
          <Field
            label={t('pod:orders.price.tax')}
            value={money(order.tax, currency, formatCurrency)}
          />
          <Field
            label={t('pod:orders.expand.shippingFee')}
            value={money(order.shippingFee, currency, formatCurrency)}
          />
          <Field
            label={t('pod:orders.expand.sellerDiscount')}
            value={money(order.sellerDiscount, currency, formatCurrency)}
          />
          <Field
            label={t('pod:orders.expand.platformDiscount')}
            value={money(order.platformDiscount, currency, formatCurrency)}
          />
          <Field
            label={t('pod:orders.price.buyerPaid')}
            value={money(order.totalAmount, currency, formatCurrency)}
          />
        </Section>

        {/* --- Ghi chú + Timeline mốc thời gian --- */}
        <Section title={t('pod:orders.expand.notesAndTimeline')}>
          <Field label={t('pod:orders.expand.sellerNote')} value={order.sellerNote} wrap />
          <Field
            label={t('pod:orders.expand.orderedAt')}
            value={formatOrderDateTime(order.orderedAt)}
          />
          <Field
            label={t('pod:orders.expand.paidAt')}
            value={order.paidTime ? formatOrderDateTime(order.paidTime) : null}
          />
          <Field
            label={t('pod:orders.expand.rtsSla')}
            value={order.rtsSlaTime ? formatOrderDateTime(order.rtsSlaTime) : null}
          />
          <Field
            label={t('pod:orders.expand.tiktokUpdated')}
            value={formatOrderDateTime(order.tiktokUpdatedAt)}
          />
          <Field
            label={t('pod:orders.expand.lastSynced')}
            value={`${formatOrderDateTime(order.lastSyncedAt)} (v${order.syncVersion})`}
          />
          {order.cancelReason && (
            <Field label={t('pod:orders.expand.cancelReason')} value={order.cancelReason} wrap />
          )}
        </Section>
      </div>

      {/* --- Timeline thật: lịch sử fulfillment (mỗi dòng là một sự kiện đã xảy ra) --- */}
      {canViewFulfillment && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('pod:orders.expand.timeline')}>
            {history.isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (history.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t('pod:orders.expand.timelineEmpty')}</p>
            ) : (
              <ol className="space-y-1">
                {(history.data ?? []).slice(0, 12).map((entry) => (
                  <li key={entry.id} className="flex gap-2">
                    <span className="w-32 shrink-0 font-mono tabular-nums text-muted-foreground">
                      {formatOrderDateTime(entry.createdAt)}
                    </span>
                    <span className={entry.success ? '' : 'text-destructive'}>
                      {entry.eventType}
                      {entry.toStatus ? ` → ${entry.toStatus}` : ''}
                      {entry.message ? ` · ${entry.message}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* --- Log lỗi từ xưởng in: mã lỗi + request id để đối chiếu với nhà cung cấp --- */}
          <Section title={t('pod:orders.expand.logs')}>
            {errors.isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (errors.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t('pod:orders.expand.logsEmpty')}</p>
            ) : (
              <ul className="space-y-1">
                {(errors.data ?? []).slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex gap-2">
                    <span className="w-32 shrink-0 font-mono tabular-nums text-muted-foreground">
                      {formatOrderDateTime(entry.createdAt)}
                    </span>
                    <span className="text-destructive">
                      [{entry.operation}] {entry.message}
                      {entry.requestId ? ` · ${entry.requestId}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function money(
  value: number | null,
  currency: string,
  format: (value: number | null, currency: string | null) => string,
): string | null {
  return value === null ? null : format(value, currency);
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        {badge}
      </div>
      <dl className="space-y-0.5">{children}</dl>
    </section>
  );
}

function Field({
  label,
  value,
  wrap,
}: {
  label: string;
  value: string | null;
  wrap?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground opacity-80">{label}</dt>
      <dd className={wrap ? 'min-w-0 flex-1 break-words' : 'min-w-0 flex-1 truncate'}>
        {value ?? EMPTY}
      </dd>
    </div>
  );
}
