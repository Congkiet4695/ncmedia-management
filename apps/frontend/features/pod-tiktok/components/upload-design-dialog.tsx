'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DesignSlot } from '@/features/fulfillment/components/design-slot';
import { MAX_UPLOAD_MB } from '@/lib/file-size';
import { ImageLightbox } from './image-lightbox';
import { POD_ACTIVE_PLACEMENTS, type PodOrderItem } from '../order-types';

interface UploadDesignDialogProps {
  open: boolean;
  item: PodOrderItem | null;
  onClose: () => void;
}

/**
 * Dialog design mở từ MỘT dòng hàng của đơn.
 *
 * ```
 *   [Product ID + Seller SKU — khoá của sản phẩm]
 *   ┌── Front ─────────┐ ┌── Back ──────────┐
 *   │ preview          │ │ preview          │
 *   │ URL (readonly)   │ │ URL (readonly)   │
 *   │ [Thay] [Xoá]     │ │ [Chọn file]      │
 *   └──────────────────┘ └──────────────────┘
 * ```
 *
 * 🔴 **KHÔNG đòi hỏi sản phẩm đã có Product Mapping.** Design lưu theo (Product ID + Seller
 * SKU); ánh xạ chỉ cần khi Fulfill. Bản trước chặn hẳn dialog khi `mappingId === null` và bắt
 * người dùng đi khai ánh xạ trước — một ràng buộc không có thật, và nó đảo ngược thứ tự làm
 * việc tự nhiên (thường có file in trước, biết gửi xưởng nào sau).
 *
 * 🔴 Đích đến là SẢN PHẨM, không phải dòng hàng này. File lưu xong phục vụ MỌI đơn cùng
 * (Product ID + Seller SKU), kể cả đơn ngày mai mới đồng bộ về. Câu cảnh báo ngay dưới nói
 * thẳng điều đó — bấm "Xoá" ở đây là xoá cho mọi đơn, người dùng phải biết trước chứ không
 * phải phát hiện sau.
 */
export function UploadDesignDialog({ open, item, onClose }: UploadDesignDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('design.dialogTitle')}
        description={`${t('design.dialogDescription')} ${t('design.maxSizeLabel', {
          size: MAX_UPLOAD_MB,
        })}`}
        className="max-w-3xl"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              {t('common:action.close')}
            </Button>
          </div>
        }
      >
        {item && <DialogBody item={item} onPreview={setLightbox} />}
      </Modal>

      <ImageLightbox open={Boolean(lightbox)} src={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}

function DialogBody({
  item,
  onPreview,
}: {
  item: PodOrderItem;
  onPreview: (src: string) => void;
}) {
  const { t } = useTranslation(['pod', 'common']);

  /**
   * Cặp khoá của sản phẩm — địa chỉ lưu design.
   *
   * Thiếu một trong hai thì không xác định được lưu cho sản phẩm nào. Trường hợp này gần như
   * không xảy ra (TikTok luôn trả cả hai), nhưng nếu có thì phải nói rõ là thiếu KHOÁ, không
   * phải thiếu ánh xạ — hai vấn đề khác nhau, và cái này không sửa được từ giao diện.
   */
  const productKey =
    item.productId && item.sellerSku
      ? { tiktokProductId: item.productId, sellerSku: item.sellerSku }
      : null;

  return (
    <div className="space-y-5">
      {/* Khoá nghiệp vụ của sản phẩm — chính là thứ quyết định design này áp cho những đơn nào. */}
      <div className="grid gap-x-6 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2">
        <InfoLine label={t('design.productName')} value={item.productName} />
        <InfoLine label={t('product.productId')} value={item.productId} mono />
        <InfoLine label={t('product.sellerSku')} value={item.sellerSku} mono />
        <InfoLine label={t('product.variant')} value={item.skuName} />
      </div>

      {productKey === null ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
          <KeyRound className="size-8 text-destructive" />
          <p className="text-sm font-medium">{t('design.noKeyTitle')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('design.noKeyHint')}</p>
        </div>
      ) : (
        <>
          <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
            {t('design.sharedScopeHint')}
          </p>

          {/* Mỗi vị trí in một khối độc lập */}
          <div className="grid gap-4 sm:grid-cols-2">
            {POD_ACTIVE_PLACEMENTS.map((placement) => (
              <DesignSlot
                key={placement}
                productKey={productKey}
                placement={placement}
                design={item.designs.find((design) => design.placement === placement) ?? null}
                onPreview={onPreview}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InfoLine({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className={mono ? 'break-all font-mono text-xs' : 'break-words font-medium'}>
        {value ?? '—'}
      </span>
    </div>
  );
}
