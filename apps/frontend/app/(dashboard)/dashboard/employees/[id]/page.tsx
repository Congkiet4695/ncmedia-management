'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiError } from '@/hooks/use-api-error';
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
  const { t } = useTranslation(['employee', 'common']);
  const translateApiError = useApiError();
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
          {translateApiError(employeeQuery.error)}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/employees">
            <ArrowLeft className="size-4" />
            {t('backToList')}
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
      toast.success(t('updateSuccess'), { description: values.fullName });
      router.push('/dashboard/employees');
    } catch (error) {
      toast.error(t('updateFailed'), { description: translateApiError(error) });
    }
  };

  const handleResetPassword = async () => {
    try {
      const result = await resetMutation.mutateAsync(id);
      setNewPassword(result.newPassword);
    } catch (error) {
      toast.error(t('resetPasswordFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/employees">
          <ArrowLeft className="size-4" />
          {t('backToList')}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{t('loginInfo')}</CardTitle>
          <CardDescription>{t('loginInfoHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="break-words font-medium">{employee.email}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">{t('field.role')}</dt>
              <dd className="font-medium">{employee.role.name}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">{t('field.status')}</dt>
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
          <CardTitle>{t('edit')}</CardTitle>
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
        title={t('newPassword')}
        description={t('newPasswordHint')}
        password={newPassword ?? ''}
        onClose={() => setNewPassword(null)}
      />
    </div>
  );
}
