'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { PodTiktokShopStatus } from '../types';

const VARIANT: Record<PodTiktokShopStatus, 'success' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  INACTIVE: 'warning',
  DEAUTHORIZED: 'destructive',
};

/** Trạng thái shop phía TikTok (ghi bởi Sync Shops). */
export function ShopStatusBadge({ status }: { status: PodTiktokShopStatus }) {
  const { t } = useTranslation('pod');
  return <Badge variant={VARIANT[status]}>{t(`account.shopStatus.${status}`)}</Badge>;
}
