'use client';

import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import type { PodDesign, PodDesignPlacement } from '@/features/pod-tiktok/order-types';

interface DesignThumbProps {
  design: PodDesign;
  placement: PodDesignPlacement;
  /**
   * Bấm vào ảnh làm gì. Bỏ trống ⇒ ảnh chỉ để nhìn (dùng khi phần tử CHA đã là một nút —
   * lồng `<button>` trong `<button>` là HTML không hợp lệ và trình duyệt sẽ tự gỡ).
   */
  onClick?: () => void;
}

/**
 * Ảnh thu nhỏ MỘT design, hover phóng to.
 *
 * 🔴 Hiển thị ẢNH chứ không phải chữ "đã có design": người vận hành cần bắt được lỗi upload
 * nhầm mặt hoặc nhầm file TRƯỚC khi hàng ra xưởng in, và nhìn thấy ảnh là cách duy nhất.
 *
 * 🔴 Phóng to bằng **hover**, không phải popup. Tooltip của dự án render qua portal nên ảnh
 * phóng to không bị `overflow-x-auto` của bảng cắt mất.
 *
 * Dùng chung bởi bảng đơn hàng và bảng Product Mapping — hai bảng cùng hiển thị một thứ, và
 * một khối 30 dòng chép làm hai bản sẽ lệch nhau ngay lần đổi kích thước đầu tiên.
 */
export function DesignThumb({ design, placement, onClick }: DesignThumbProps) {
  const { t } = useTranslation('pod');
  const label = t(`design.placement.${placement}`);

  const image = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={design.fileUrl} alt={label} className="size-full object-cover" loading="lazy" />
      <span className="absolute inset-x-0 bottom-0 bg-foreground/75 text-center text-[8px] font-bold leading-[10px] text-background">
        {label.charAt(0).toUpperCase()}
      </span>
    </>
  );

  const frame = 'relative size-9 shrink-0 overflow-hidden rounded border bg-muted/40';

  return (
    <Tooltip
      side="top"
      className="max-w-none bg-background p-1 text-foreground ring-1 ring-border"
      content={
        <span className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={design.fileUrl}
            alt={label}
            className="max-h-64 max-w-64 rounded object-contain"
          />
          <span className="mt-1 block text-center text-[10px] text-muted-foreground">
            {label} · {t('product.designZoomHint')}
          </span>
        </span>
      }
    >
      {onClick ? (
        <button
          type="button"
          onClick={(event) => {
            // Dòng của bảng đơn hàng cũng bắt sự kiện bấm để mở chi tiết đơn.
            event.stopPropagation();
            onClick();
          }}
          className={`${frame} cursor-zoom-in`}
          aria-label={label}
        >
          {image}
        </button>
      ) : (
        <span className={frame}>{image}</span>
      )}
    </Tooltip>
  );
}
