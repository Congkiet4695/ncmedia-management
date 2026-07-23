'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { AccountForm } from '@/features/accounts/components/account-form';
import { CredentialsPanel } from '@/features/accounts/components/credentials-panel';
import {
  useAccount,
  usePlatforms,
  useSellers,
  useUpdateAccount,
} from '@/features/accounts/hooks/use-accounts';
import { toAccountPayload } from '@/features/accounts/utils/form-payload';
import type { AccountFormInput } from '@/features/accounts/schemas/account.schema';

export default function EditAccountPage() {
  return (
    <RequirePermission permission="account.read" message="Bạn không có quyền truy cập Account.">
      <EditAccountView />
    </RequirePermission>
  );
}

function EditAccountView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { hasPermission } = useAuth();
  const canAssign = hasPermission('account.assign');
  const platformsQuery = usePlatforms();
  const sellersQuery = useSellers(canAssign);
  const accountQuery = useAccount(id);
  const updateMutation = useUpdateAccount();

  if (accountQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-destructive">
          {getApiErrorMessage(accountQuery.error, 'Không tìm thấy Account')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/accounts">
            <ArrowLeft className="size-4" />
            Quay lại danh sách
          </Link>
        </Button>
      </div>
    );
  }

  const account = accountQuery.data;
  const defaultValues: Partial<AccountFormInput> = {
    name: account.name,
    platformId: account.platform?.id ?? '',
    loginTool: account.loginTool ?? '',
    sellerUserId: account.seller?.id ?? '',
    status: account.status,
    issuedAt: account.issuedAt ?? '',
    activatedAt: account.activatedAt ?? '',
    diedBlankAt: account.diedBlankAt ?? '',
    diedAt: account.diedAt ?? '',
    moneyReturnedAt: account.moneyReturnedAt ?? '',
    dieReason: account.dieReason ?? '',
    proxy: account.proxy ?? '',
    docsUrl: account.docsUrl ?? '',
    note: account.note ?? '',
    note2: account.note2 ?? '',
  };

  const onSubmit = async (values: AccountFormInput) => {
    try {
      await updateMutation.mutateAsync({ id, payload: toAccountPayload(values) });
      toast.success('Cập nhật Account thành công');
      router.push('/dashboard/accounts');
    } catch (error) {
      toast.error('Cập nhật thất bại', { description: getApiErrorMessage(error) });
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
          <CardTitle>Chỉnh sửa Account</CardTitle>
          <CardDescription>{account.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            mode="edit"
            platforms={platformsQuery.data ?? []}
            sellers={sellersQuery.data ?? []}
            showSeller={canAssign}
            submitting={updateMutation.isPending}
            defaultValues={defaultValues}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>

      {hasPermission('account.credentials.read') && (
        <Card>
          <CardHeader>
            <CardTitle>Credentials (🔒 nhạy cảm)</CardTitle>
            <CardDescription>Thông tin đăng nhập/định danh — mã hoá at-rest.</CardDescription>
          </CardHeader>
          <CardContent>
            <CredentialsPanel accountId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
