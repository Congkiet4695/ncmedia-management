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
import type { LightboxRequest } from '../../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../../order-types';

/** Số cột của bảng — dùng cho `colSpan` của dòng mở rộng. */
export const ORDER_COLUMN_COUNT = 9;

/**
 * Kích thước cột — MỘT nguồn cho cả `<th>` (`PodOrderTable`) lẫn `<td>` (dòng đơn).
 *
 * `cell`: class của `<th>`/`<td>` (độ rộng gợi ý + ẩn theo breakpoint).
 * `content`: `min-width` của khối nội dung BÊN TRONG ô — đây mới là thứ giữ cột không co.
 *
 * 🔴 Vì sao `min-width` đặt ở khối bên trong chứ không đặt trên `<td>`: bảng dùng layout `auto`, độ rộng cột
 * = min-content của nội dung, còn `min-width` trên ô bảng không được trình duyệt áp dụng nhất quán. Đặt ở khối
 * con thì min-content của ô = đúng số này ⇒ cột không bao giờ hẹp hơn nội dung cần, nội dung không tràn sang
 * cột bên cạnh. Tổng các `content` lớn hơn vùng hiển thị ⇒ bảng cuộn NGANG trong khung `Table`
 * (`overflow-x-auto`), không ép cột xuống.
 */
export const ORDER_COLUMNS = {
  info: { cell: 'w-[200px]', content: 'min-w-[180px]' },
  products: { cell: '', content: 'min-w-[300px]' },
  // Giá: 10 dòng nhãn + số tiền; nhãn dài nhất ("Phí ship Seller (đã trừ)") + "−1,234.56 US$" vẫn vừa 1 dòng.
  price: { cell: 'w-[250px]', content: 'min-w-[230px]' },
  status: { cell: 'w-[140px]', content: 'min-w-[120px]' },
  tracking: { cell: 'w-[160px]', content: 'min-w-[140px]' },
  fulfillment: { cell: 'w-[170px]', content: 'min-w-[150px]' },
  action: { cell: 'w-[80px]', content: '' },
} as const;

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
  onPreviewImages,
}: PodOrderRowProps) {
  const { t } = useTranslation('pod');
  const price = buildPriceBreakdown(order);
  const tracking = collectTrackingNumbers(order);

  return (
    <>
      <TableRow
        onClick={() => onToggleExpand(order.id)}
        className={cn(
          'cursor-pointer align-top',
          selected && 'bg-primary/5',
          expanded && 'border-b-0',
        )}
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
        <TableCell className={ORDER_COLUMNS.info.cell}>
          <div className={ORDER_COLUMNS.info.content}>
            <OrderInfoCell order={order} accountId={accountId} />
          </div>
        </TableCell>

        {/* 2. Products — cột lớn nhất */}
        <TableCell className={ORDER_COLUMNS.products.cell}>
          <div className={ORDER_COLUMNS.products.content}>
            <OrderProductsCell
              items={order.items}
              onUploadDesign={onUploadDesign}
              onPreviewImages={onPreviewImages}
            />
          </div>
        </TableCell>

        {/* 3. Price — luôn hiện (bảng cuộn ngang khi thiếu chỗ, không giấu dữ liệu giá). */}
        <TableCell className={ORDER_COLUMNS.price.cell}>
          <div className={ORDER_COLUMNS.price.content}>
            <OrderPriceCell price={price} />
          </div>
        </TableCell>

        {/* 4. Order Status — cột độc lập: badge dòng riêng, chữ dài xuống dòng TRONG cột. */}
        <TableCell className={ORDER_COLUMNS.status.cell}>
          <div className={ORDER_COLUMNS.status.content}>
            <PodOrderStatusBadge status={order.status} />
          </div>
        </TableCell>

        {/* 5. Tracking Number */}
        <TableCell className={ORDER_COLUMNS.tracking.cell}>
          <div className={ORDER_COLUMNS.tracking.content}>
            <TrackingCell numbers={tracking} />
          </div>
        </TableCell>

        {/* 6. Fulfillment Info */}
        <TableCell className={ORDER_COLUMNS.fulfillment.cell}>
          <div className={ORDER_COLUMNS.fulfillment.content}>
            <FulfillmentCell
              podOrderId={order.id}
              enabled={canViewFulfillment}
              canFulfill={canFulfill}
            />
          </div>
        </TableCell>

        {/* Action */}
        <TableCell className={ORDER_COLUMNS.action.cell}>
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
