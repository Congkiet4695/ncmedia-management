'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { buildPriceBreakdown, collectTrackingNumbers } from '../../order-view-model';
import { PodOrderStatusBadge } from '../pod-order-status-badge';
import { FulfillmentCell } from './fulfillment-cell';
import { OrderActionMenu } from './order-action-menu';
import { OrderExpand } from './order-expand';
import { OrderInfoCell } from './order-info-cell';
import { OrderPriceCell } from './order-price-cell';
import { OrderProductsCell } from './order-products-cell';
import { TrackingCell } from './tracking-cell';
import type { LightboxRequest, OrderProductRow } from '../../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../../order-types';

interface PodOrderCardProps {
  order: PodOrderListItem;
  accountId?: string;
  selected: boolean;
  expanded: boolean;
  canViewFulfillment: boolean;
  canFulfill: boolean;
  canCancelFulfillment: boolean;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onUploadDesign: (item: PodOrderItem) => void;
  /** Mở dialog khai Product Mapping cho một dòng sản phẩm chưa ánh xạ. */
  onMapProduct: (row: OrderProductRow) => void;
  /** Mở bộ xem ảnh — dùng CHUNG cho ảnh sản phẩm và ảnh design. */
  onPreviewImages: (request: LightboxRequest) => void;
}

/**
 * Bố cục **Card** cho màn hình hẹp (§Responsive → Mobile).
 *
 * 🔴 Dùng LẠI nguyên các cell của bảng thay vì viết bản mobile riêng: một logic hiển thị,
 * hai cách sắp xếp. Viết hai lần là hai lần phải sửa mỗi khi nghiệp vụ đổi, và chỉ cần quên
 * một lần là mobile bắt đầu nói khác desktop.
 */
export function PodOrderCard({
  order,
  accountId,
  selected,
  expanded,
  canViewFulfillment,
  canFulfill,
  canCancelFulfillment,
  onToggleSelect,
  onToggleExpand,
  onUploadDesign,
  onMapProduct,
  onPreviewImages,
}: PodOrderCardProps) {
  const { t } = useTranslation('pod');
  const price = buildPriceBreakdown(order);
  const tracking = collectTrackingNumbers(order);

  return (
    <article className={cn('overflow-hidden rounded-lg border', selected && 'border-primary/50 bg-primary/5')}>
      <header className="flex items-start gap-2 border-b bg-muted/30 p-3">
        <Checkbox
          checked={selected}
          aria-label={t('orders.bulk.selectRow')}
          onChange={() => onToggleSelect(order.id)}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <OrderInfoCell order={order} accountId={accountId} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <PodOrderStatusBadge status={order.status} />
          <OrderActionMenu
            orderId={order.id}
            items={order.items}
            canViewFulfillment={canViewFulfillment}
            canFulfill={canFulfill}
            canCancel={canCancelFulfillment}
            onUploadDesign={onUploadDesign}
          />
        </div>
      </header>

      <div className="space-y-3 p-3">
        <OrderProductsCell
          items={order.items}
          onUploadDesign={onUploadDesign}
          onMapProduct={onMapProduct}
          onPreviewImages={onPreviewImages}
        />

        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('orders.columns.price')}
            </p>
            <OrderPriceCell price={price} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('orders.columns.tracking')}
            </p>
            <TrackingCell numbers={tracking} />
          </div>
        </div>

        <div className="border-t pt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('orders.columns.fulfillment')}
          </p>
          <FulfillmentCell
            podOrderId={order.id}
            enabled={canViewFulfillment}
            canFulfill={canFulfill}
          />
        </div>

        <button
          type="button"
          onClick={() => onToggleExpand(order.id)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1 rounded border border-dashed py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {expanded ? t('orders.collapseRow') : t('orders.expandRow')}
        </button>
      </div>

      {/* Chỉ render khi mở — cùng nguyên tắc với bảng desktop. */}
      {expanded && <OrderExpand orderId={order.id} canViewFulfillment={canViewFulfillment} />}
    </article>
  );
}
