'use client';

import { memo, useMemo } from 'react';
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
import type { LightboxRequest } from '../../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../../order-types';
import type { FulfillmentState } from '@/features/fulfillment/types';

/** Số cột của bảng — dùng cho `colSpan` của dòng mở rộng. */
export const ORDER_COLUMN_COUNT = 9;

/**
 * Độ rộng cột — MỘT nguồn cho cả `<th>` và `<td>`, dùng với `table-fixed`.
 *
 * Bảng phải vừa khung mà không cuộn ngang: các cột dữ liệu có độ rộng cố định, chỉ Products co giãn theo phần còn lại, nên
 * tên sản phẩm dài không thể đẩy Fulfillment và Action ra ngoài. Khung hẹp hơn `ORDER_TABLE_MIN_WIDTH` thì dùng dạng card.
 */
export const ORDER_COLUMNS = {
  select: 'w-8 px-2',
  expand: 'w-7 px-0',
  info: 'w-[140px] px-2',
  products: 'px-2',
  price: 'w-[172px] px-2',
  status: 'w-[88px] px-2',
  tracking: 'w-[108px] px-2',
  fulfillment: 'w-[128px] px-2',
  action: 'w-[72px] px-1',
} as const;

/**
 * Độ rộng KHUNG tối thiểu để dùng bảng: tổng các cột cố định (768px) + cột Products đủ đọc. Màn 1366px với sidebar mở có khung
 * khoảng 955px, phải dùng được bảng. Đo khung chứ không đo viewport,
 * vì cùng một màn hình, sidebar mở hay thu gọn chênh nhau 180px.
 */
export const ORDER_TABLE_MIN_WIDTH = 920;

interface PodOrderRowProps {
  order: PodOrderListItem;
  accountId?: string;
  selected: boolean;
  expanded: boolean;
  canViewFulfillment: boolean;
  canFulfill: boolean;
  canCancelFulfillment: boolean;
  /** Trạng thái fulfillment của đơn, bảng tải theo lô cho cả trang. */
  fulfillmentState: FulfillmentState | undefined;
  fulfillmentLoading: boolean;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onUploadDesign: (item: PodOrderItem) => void;
  /** Mở dialog khai Product Mapping cho một dòng sản phẩm chưa ánh xạ. */
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
 * Bọc `memo`: tick hoặc mở một dòng chỉ render lại dòng đó. Props đều ổn định: callback từ `useCallback`, `order` và
 * `fulfillmentState` giữ nguyên object khi dữ liệu không đổi nhờ structural sharing của react-query.
 *
 * 🔴 Click vào dòng để mở rộng, nhưng mọi phần tử tương tác bên trong (checkbox, nút Copy,
 * link, Upload Design, Fulfill) đều `stopPropagation`: bấm Copy mà dòng bật mở ra là một
 * kiểu "đúng theo code, sai theo ý người dùng".
 */
export const PodOrderRow = memo(function PodOrderRow({
  order,
  accountId,
  selected,
  expanded,
  canViewFulfillment,
  canFulfill,
  canCancelFulfillment,
  fulfillmentState,
  fulfillmentLoading,
  onToggleSelect,
  onToggleExpand,
  onUploadDesign,
  onPreviewImages,
}: PodOrderRowProps) {
  const { t } = useTranslation('pod');
  const price = useMemo(() => buildPriceBreakdown(order), [order]);
  const tracking = useMemo(() => collectTrackingNumbers(order), [order]);

  return (
    <>
      <TableRow
        onClick={() => onToggleExpand(order.id)}
        className={cn(
          'cursor-pointer [&>td]:align-top',
          selected && 'bg-primary/5',
          expanded && 'border-b-0',
        )}
      >
        <TableCell className={ORDER_COLUMNS.select}>
          <Checkbox
            checked={selected}
            aria-label={t('orders.bulk.selectRow')}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleSelect(order.id)}
          />
        </TableCell>

        <TableCell className={ORDER_COLUMNS.expand}>
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
        <TableCell className={ORDER_COLUMNS.info}>
          <OrderInfoCell order={order} accountId={accountId} />
        </TableCell>

        {/* 2. Products — cột co giãn */}
        <TableCell className={ORDER_COLUMNS.products}>
          <OrderProductsCell
            items={order.items}
            onUploadDesign={onUploadDesign}
            onPreviewImages={onPreviewImages}
          />
        </TableCell>

        {/* 3. Price */}
        <TableCell className={ORDER_COLUMNS.price}>
          <OrderPriceCell price={price} />
        </TableCell>

        {/* 4. Order Status — badge dòng riêng, chữ dài xuống dòng TRONG cột. */}
        <TableCell className={ORDER_COLUMNS.status}>
          {/* Cột hẹp: chữ xuống dòng trong badge, không tràn sang cột Tracking. */}
          <PodOrderStatusBadge status={order.status} className="whitespace-normal rounded-md px-1.5 text-[11px] leading-tight" />
        </TableCell>

        {/* 5. Tracking Number */}
        <TableCell className={ORDER_COLUMNS.tracking}>
          <TrackingCell numbers={tracking} />
        </TableCell>

        {/* 6. Fulfillment Info */}
        <TableCell className={ORDER_COLUMNS.fulfillment}>
          <FulfillmentCell
            podOrderId={order.id}
            enabled={canViewFulfillment}
            canFulfill={canFulfill}
            state={fulfillmentState}
            stateLoading={fulfillmentLoading}
            items={order.items}
          />
        </TableCell>

        {/* Action */}
        <TableCell className={ORDER_COLUMNS.action}>
          <OrderActionMenu
            orderId={order.id}
            items={order.items}
            state={fulfillmentState}
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
});
