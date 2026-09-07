'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CurrencyInput, PercentInput, QuantityInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { parseAmount, parseQuantityLimit } from '../price-math';
import type { UpdateFlashSaleItemPayload } from '../types';

interface FlashSaleBatchDialogProps {
  open: boolean;
  onClose: () => void;
  /** Số dòng đang được chọn — hiển thị trong tiêu đề để không ai áp nhầm cho 200 dòng. */
  count: number;
  currency: string | null;
  submitting?: boolean;
  onSubmit: (payload: UpdateFlashSaleItemPayload) => void;
}

/**
 * **Batch Action** — áp một thay đổi cho mọi dòng đang được chọn.
 *
 * 🔴 Hai ô giá **loại trừ nhau**, và khác nhau về bản chất:
 *
 * ```
 *   Deal Price  20.99  ⇒ MỌI dòng về đúng 20.99
 *   Discount %  30     ⇒ MỖI dòng giảm 30% trên giá gốc RIÊNG của nó
 * ```
 *
 * Với một danh sách sản phẩm nhiều mức giá, hai thao tác này cho hai kết quả hoàn toàn khác
 * nhau. Cho nhập cả hai cùng lúc là mời người dùng đoán xem cái nào thắng — nên ô này khoá
 * ô kia ngay khi có giá trị.
 *
 * Ô để trống = **không đổi**. Đây là điểm khác biệt với form thường: ở đây "trống" không
 * phải "xoá đi", vì mỗi dòng đang có giá trị riêng của nó.
 */
export function FlashSaleBatchDialog({
  open,
  onClose,
  count,
  currency,
  submitting,
  onSubmit,
}: FlashSaleBatchDialogProps) {
  const { t } = useTranslation(['pod', 'common']);

  const [dealPrice, setDealPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [totalLimit, setTotalLimit] = useState('');
  const [customerLimit, setCustomerLimit] = useState('');

  // Mỗi lần mở là một thao tác mới — giữ lại giá trị cũ sẽ khiến người dùng áp nhầm con số
  // của lần trước cho một tập dòng khác hẳn.
  useEffect(() => {
    if (!open) return;
    setDealPrice('');
    setDiscount('');
    setTotalLimit('');
    setCustomerLimit('');
  }, [open]);

  const hasPrice = dealPrice.trim() !== '';
  const hasDiscount = discount.trim() !== '';
  const hasAnyChange =
    hasPrice || hasDiscount || totalLimit.trim() !== '' || customerLimit.trim() !== '';

  const submit = (): void => {
    const payload: UpdateFlashSaleItemPayload = {};
    if (hasPrice) payload.flashSalePrice = parseAmount(dealPrice) ?? undefined;
    else if (hasDiscount) payload.discountPercent = parseAmount(discount) ?? undefined;
    if (totalLimit.trim() !== '') payload.totalPurchaseLimit = parseQuantityLimit(totalLimit);
    if (customerLimit.trim() !== '')
      payload.customerPurchaseLimit = parseQuantityLimit(customerLimit);
    onSubmit(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('flashSale.batch.title', { count })}
      description={t('flashSale.batch.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={submit} disabled={!hasAnyChange || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('flashSale.batch.apply', { count })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="batch-deal-price">{t('flashSale.batch.dealPrice')}</Label>
            <CurrencyInput
              id="batch-deal-price"
              currency={currency}
              value={dealPrice}
              onChange={(event) => setDealPrice(event.target.value)}
              disabled={hasDiscount || submitting}
              placeholder={t('flashSale.batch.unchanged')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="batch-discount">{t('flashSale.batch.discount')}</Label>
            <PercentInput
              id="batch-discount"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              disabled={hasPrice || submitting}
              placeholder={t('flashSale.batch.unchanged')}
            />
          </div>
        </div>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('flashSale.batch.priceHint')}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="batch-total-limit">{t('flashSale.batch.totalLimit')}</Label>
            <QuantityInput
              id="batch-total-limit"
              min={-1}
              max={99}
              value={totalLimit}
              onChange={(event) => setTotalLimit(event.target.value)}
              disabled={submitting}
              placeholder={t('flashSale.batch.unchanged')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="batch-customer-limit">{t('flashSale.batch.customerLimit')}</Label>
            <QuantityInput
              id="batch-customer-limit"
              min={-1}
              max={99}
              value={customerLimit}
              onChange={(event) => setCustomerLimit(event.target.value)}
              disabled={submitting}
              placeholder={t('flashSale.batch.unchanged')}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t('flashSale.batch.limitHint')}</p>
      </div>
    </Modal>
  );
}
