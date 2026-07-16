'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, orderStatusSchema, type OrderStatusInput } from '../schemas/order.schema';
import type { OrderStatus } from '../types';

interface OrderStatusDialogProps {
  open: boolean;
  current: OrderStatus;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: OrderStatusInput) => void;
}

export function OrderStatusDialog({
  open,
  current,
  submitting,
  onClose,
  onSubmit,
}: OrderStatusDialogProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrderStatusInput>({
    resolver: zodResolver(orderStatusSchema),
    values: { status: current, note: '' },
  });

  return (
    <Modal open={open} onClose={onClose} title="Đổi trạng thái đơn" description="Lưu vào timeline trạng thái.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="status-select">Trạng thái mới</Label>
          <NativeSelect id="status-select" disabled={submitting} {...register('status')}>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          {errors.status && <p className="text-sm text-destructive">{errors.status.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status-note">Ghi chú (tuỳ chọn)</Label>
          <Input id="status-note" disabled={submitting} {...register('note')} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Hủy
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Cập nhật
          </Button>
        </div>
      </form>
    </Modal>
  );
}
