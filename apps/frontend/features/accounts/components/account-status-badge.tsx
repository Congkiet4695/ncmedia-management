import { Badge } from '@/components/ui/badge';
import { ACCOUNT_STATUS_LABELS } from '../schemas/account.schema';
import type { AccountStatus } from '../types';

const VARIANT: Record<AccountStatus, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  NEW: 'muted',
  LIVE: 'success',
  DIE_TRANG: 'warning',
  DIE: 'destructive',
  RETURNED: 'default',
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <Badge variant={VARIANT[status]}>{ACCOUNT_STATUS_LABELS[status]}</Badge>;
}
