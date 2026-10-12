'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { EmployeeWorkShopStatus } from '../types';

const VARIANT: Record<EmployeeWorkShopStatus, 'success' | 'destructive' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'destructive',
  DEAUTHORIZED: 'warning',
};

/**
 * Trạng thái SHOP theo cùng nhãn với Dashboard (Live = ACTIVE, Die = INACTIVE, Mất uỷ quyền = DEAUTHORIZED).
 * Giá trị lạ / thiếu ⇒ "N/A" — không tự suy ra trạng thái.
 */
export function ShopLiveBadge({ status }: { status: EmployeeWorkShopStatus | null | undefined }) {
  const { t } = useTranslation('report');
  if (!status || !(status in VARIANT)) {
    return <Badge variant="muted">{t('employeeWork.shopStatus.unknown')}</Badge>;
  }
  return <Badge variant={VARIANT[status]}>{t(`employeeWork.shopStatus.${status}`)}</Badge>;
}
