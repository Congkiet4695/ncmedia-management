'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
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

/** Số cột của bảng — dùng cho `colSpan` của dòng mở rộng. */
export const ORDER_COLUMN_COUNT = 9;

interface PodOrderRowProps {
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
 * Một đơn = một dòng bảng (§Layout).
 *
 * 🔴 Dòng mở rộng chỉ được **render khi `expanded`** — không phải ẩn bằng CSS. `OrderExpand`
 * gọi ba query; render sẵn rồi giấu đi là 50 dòng × 3 request cho một màn hình mà người dùng
 * chưa mở cái nào.
 *
 * 🔴 Click vào dòng để mở rộng, nhưng mọi phần tử tương tác bên trong (checkbox, nút Copy,
 * link, Upload Design, Fulfill) đều `stopPropagation`: bấm Copy mà dòng bật mở ra là một
 * kiểu "đúng theo code, sai theo ý người dùng".
 */
export function PodOrderRow({
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
}: PodOrderRowProps) {
  const { t } = useTranslation('pod');
  const price = buildPriceBreakdown(order);
  const tracking = collectTrackingNumbers(order);

  return (
    <>
      <TableRow
        onClick={() => onToggleExpand(order.id)}
        className={cn('cursor-pointer align-top', selected && 'bg-primary/5', expanded && 'border-b-0')}
      >
        <TableCell className="w-9 pr-0">
          <Checkbox
            checked={selected}
            aria-label={t('orders.bulk.selectRow')}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleSelect(order.id)}
          />
        </TableCell>

        <TableCell className="w-8 px-1">
          <Tooltip content={expanded ? t('orders.collapseRow') : t('orders.expandRow')}>
            <button
              type="button"
              aria-label={expanded ? t('orders.collapseRow') : t('orders.expandRow')}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand(order.id);
              }}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          </Tooltip>
        </TableCell>

        {/* 1. Info */}
        <TableCell className="w-[200px] min-w-[180px]">
          <OrderInfoCell order={order} accountId={accountId} />
        </TableCell>

        {/* 2. Products — cột lớn nhất */}
        <TableCell className="min-w-[320px]">
          <OrderProductsCell
            items={order.items}
            onUploadDesign={onUploadDesign}
            onMapProduct={onMapProduct}
            onPreviewImages={onPreviewImages}
          />
        </TableCell>

        {/* 3. Price — ẩn ở tablet (§Responsive), header cũng ẩn tương ứng. */}
        <TableCell className="hidden w-[130px] min-w-[120px] lg:table-cell">
          <OrderPriceCell price={price} />
        </TableCell>

        {/* 4. Order Status */}
        <TableCell className="w-[130px]">
          <PodOrderStatusBadge status={order.status} />
        </TableCell>

        {/* 5. Tracking Number — ẩn ở tablet (§Responsive). */}
        <TableCell className="hidden w-[150px] lg:table-cell">
          <TrackingCell numbers={tracking} />
        </TableCell>

        {/* 6. Fulfillment Info */}
        <TableCell className="w-[170px] min-w-[150px]">
          <FulfillmentCell
            podOrderId={order.id}
            enabled={canViewFulfillment}
            canFulfill={canFulfill}
          />
        </TableCell>

        {/* Action */}
        <TableCell className="w-[80px]">
          <OrderActionMenu
            orderId={order.id}
            items={order.items}
            canViewFulfillment={canViewFulfillment}
            canFulfill={canFulfill}
            canCancel={canCancelFulfillment}
            onUploadDesign={onUploadDesign}
          />
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={ORDER_COLUMN_COUNT} className="p-0">
            <OrderExpand orderId={order.id} canViewFulfillment={canViewFulfillment} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
