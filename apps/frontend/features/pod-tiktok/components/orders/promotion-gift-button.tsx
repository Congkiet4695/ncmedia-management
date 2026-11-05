'use client';

import { useState } from 'react';
import { Gift, ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { Tooltip } from '@/components/ui/tooltip';
import { itemThumbnailCandidates } from '../../item-image';
import type { OrderProductRow } from '../../order-view-model';
import { ItemThumbnail } from '../item-thumbnail';

/**
 * Quà tặng khuyến mãi của một đơn: một nút có số lượng, bấm mới mở danh sách. Dữ liệu là các dòng đơn đã có trong danh
 * sách đơn, không gọi thêm API. Dòng bảng bật/mở khi click nên mọi click trong đây đều dừng lan truyền.
 */
export function PromotionGiftButton({ gifts }: { gifts: OrderProductRow[] }) {
  const { t } = useTranslation('pod');
  const [open, setOpen] = useState(false);
  const label = t('product.promotionGiftOpen', { count: gifts.length });

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Tooltip content={t('product.promotionGiftHint')}>
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(true)}
          className="inline-flex h-6 items-center gap-1 rounded-md border bg-info/10 px-2 text-[11px] font-medium text-info hover:bg-info/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Gift className="size-3.5" />
          <span className="tabular-nums">{gifts.length}</span>
        </button>
      </Tooltip>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={t('product.promotionGiftTitle', { count: gifts.length })}>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {gifts.map((gift) => (
              <GiftRow key={gift.key} gift={gift} />
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function GiftRow({ gift }: { gift: OrderProductRow }) {
  const { t } = useTranslation('pod');
  return (
    <li className="flex gap-3 rounded-md border p-2">
      <div className="size-14 shrink-0 overflow-hidden rounded border bg-muted/40">
        <ItemThumbnail
          candidates={itemThumbnailCandidates(gift)}
          alt={gift.productName ?? t('product.fallbackAlt')}
          className="size-full object-cover"
          loading="lazy"
          placeholder={
            <span className="flex size-full items-center justify-center">
              <ImageIcon className="size-5 text-muted-foreground" />
            </span>
          }
        />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-xs">
        <p className="break-words text-sm font-medium">{gift.productName ?? t('product.unknownName')}</p>
        <Field label={t('product.productId')} value={gift.productId} mono />
        <Field label={t('product.sku')} value={gift.sellerSku} mono />
        <Field label={t('product.variant')} value={gift.skuName} />
        <Field label={t('product.qty')} value={String(gift.quantity)} />
        {/* Đã khai Product Mapping thì quà được gửi sản xuất như dòng thường (luật của readiness). */}
        {!gift.mappingId && <p className="pt-0.5 text-[11px] text-warning">{t('product.promotionGiftNotSent')}</p>}
      </div>
    </li>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <p className="text-muted-foreground">
      {label}: <span className={mono ? 'break-all font-mono' : 'break-words'}>{value}</span>
    </p>
  );
}
