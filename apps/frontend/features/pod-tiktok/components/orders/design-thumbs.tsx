'use client';

import { DesignThumb } from '@/features/fulfillment/components/design-thumb';
import type { PodDesign } from '../../order-types';

interface DesignThumbsProps {
  front: PodDesign | null;
  back: PodDesign | null;
  /** Mở lightbox toàn màn hình khi bấm — hover chỉ phóng vừa phải. */
  onPreview: (src: string) => void;
}

/**
 * Ảnh thu nhỏ Front/Back hiện NGAY trên dòng đơn.
 *
 * Design được ĐỌC từ Product Mapping (khoá: Product ID + Seller SKU) — đơn hàng không sở hữu
 * file nào. Nghĩa là hai đơn cùng sản phẩm luôn hiện cùng một ảnh, và ảnh đổi ngay sau khi ai
 * đó thay design ở màn hình Product Mapping.
 *
 * Ô ảnh dùng chung với bảng Product Mapping (`DesignThumb`); ở đây chỉ thêm phần bố cục và
 * hành vi riêng của dòng đơn: bấm để mở lightbox.
 */
export function DesignThumbs({ front, back, onPreview }: DesignThumbsProps) {
  if (!front && !back) return null;

  return (
    <div className="flex gap-1">
      {front && (
        <DesignThumb design={front} placement="FRONT" onClick={() => onPreview(front.fileUrl)} />
      )}
      {back && (
        <DesignThumb design={back} placement="BACK" onClick={() => onPreview(back.fileUrl)} />
      )}
    </div>
  );
}
