'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { POD_ACTIVE_PLACEMENTS } from '@/features/pod-tiktok/order-types';
import { MAX_UPLOAD_MB } from '@/lib/file-size';
import { DesignSlot } from './design-slot';
import type { ProductMapping } from '../types';

interface MappingDesignDialogProps {
  open: boolean;
  mapping: ProductMapping | null;
  onClose: () => void;
}

/**
 * Quản trị Design của MỘT sản phẩm, mở từ bảng Product Mapping.
 *
 * 🔴 Đây là chỗ đúng để làm việc với design: design là thuộc tính của sản phẩm, nên nó được
 * khai ở màn hình sản phẩm. Dialog tương ứng trên màn hình Orders chỉ là lối tắt cho lúc
 * người dùng phát hiện thiếu design giữa lúc xử lý đơn — cả hai dùng chung `DesignSlot` nên
 * hành vi không thể lệch.
 */
export function MappingDesignDialog({ open, mapping, onClose }: MappingDesignDialogProps) {
  const { t } = useTranslation(['fulfillment', 'pod', 'common']);
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('mapping.designDialogTitle')}
        description={t('pod:design.maxSizeLabel', { size: MAX_UPLOAD_MB })}
        className="max-w-3xl"
      >
        {mapping && (
          <div className="space-y-5">
            {/* Khoá nghiệp vụ — thứ quyết định design này áp cho những đơn nào. */}
            <div className="grid gap-x-6 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2">
              <InfoLine
                label={t('mapping.tiktokProductId')}
                value={mapping.tiktokProductId}
                mono
              />
              <InfoLine label={t('mapping.sellerSku')} value={mapping.sellerSku} mono />
              <InfoLine label={t('mapping.providerSku')} value={mapping.providerSku} mono />
              <InfoLine label={t('mapping.provider')} value={mapping.providerName} />
            </div>

            <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              {t('mapping.designScopeHint')}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {POD_ACTIVE_PLACEMENTS.map((placement) => (
                <DesignSlot
                  key={placement}
                  productKey={{
                    tiktokProductId: mapping.tiktokProductId ?? '',
                    sellerSku: mapping.sellerSku ?? '',
                  }}
                  placement={placement}
                  design={
                    mapping.designs.find((design) => design.placement === placement) ?? null
                  }
                  onPreview={setLightbox}
                />
              ))}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                {t('common:action.close')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ImageLightbox open={Boolean(lightbox)} src={lightbox} onClose={() => setLightbox(null)} />
    </>
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
