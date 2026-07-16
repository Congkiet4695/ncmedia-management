import { Badge } from '@/components/ui/badge';
import { ORDER_STATUS_LABELS } from '../schemas/order.schema';
import type { OrderStatus } from '../types';

const VARIANT: Record<OrderStatus, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  WAITING: 'muted',
  URGENT: 'destructive',
  TRACK_AVAILABLE: 'success',
  PED: 'default',
  REDO: 'warning',
  TRACK_PENDING: 'warning',
  TAX: 'warning',
  TRACK_IMPORTED: 'success',
  REFUND: 'warning',
  CANCELLED: 'destructive',
  IN_PROGRESS: 'default',
  HAS_TRACKING: 'success',
  SHIPPED: 'success',
  COMPLETED: 'success',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}
