'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useFulfillmentStates } from '@/features/fulfillment/hooks/use-fulfillment';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PodOrderCard } from './orders/pod-order-card';
import { ORDER_COLUMNS, ORDER_TABLE_MIN_WIDTH, PodOrderRow } from './orders/pod-order-row';
import type { LightboxRequest } from '../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../order-types';

interface PodOrderTableProps {
  orders: PodOrderListItem[];
  loading?: boolean;
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  canViewFulfillment: boolean;
  canFulfill: boolean;
  canCancelFulfillment: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleExpand: (id: string) => void;
  onUploadDesign: (item: PodOrderItem) => void;
  /** Mở dialog khai Product Mapping cho một dòng sản phẩm chưa ánh xạ. */
  /** Mở bộ xem ảnh — dùng CHUNG cho ảnh sản phẩm và ảnh design. */
  onPreviewImages: (request: LightboxRequest) => void;
}

/** Số dòng skeleton khi tải — xấp xỉ một trang để bố cục không nhảy khi dữ liệu về. */
const SKELETON_ROWS = 6;

/**
 * Danh sách đơn POD.
 *
 * ```
 *   khung ≥ ORDER_TABLE_MIN_WIDTH  →  bảng đủ cột, vừa khung, không cuộn ngang
 *   khung hẹp hơn                  →  card
 * ```
 *
 * 🔴 Trạng thái fulfillment tải theo lô MỘT request cho cả trang, truyền xuống từng dòng. Mỗi dòng tự gọi API là N request
 * và N lần lặp cùng các truy vấn ở backend.
 *
 * 🔴 Hai bố cục dựng từ CÙNG một bộ cell (xem `pod-order-card.tsx`), nên không có nguy cơ
 * desktop và mobile hiển thị khác nhau.
 *
 * 🔴 Chỉ RENDER bố cục đang hiển thị, không render cả hai rồi ẩn bằng CSS.
 * Render cả hai là mỗi đơn dựng hai lần mọi cell (ảnh, tooltip, menu, hook fulfillment) và hai
 * lần `OrderExpand` khi mở rộng — gấp đôi DOM và công render cho phần không ai nhìn thấy.
 *
 * 🔴 Không có dòng nào render sẵn phần chi tiết: `OrderExpand` chỉ tồn tại khi người dùng mở
 * dòng đó. Đây là lý do một trang 50 đơn vẫn nhẹ.
 */
export function PodOrderTable(props: PodOrderTableProps) {
  const [wide, containerRef] = useContainerAtLeast(ORDER_TABLE_MIN_WIDTH);
  return (
    <div ref={containerRef}>
      <PodOrderList {...props} wide={wide} />
    </div>
  );
}

/**
 * Khung có rộng ít nhất `minWidth` không. Chỉ đổi state khi vượt ngưỡng, nên kéo cửa sổ hay thu sidebar không render lại danh
 * sách. Trước khi đo được thì coi là đủ rộng (bố cục phổ biến nhất).
 */
function useContainerAtLeast(minWidth: number): [boolean, (node: HTMLDivElement | null) => void] {
  const [wide, setWide] = useState(true);
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!node) return;
      setWide(node.clientWidth >= minWidth);
      observer.current = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= minWidth));
      observer.current.observe(node);
    },
    [minWidth],
  );
  return [wide, attach];
}

function PodOrderList({
  wide,
  orders,
  loading,
  selectedIds,
  expandedIds,
  canViewFulfillment,
  canFulfill,
  canCancelFulfillment,
  onToggleSelect,
  onToggleSelectAll,
  onToggleExpand,
  onUploadDesign,
  onPreviewImages,
}: PodOrderTableProps & { wide: boolean }) {
  const { t } = useTranslation('pod');
  const orderIds = useMemo(() => orders.map((order) => order.id), [orders]);
  const fulfillment = useFulfillmentStates(orderIds, canViewFulfillment);

  if (loading) return <TableSkeleton />;

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Package className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('orders.emptyHint')}</p>
      </div>
    );
  }

  const allSelected = orders.every((order) => selectedIds.has(order.id));
  const someSelected = !allSelected && orders.some((order) => selectedIds.has(order.id));

  if (wide) {
    return (
      // ---------------------------------------------------------------- Desktop / Tablet
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={ORDER_COLUMNS.select}>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                aria-label={t('orders.bulk.selectAll')}
                onChange={onToggleSelectAll}
              />
            </TableHead>
            <TableHead className={ORDER_COLUMNS.expand} />
            <TableHead className={ORDER_COLUMNS.info}>{t('orders.columns.info')}</TableHead>
            <TableHead className={ORDER_COLUMNS.products}>
              {t('orders.columns.products')}
            </TableHead>
            <TableHead className={ORDER_COLUMNS.price}>{t('orders.columns.price')}</TableHead>
            <TableHead className={ORDER_COLUMNS.status}>
              {t('orders.columns.status')}
            </TableHead>
            <TableHead className={ORDER_COLUMNS.tracking}>
              {t('orders.columns.tracking')}
            </TableHead>
            <TableHead className={ORDER_COLUMNS.fulfillment}>
              {t('orders.columns.fulfillment')}
            </TableHead>
            <TableHead className={cn(ORDER_COLUMNS.action, 'text-right')}>
              {t('orders.columns.action')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <PodOrderRow
              key={order.id}
              order={order}
              accountId={order.accountId}
              selected={selectedIds.has(order.id)}
              expanded={expandedIds.has(order.id)}
              canViewFulfillment={canViewFulfillment}
              canFulfill={canFulfill}
              canCancelFulfillment={canCancelFulfillment}
              fulfillmentState={fulfillment.data?.[order.id]}
              fulfillmentLoading={fulfillment.isLoading}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
              onUploadDesign={onUploadDesign}
              onPreviewImages={onPreviewImages}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    // ---------------------------------------------------------------- Mobile
    <div className="space-y-3">
      {orders.map((order) => (
        <PodOrderCard
          key={order.id}
          order={order}
          accountId={order.accountId}
          selected={selectedIds.has(order.id)}
          expanded={expandedIds.has(order.id)}
          canViewFulfillment={canViewFulfillment}
          canFulfill={canFulfill}
          canCancelFulfillment={canCancelFulfillment}
          fulfillmentState={fulfillment.data?.[order.id]}
          fulfillmentLoading={fulfillment.isLoading}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
          onUploadDesign={onUploadDesign}
          onPreviewImages={onPreviewImages}
        />
      ))}
    </div>
  );
}

/** Khung xương giữ đúng bố cục bảng trong lúc tải — không để trang nhảy khi dữ liệu về. */
function TableSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="flex gap-3 border-b py-3">
          <Skeleton className="size-4 shrink-0" />
          <div className="w-[180px] shrink-0 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-1 gap-2">
            <Skeleton className="size-[60px] shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="hidden h-14 w-[120px] shrink-0 lg:block" />
          <Skeleton className="h-6 w-[110px] shrink-0" />
          <Skeleton className="hidden h-10 w-[130px] shrink-0 lg:block" />
          <Skeleton className="h-14 w-[150px] shrink-0" />
        </div>
      ))}
    </div>
  );
}
