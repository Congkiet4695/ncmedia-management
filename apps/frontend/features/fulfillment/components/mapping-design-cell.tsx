'use client';

import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { POD_ACTIVE_PLACEMENTS } from '@/features/pod-tiktok/order-types';
import { DesignThumb } from './design-thumb';
import type { ProductMapping, ProductMappingDesignStatus } from '../types';

interface MappingDesignCellProps {
  mapping: ProductMapping;
  /** Mở dialog quản trị design của sản phẩm này. */
  onManage: () => void;
}

/** Màu badge theo tình trạng — READY xanh, còn lại là cảnh báo có mức độ. */
const STATUS_VARIANT: Record<ProductMappingDesignStatus, 'success' | 'warning' | 'destructive'> = {
  READY: 'success',
  MISSING_FRONT: 'warning',
  MISSING_ALL: 'destructive',
};

/**
 * Ô Design của một dòng trong bảng Product Mapping: ảnh Front/Back + tình trạng.
 *
 * Cả ô là MỘT nút mở dialog quản trị design, nên ảnh bên trong không tự bắt sự kiện bấm
 * (`DesignThumb` không nhận `onClick`) — lồng `<button>` trong `<button>` là HTML không hợp lệ.
 *
 * Tình trạng lấy từ `mapping.designStatus` do backend tính, không tự suy ở đây: đó cũng là
 * luật quyết định nút Fulfill sáng hay mờ, và hai bản sao của một luật sẽ trôi lệch.
 */
export function MappingDesignCell({ mapping, onManage }: MappingDesignCellProps) {
  const { t } = useTranslation(['fulfillment', 'pod']);
  const byPlacement = new Map(mapping.designs.map((design) => [design.placement, design]));

  return (
    <button
      type="button"
      onClick={onManage}
      className="flex items-center gap-2 rounded p-1 text-left hover:bg-accent"
      aria-label={t('mapping.manageDesign')}
    >
      <span className="flex gap-1">
        {POD_ACTIVE_PLACEMENTS.map((placement) => {
          const design = byPlacement.get(placement);
          return design ? (
            <DesignThumb key={placement} design={design} placement={placement} />
          ) : (
            <span
              key={placement}
              title={t(`pod:design.placement.${placement}`)}
              className="flex size-9 shrink-0 items-center justify-center rounded border border-dashed bg-muted/30 text-muted-foreground"
            >
              <ImageOff className="size-4" />
            </span>
          );
        })}
      </span>

      <Badge variant={STATUS_VARIANT[mapping.designStatus]}>
        {t(`mapping.designStatusValue.${mapping.designStatus}`)}
      </Badge>
    </button>
  );
}
