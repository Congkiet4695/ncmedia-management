'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getApiErrorMessage } from '@/utils/http';
import { CredentialsDialog } from '@/features/employees/components/credentials-dialog';
import { EmployeeForm } from '@/features/employees/components/employee-form';
import { EmployeeStatusBadge } from '@/features/employees/components/employee-status-badge';
import { RequireAdmin } from '@/features/employees/components/require-admin';
import {
  useEmployee,
  useResetPassword,
  useRoles,
  useUpdateEmployee,
} from '@/features/employees/hooks/use-employees';
import { toUpdatePayload } from '@/features/employees/utils/form-payload';
import type { EmployeeFormInput } from '@/features/employees/schemas/employee.schema';

export default function EditEmployeePage() {
  return (
    <RequireAdmin>
      <EditEmployeeView />
    </RequireAdmin>
  );
}

function EditEmployeeView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const rolesQuery = useRoles();
  const employeeQuery = useEmployee(id);
  const updateMutation = useUpdateEmployee();
  const resetMutation = useResetPassword();
  const [newPassword, setNewPassword] = useState<string | null>(null);

  if (employeeQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (employeeQuery.isError || !employeeQuery.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-destructive">
          {getApiErrorMessage(employeeQuery.error, 'Không tìm thấy nhân viên')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/employees">
            <ArrowLeft className="size-4" />
            Quay lại danh sách
          </Link>
        </Button>
      </div>
    );
  }

  const employee = employeeQuery.data;
  const defaultValues: Partial<EmployeeFormInput> = {
    fullName: employee.fullName,
    email: employee.email,
    status: employee.status,
    roleId: employee.role.id,
    larkAccount: employee.larkAccount ?? '',
    startDate: employee.startDate ?? '',
    resignedAt: employee.resignedAt ?? '',
    cccd: employee.cccd ?? '',
    cccdImageUrl: employee.cccdImageUrl ?? '',
    phone: employee.phone ?? '',
    dateOfBirth: employee.dateOfBirth ?? '',
    address: employee.address ?? '',
    department: employee.department ?? '',
    bankAccount: employee.bankAccount ?? '',
    bankQrUrl: employee.bankQrUrl ?? '',
    salary: employee.salary,
    orderKpi: employee.orderKpi,
    revenueKpi: employee.revenueKpi,
    avatar: employee.avatar ?? '',
  };

  const onSubmit = async (values: EmployeeFormInput) => {
    try {
      await updateMutation.mutateAsync({ id, payload: toUpdatePayload(values) });
      toast.success('Cập nhật thành công', { description: values.fullName });
      router.push('/dashboard/employees');
    } catch (error) {
      toast.error('Cập nhật thất bại', { description: getApiErrorMessage(error) });
    }
  };

  const handleResetPassword = async () => {
    try {
      const result = await resetMutation.mutateAsync(id);
      setNewPassword(result.newPassword);
    } catch (error) {
      toast.error('Reset mật khẩu thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/employees">
          <ArrowLeft className="size-4" />
          Quay lại danh sách
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin đăng nhập</CardTitle>
          <CardDescription>Tài khoản đăng nhập của nhân viên.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="break-words font-medium">{employee.email}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Vai trò</dt>
              <dd className="font-medium">{employee.role.name}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Trạng thái</dt>
              <dd>
                <EmployeeStatusBadge status={employee.status} />
              </dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="outline"
            onClick={handleResetPassword}
            disabled={resetMutation.isPending}
          >
            {resetMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            Reset Password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chỉnh sửa nhân viên</CardTitle>
          <CardDescription>{employee.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <EmployeeForm
            mode="edit"
            roles={rolesQuery.data ?? []}
            submitting={updateMutation.isPending}
            defaultValues={defaultValues}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>

      <CredentialsDialog
        open={Boolean(newPassword)}
        title="Mật khẩu mới"
        description="Mật khẩu mới của nhân viên (hiển thị một lần):"
        password={newPassword ?? ''}
        onClose={() => setNewPassword(null)}
      />
    </div>
  );
}
