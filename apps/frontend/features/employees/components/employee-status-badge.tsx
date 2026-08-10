import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import type { EmployeeStatus } from '../types';

const VARIANT: Record<EmployeeStatus, 'success' | 'muted' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  INACTIVE: 'muted',
  RESIGNED: 'warning',
  SUSPENDED: 'destructive',
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const { t } = useTranslation('employee');
  return <Badge variant={VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}
