'use client';

import { ArrowLeft, FilePlus2, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { ListingRunMode } from '../custom-listing-next';

/**
 * Popup sau khi lượt đăng của Add Custom Listing **thành công thật** — ba lựa chọn, không tự điều hướng.
 *
 * Đóng bằng X / Escape / click nền theo hành vi chung của `Modal`: bằng với "Ở lại sản phẩm này".
 * Không nút nào gọi API listing.
 */
export function ListingDoneDialog({
  open,
  mode,
  onBackToList,
  onStay,
  onNewProduct,
}: {
  open: boolean;
  mode: ListingRunMode;
  onBackToList: () => void;
  onStay: () => void;
  onNewProduct: () => void;
}) {
  const { t } = useTranslation('pod');
  const live = mode === 'LIVE';
  return (
    <Modal
      open={open}
      onClose={onStay}
      title={t(live ? 'listing.custom.done.titleLive' : 'listing.custom.done.titleList')}
      description={t(live ? 'listing.custom.done.descriptionLive' : 'listing.custom.done.descriptionList')}
    >
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" className="justify-start" onClick={onBackToList}>
          <ArrowLeft className="size-4" />
          {t('listing.custom.done.backToList')}
        </Button>
        <Button type="button" variant="outline" className="justify-start" onClick={onStay}>
          <PenLine className="size-4" />
          {t('listing.custom.done.stay')}
        </Button>
        <Button type="button" className="justify-start" onClick={onNewProduct}>
          <FilePlus2 className="size-4" />
          {t('listing.custom.done.newProduct')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('listing.custom.done.newProductHint')}</p>
      </div>
    </Modal>
  );
}
