'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { AccountForm } from '@/features/accounts/components/account-form';
import {
  useCreateAccount,
  usePlatforms,
  useSellers,
} from '@/features/accounts/hooks/use-accounts';
import { toAccountPayload } from '@/features/accounts/utils/form-payload';
import type { AccountFormInput } from '@/features/accounts/schemas/account.schema';

export default function CreateAccountPage() {
  return (
    <RequirePermission permission="account.create" message="Bạn không có quyền tạo Account.">
      <CreateAccountView />
    </RequirePermission>
  );
}

function CreateAccountView() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canAssign = hasPermission('account.assign');
  const platformsQuery = usePlatforms();
  const sellersQuery = useSellers(canAssign);
  const createMutation = useCreateAccount();

  const onSubmit = async (values: AccountFormInput) => {
    try {
      await createMutation.mutateAsync(toAccountPayload(values));
      toast.success('Tạo Account thành công');
      router.push('/dashboard/accounts');
    } catch (error) {
      toast.error('Tạo Account thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/accounts">
          <ArrowLeft className="size-4" />
          Quay lại danh sách
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Thêm Account</CardTitle>
          <CardDescription>Thông tin đăng nhập (credentials) cập nhật ở trang chi tiết.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            mode="create"
            platforms={platformsQuery.data ?? []}
            sellers={sellersQuery.data ?? []}
            showSeller={canAssign}
            submitting={createMutation.isPending}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
