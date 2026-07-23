'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ImportExportBar } from '@/features/import-export/components/import-export-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { AccountFilter } from '@/features/accounts/components/account-filter';
import { AccountOverviewPanel } from '@/features/accounts/components/account-overview';
import { AccountTable } from '@/features/accounts/components/account-table';
import {
  useAccountOverview,
  useAccounts,
  useDeleteAccount,
  usePlatforms,
  useSellers,
} from '@/features/accounts/hooks/use-accounts';
import type { AccountListItem, AccountQuery } from '@/features/accounts/types';

export default function AccountsPage() {
  return (
    <RequirePermission permission="account.read" message="Bạn không có quyền truy cập Account.">
      <AccountsView />
    </RequirePermission>
  );
}

function AccountsView() {
  const [query, setQuery] = useState<AccountQuery>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [deleting, setDeleting] = useState<AccountListItem | null>(null);

  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // Chỉ ADMIN (quyền gán Seller) mới thấy filter Seller & fetch danh sách Seller.
  const canAssign = hasPermission('account.assign');
  const accountsQuery = useAccounts(query);
  const overviewQuery = useAccountOverview();
  const platformsQuery = usePlatforms();
  const sellersQuery = useSellers(canAssign);
  const deleteMutation = useDeleteAccount();

  const patchQuery = (patch: Partial<AccountQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const items = accountsQuery.data?.items ?? [];
  const meta = accountsQuery.data?.meta;

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Đã xóa Account', { description: deleting.name });
      setDeleting(null);
    } catch (error) {
      toast.error('Xóa thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">Quản lý tài khoản bán hàng trên sàn.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportExportBar
            entity="Account"
            exportExamplePath="/accounts/export/example"
            exportPath="/accounts/export"
            importPath="/accounts/import"
            importUpdatePath="/accounts/import/update"
            exampleFilename="account-import-template.xlsx"
            exportFilename="accounts-export.xlsx"
            canExport={hasPermission('account.export')}
            canImport={hasPermission('account.import')}
            canImportUpdate={hasPermission('account.import')}
            onImported={() => queryClient.invalidateQueries({ queryKey: ['accounts'] })}
          />
          {hasPermission('account.create') && (
            <Button asChild>
              <Link href="/dashboard/accounts/create">
                <Plus className="size-4" />
                Thêm Account
              </Link>
            </Button>
          )}
        </div>
      </div>

      {overviewQuery.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tổng quan</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountOverviewPanel overview={overviewQuery.data} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <AccountFilter
            search={searchInput}
            status={query.status}
            platformId={query.platformId}
            sellerUserId={query.sellerUserId}
            platforms={platformsQuery.data ?? []}
            sellers={sellersQuery.data ?? []}
            showSeller={canAssign}
            onSearchChange={setSearchInput}
            onStatusChange={(status) => patchQuery({ status, page: 1 })}
            onPlatformChange={(platformId) => patchQuery({ platformId, page: 1 })}
            onSellerChange={(sellerUserId) => patchQuery({ sellerUserId, page: 1 })}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {accountsQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {getApiErrorMessage(accountsQuery.error, 'Không tải được danh sách Account')}
            </p>
          ) : (
            <AccountTable
              accounts={items}
              loading={accountsQuery.isLoading}
              onDelete={setDeleting}
            />
          )}

          {meta && meta.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Trang {meta.page}/{meta.totalPages} · {meta.total} Account
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  Sau
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Xóa Account"
        description={`Bạn có chắc muốn xóa "${deleting?.name ?? ''}"? Account sẽ bị xóa mềm.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteMutation.isPending}>
            Hủy
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending && <Loader2 className="animate-spin" />}
            Xóa
          </Button>
        </div>
      </Modal>
    </div>
  );
}
