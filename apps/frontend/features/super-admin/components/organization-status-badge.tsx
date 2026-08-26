'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { OrganizationStatus } from '../types';

/**
 * Badge trạng thái Organization (§15).
 *
 * Ba màu, ba ý nghĩa: **vàng** = còn phải làm gì đó (chờ duyệt), **xanh** = xong,
 * **đỏ** = bị từ chối. `SUSPENDED` / `DELETED` để xám vì chúng không thuộc luồng duyệt —
 * tô đỏ sẽ khiến chúng trông như hồ sơ vừa bị Super Admin từ chối.
 */
const VARIANTS: Record<OrganizationStatus, 'success' | 'destructive' | 'warning' | 'muted'> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  TRIAL: 'success',
  REJECTED: 'destructive',
  SUSPENDED: 'muted',
  DELETED: 'muted',
};

export function OrganizationStatusBadge({ status }: { status: OrganizationStatus }) {
  const { t } = useTranslation('superAdmin');
  return <Badge variant={VARIANTS[status] ?? 'muted'}>{t(`status.${status}`)}</Badge>;
}
