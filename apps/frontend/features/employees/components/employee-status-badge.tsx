import { Badge } from '@/components/ui/badge';
import { EMPLOYEE_STATUS_LABELS } from '../schemas/employee.schema';
import type { EmployeeStatus } from '../types';

const VARIANT: Record<EmployeeStatus, 'success' | 'muted' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  INACTIVE: 'muted',
  RESIGNED: 'warning',
  SUSPENDED: 'destructive',
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={VARIANT[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>;
}
