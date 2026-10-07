'use client';

import { useTranslation } from 'react-i18next';
import type { PodOrderFinancials } from '../../order-types';

/**
 * Nhãn / gợi ý dùng chung cho các dòng tài chính của đơn (cột Giá + màn chi tiết).
 *
 * 🔴 Phí ship Seller có HAI trạng thái phải nói rõ — nếu không người đọc sẽ tưởng lợi nhuận bị trừ hai lần
 * hoặc bị quên trừ:
 *  - `includedInProceeds = true`  ⇒ TikTok ĐÃ trừ trong tiền thu về; lợi nhuận KHÔNG trừ lại;
 *  - `includedInProceeds = false` ⇒ tiền thu về CHƯA trừ ("Shipping fee after discounts = $0" nhưng Seller vẫn
 *    tài trợ free ship); lợi nhuận trừ khoản này.
 * `null` ⇒ "—" (chưa xác định) — không bao giờ hiện $0 thay cho "không biết".
 */
export function useFinancialLabels(financials: PodOrderFinancials) {
  const { t } = useTranslation('pod');
  const shipping = financials.sellerShipping;

  const sellerShippingLabel = shipping?.includedInProceeds
    ? t('orders.price.sellerShippingIncluded')
    : t('orders.price.sellerShipping');

  const sellerShippingHint = shipping
    ? `${t(shipping.includedInProceeds ? 'orders.price.sellerShippingHint.included' : 'orders.price.sellerShippingHint.pending')} ${t(`orders.price.sellerShippingSource.${shipping.source}`)}`
    : t('orders.price.sellerShippingHint.unknown');

  const baseCostHint =
    financials.productCost === null
      ? t('orders.price.profitStatus.NO_COST')
      : financials.productCostConfirmed
        ? undefined
        : t('orders.price.profitStatus.COST_PENDING');

  const profitHint =
    financials.status === 'OK' ? undefined : t(`orders.price.profitStatus.${financials.status}`);

  return { sellerShippingLabel, sellerShippingHint, baseCostHint, profitHint };
}
