'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiError } from '@/hooks/use-api-error';
import { CredentialsDialog } from '@/features/employees/components/credentials-dialog';
import { EmployeeForm } from '@/features/employees/components/employee-form';
import { RequireAdmin } from '@/features/employees/components/require-admin';
import { useCreateEmployee, useRoles } from '@/features/employees/hooks/use-employees';
import { toCreatePayload } from '@/features/employees/utils/form-payload';
import type { EmployeeFormInput } from '@/features/employees/schemas/employee.schema';
import type { EmployeeCredentials } from '@/features/employees/types';

export default function CreateEmployeePage() {
  return (
    <RequireAdmin>
      <CreateEmployeeView />
    </RequireAdmin>
  );
}

function CreateEmployeeView() {
  const { t } = useTranslation(['employee', 'common']);
  const translateApiError = useApiError();
  const router = useRouter();
  const rolesQuery = useRoles();
  const createMutation = useCreateEmployee();
  const [credentials, setCredentials] = useState<EmployeeCredentials | null>(null);

  const onSubmit = async (values: EmployeeFormInput) => {
    try {
      const result = await createMutation.mutateAsync(toCreatePayload(values));
      // Hiển thị Success Dialog (mật khẩu chỉ hiển thị một lần) — redirect khi đóng.
      setCredentials(result.credentials);
    } catch (error) {
      toast.error(t('createFailed'), { description: translateApiError(error) });
    }
  };

  const handleCloseDialog = () => {
    setCredentials(null);
    router.push('/dashboard/employees');
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
          <CardTitle>{t('create')}</CardTitle>
          <CardDescription>{t('createHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <EmployeeForm
            mode="create"
            roles={rolesQuery.data ?? []}
            submitting={createMutation.isPending}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>

      <CredentialsDialog
        open={Boolean(credentials)}
        title={t('createSuccess')}
        description={t('credentialsHint')}
        email={credentials?.email}
        password={credentials?.initialPassword ?? ''}
        onClose={handleCloseDialog}
      />
    </div>
  );
}
