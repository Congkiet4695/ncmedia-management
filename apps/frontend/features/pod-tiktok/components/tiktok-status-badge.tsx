'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { PodTiktokStatus } from '../types';

const VARIANT: Record<PodTiktokStatus, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> =
  {
    PENDING: 'muted',
    ACTIVE: 'success',
    REAUTH_REQUIRED: 'warning',
    DEAUTHORIZED: 'destructive',
    DISCONNECTED: 'muted',
    ERROR: 'destructive',
  };

export function TiktokStatusBadge({ status }: { status: PodTiktokStatus }) {
  const { t } = useTranslation('pod');
  return <Badge variant={VARIANT[status]}>{t(`account.status.${status}`)}</Badge>;
}
