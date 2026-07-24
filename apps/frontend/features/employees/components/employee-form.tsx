'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  employeeFormSchema,
  type EmployeeFormInput,
} from '../schemas/employee.schema';
import type { EmployeeRole } from '../types';

interface EmployeeFormProps {
  mode: 'create' | 'edit';
  roles: EmployeeRole[];
  submitting?: boolean;
  defaultValues?: Partial<EmployeeFormInput>;
  onSubmit: (values: EmployeeFormInput) => void;
}

const BASE_DEFAULTS: EmployeeFormInput = {
  fullName: '',
  email: '',
  status: 'ACTIVE',
  roleId: '',
  larkAccount: '',
  startDate: '',
  resignedAt: '',
  cccd: '',
  cccdImageUrl: '',
  phone: '',
  dateOfBirth: '',
  address: '',
  department: '',
  bankAccount: '',
  bankQrUrl: '',
  salary: 0,
  orderKpi: 0,
  revenueKpi: 0,
  avatar: '',
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export function EmployeeForm({
  mode,
  roles,
  submitting,
  defaultValues,
  onSubmit,
}: EmployeeFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeFormInput>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: { ...BASE_DEFAULTS, ...defaultValues },
  });

  const isEdit = mode === 'edit';

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">
            Tên <span className="text-destructive">*</span>
          </Label>
          <Input id="fullName" disabled={submitting} aria-invalid={!!errors.fullName} {...register('fullName')} />
          <FieldError message={errors.fullName?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="email"
            type="email"
            disabled={submitting || isEdit}
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {isEdit && <p className="text-xs text-muted-foreground">Email không thể đổi.</p>}
          <FieldError message={errors.email?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Trạng thái</Label>
          <NativeSelect id="status" disabled={submitting} {...register('status')}>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EMPLOYEE_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor="roleId">Vai trò</Label>
          <NativeSelect id="roleId" disabled={submitting} {...register('roleId')}>
            <option value="">Mặc định (Employee)</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.roleId?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="larkAccount">Account Lark</Label>
          <Input id="larkAccount" disabled={submitting} {...register('larkAccount')} />
          <FieldError message={errors.larkAccount?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="department">Phòng làm việc</Label>
          <Input id="department" disabled={submitting} {...register('department')} />
          <FieldError message={errors.department?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Số điện thoại</Label>
          <Input id="phone" disabled={submitting} aria-invalid={!!errors.phone} {...register('phone')} />
          <FieldError message={errors.phone?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cccd">CCCD</Label>
          <Input id="cccd" disabled={submitting} aria-invalid={!!errors.cccd} {...register('cccd')} />
          <FieldError message={errors.cccd?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">Ngày bắt đầu làm việc</Label>
          <Input id="startDate" type="date" disabled={submitting} aria-invalid={!!errors.startDate} {...register('startDate')} />
          <FieldError message={errors.startDate?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="resignedAt">Ngày nghỉ việc</Label>
          <Input id="resignedAt" type="date" disabled={submitting} aria-invalid={!!errors.resignedAt} {...register('resignedAt')} />
          <FieldError message={errors.resignedAt?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dateOfBirth">Ngày sinh</Label>
          <Input id="dateOfBirth" type="date" disabled={submitting} aria-invalid={!!errors.dateOfBirth} {...register('dateOfBirth')} />
          <FieldError message={errors.dateOfBirth?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="salary">Lương (VND)</Label>
          <Input id="salary" type="number" min={0} step={1000} disabled={submitting} aria-invalid={!!errors.salary} {...register('salary')} />
          <FieldError message={errors.salary?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="orderKpi">KPI Đơn hàng</Label>
          <Input id="orderKpi" type="number" min={0} step={1} disabled={submitting} aria-invalid={!!errors.orderKpi} {...register('orderKpi')} />
          <FieldError message={errors.orderKpi?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="revenueKpi">KPI Doanh thu ($)</Label>
          <Input id="revenueKpi" type="number" min={0} step={100} disabled={submitting} aria-invalid={!!errors.revenueKpi} {...register('revenueKpi')} />
          <FieldError message={errors.revenueKpi?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bankAccount">Tài khoản ngân hàng</Label>
          <Input id="bankAccount" disabled={submitting} {...register('bankAccount')} />
          <FieldError message={errors.bankAccount?.message} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address">Địa chỉ</Label>
          <Input id="address" disabled={submitting} {...register('address')} />
          <FieldError message={errors.address?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cccdImageUrl">Ảnh CCCD (URL)</Label>
          <Input id="cccdImageUrl" placeholder="https://…" disabled={submitting} {...register('cccdImageUrl')} />
          <FieldError message={errors.cccdImageUrl?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bankQrUrl">QR Ngân hàng (URL)</Label>
          <Input id="bankQrUrl" placeholder="https://…" disabled={submitting} {...register('bankQrUrl')} />
          <FieldError message={errors.bankQrUrl?.message} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="avatar">Avatar (URL)</Label>
          <Input id="avatar" placeholder="https://…" disabled={submitting} {...register('avatar')} />
          <FieldError message={errors.avatar?.message} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {isEdit ? 'Lưu thay đổi' : 'Tạo nhân viên'}
        </Button>
      </div>
    </form>
  );
}
