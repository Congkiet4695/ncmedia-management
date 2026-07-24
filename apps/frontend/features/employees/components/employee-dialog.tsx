'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { formatDate, formatUSD, formatVnd } from '@/lib/format';
import { useEmployee } from '../hooks/use-employees';
import { EmployeeStatusBadge } from './employee-status-badge';

interface EmployeeDialogProps {
  employeeId: string | null;
  open: boolean;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{children}</dd>
    </div>
  );
}

/** EmployeeDialog — modal xem chi tiết đầy đủ (Action: View). Tự fetch hồ sơ theo id. */
export function EmployeeDialog({ employeeId, open, onClose }: EmployeeDialogProps) {
  const { data: employee, isLoading } = useEmployee(open && employeeId ? employeeId : undefined);

  return (
    <Modal open={open} onClose={onClose} title="Chi tiết nhân viên" className="max-w-2xl">
      {isLoading || !employee ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar src={employee.avatar} name={employee.fullName} className="size-12" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{employee.fullName}</p>
              <p className="truncate text-sm text-muted-foreground">{employee.email}</p>
            </div>
            <div className="ml-auto">
              <EmployeeStatusBadge status={employee.status} />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <Field label="Vai trò">{employee.role.name}</Field>
            <Field label="SĐT">{employee.phone ?? '—'}</Field>
            <Field label="Account Lark">{employee.larkAccount ?? '—'}</Field>
            <Field label="Phòng">{employee.department ?? '—'}</Field>
            <Field label="Ngày vào làm">{formatDate(employee.startDate)}</Field>
            <Field label="Ngày nghỉ">{formatDate(employee.resignedAt)}</Field>
            <Field label="Ngày sinh">{employee.dateOfBirth ?? '—'}</Field>
            <Field label="CCCD">{employee.cccd ?? '—'}</Field>
            <Field label="Lương">{formatVnd(employee.salary)}</Field>
            <Field label="KPI Đơn hàng">{employee.orderKpi}</Field>
            <Field label="KPI Doanh thu">{formatUSD(employee.revenueKpi)}</Field>
            <Field label="Ngân hàng">{employee.bankAccount ?? '—'}</Field>
            <Field label="Địa chỉ">{employee.address ?? '—'}</Field>
            <Field label="Ngày tạo">{formatDate(employee.createdAt)}</Field>
          </dl>

          {(employee.cccdImageUrl || employee.bankQrUrl) && (
            <div className="flex flex-wrap gap-4 text-sm">
              {employee.cccdImageUrl && (
                <a
                  href={employee.cccdImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Ảnh CCCD
                </a>
              )}
              {employee.bankQrUrl && (
                <a
                  href={employee.bankQrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  QR Ngân hàng
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
