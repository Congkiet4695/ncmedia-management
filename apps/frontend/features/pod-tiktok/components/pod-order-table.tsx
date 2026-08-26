'use client';

import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PodOrderCard } from './orders/pod-order-card';
import { PodOrderRow } from './orders/pod-order-row';
import type { LightboxRequest, OrderProductRow } from '../order-view-model';
import type { PodOrderItem, PodOrderListItem } from '../order-types';

interface PodOrderTableProps {
  orders: PodOrderListItem[];
  loading?: boolean;
  /** Map `shopName` → id kết nối TikTok, để tên shop bấm được (§1). */
  accountIdByShopName: Map<string, string>;
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
  onMapProduct: (row: OrderProductRow) => void;
  /** Mở bộ xem ảnh — dùng CHUNG cho ảnh sản phẩm và ảnh design. */
  onPreviewImages: (request: LightboxRequest) => void;
}

/** Số dòng skeleton khi tải — xấp xỉ một trang để bố cục không nhảy khi dữ liệu về. */
const SKELETON_ROWS = 6;

/**
 * Danh sách đơn POD.
 *
 * ```
 *   ≥ lg   →  bảng đủ 6 cột nghiệp vụ + chọn + mở rộng + hành động
 *   md     →  bảng rút gọn (ẩn Price và Tracking — thông tin tra cứu, không phải thao tác)
 *   < md   →  card
 * ```
 *
 * 🔴 Hai bố cục dựng từ CÙNG một bộ cell (xem `pod-order-card.tsx`), nên không có nguy cơ
 * desktop và mobile hiển thị khác nhau.
 *
 * 🔴 Không có dòng nào render sẵn phần chi tiết: `OrderExpand` chỉ tồn tại khi người dùng mở
 * dòng đó. Đây là lý do một trang 50 đơn vẫn nhẹ.
 */
export function PodOrderTable({
  orders,
  loading,
  accountIdByShopName,
  selectedIds,
  expandedIds,
  canViewFulfillment,
  canFulfill,
  canCancelFulfillment,
  onToggleSelect,
  onToggleSelectAll,
  onToggleExpand,
  onUploadDesign,
  onMapProduct,
  onPreviewImages,
}: PodOrderTableProps) {
  const { t } = useTranslation('pod');

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

  const accountIdOf = (order: PodOrderListItem): string | undefined =>
    order.shopName ? accountIdByShopName.get(order.shopName) : undefined;

  return (
    <>
      {/* ---------------------------------------------------------------- Desktop / Tablet */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-9 pr-0">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  aria-label={t('orders.bulk.selectAll')}
                  onChange={onToggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-8 px-1" />
              <TableHead>{t('orders.columns.info')}</TableHead>
              <TableHead>{t('orders.columns.products')}</TableHead>
              {/* Tablet ẩn hai cột tra cứu để cột Products còn đủ chỗ thở (§Responsive). */}
              <TableHead className="hidden lg:table-cell">{t('orders.columns.price')}</TableHead>
              <TableHead>{t('orders.columns.status')}</TableHead>
              <TableHead className="hidden lg:table-cell">
                {t('orders.columns.tracking')}
              </TableHead>
              <TableHead>{t('orders.columns.fulfillment')}</TableHead>
              <TableHead className="text-right">{t('orders.columns.action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <PodOrderRow
                key={order.id}
                order={order}
                accountId={accountIdOf(order)}
                selected={selectedIds.has(order.id)}
                expanded={expandedIds.has(order.id)}
                canViewFulfillment={canViewFulfillment}
                canFulfill={canFulfill}
                canCancelFulfillment={canCancelFulfillment}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
                onUploadDesign={onUploadDesign}
                onMapProduct={onMapProduct}
                onPreviewImages={onPreviewImages}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---------------------------------------------------------------- Mobile */}
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <PodOrderCard
            key={order.id}
            order={order}
            accountId={accountIdOf(order)}
            selected={selectedIds.has(order.id)}
            expanded={expandedIds.has(order.id)}
            canViewFulfillment={canViewFulfillment}
            canFulfill={canFulfill}
            canCancelFulfillment={canCancelFulfillment}
            onToggleSelect={onToggleSelect}
            onToggleExpand={onToggleExpand}
            onUploadDesign={onUploadDesign}
            onMapProduct={onMapProduct}
            onPreviewImages={onPreviewImages}
          />
        ))}
      </div>
    </>
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

