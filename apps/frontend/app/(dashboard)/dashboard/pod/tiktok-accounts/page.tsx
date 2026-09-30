'use client';

import { useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useClampedPage } from '@/hooks/use-clamped-page';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useApiError } from '@/hooks/use-api-error';
import { LinkAccountDialog } from '@/features/pod-tiktok/components/link-account-dialog';
import { ShopSyncResultDialog } from '@/features/pod-tiktok/components/shop-sync-result-dialog';
import { TiktokAccountTable } from '@/features/pod-tiktok/components/tiktok-account-table';
import {
  usePodTiktokAccounts,
  useSyncPodTiktokShops,
  useUnlinkPodTiktokAccount,
} from '@/features/pod-tiktok/hooks/use-pod-tiktok';
import {
  POD_TIKTOK_STATUSES,
  type PodTiktokAccountListItem,
  type PodTiktokAccountQuery,
  type PodTiktokShopSyncResult,
  type PodTiktokStatus,
} from '@/features/pod-tiktok/types';

export default function PodTiktokAccountsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.tiktok.account.read" message={t('account.noPermission')}>
      <PodTiktokAccountsView />
    </RequirePermission>
  );
}

function PodTiktokAccountsView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const [query, setQuery] = useState<PodTiktokAccountQuery>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<PodTiktokAccountListItem | null>(null);
  /** Kết quả lượt Sync Shops gần nhất — mở dialog chi tiết từng shop. `null` = đóng. */
  const [shopSyncResult, setShopSyncResult] = useState<PodTiktokShopSyncResult | null>(null);

  const { hasPermission } = useAuth();
  const canLink = hasPermission('pod.tiktok.account.create');
  const canUnlink = hasPermission('pod.tiktok.account.delete');
  // Phân công Seller là thao tác cập nhật kết nối ⇒ dùng chung quyền update.
  const canAssignSeller = hasPermission('pod.tiktok.account.update');
  // 🔴 Chỉ để ẩn/hiện nút. Phạm vi (Seller chỉ kết nối được gán) do BACKEND chặn ở mọi request.
  const canSyncShops = hasPermission('pod.tiktok.shop.sync');

  const accountsQuery = usePodTiktokAccounts(query);
  const unlinkMutation = useUnlinkPodTiktokAccount();
  const syncShopsMutation = useSyncPodTiktokShops();

  const patchQuery = (patch: Partial<PodTiktokAccountQuery>) =>
    setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const items = accountsQuery.data?.items ?? [];
  const meta = accountsQuery.data?.meta;
  // Xoá nốt record cuối của trang cuối ⇒ lùi về trang còn dữ liệu,
  // không để giao diện kẹt ở "Trang 3 / 2" với một cái bảng trống.
  useClampedPage(meta, (next) => patchQuery({ page: next }));

  /**
   * Sync Shops. Shop lỗi KHÔNG làm cả lượt thất bại — backend trả kết quả từng shop; toast chỉ
   * tóm tắt, chi tiết (lỗi từng shop) nằm ở dialog.
   */
  const handleSyncShops = async () => {
    try {
      const result = await syncShopsMutation.mutateAsync(undefined);
      const summary = t('account.shopSync.summary', {
        synced: result.syncedShops,
        total: result.totalShops,
        active: result.activeShops,
        inactive: result.inactiveShops,
        deauthorized: result.deauthorizedShops,
        skipped: result.skippedShops,
        failed: result.failedShops,
      });
      if (result.totalShops === 0) {
        toast.warning(t('account.shopSync.empty'));
        return;
      }
      if (result.failedShops > 0 || result.skippedShops > 0) {
        const notify = result.syncedShops === 0 ? toast.error : toast.warning;
        notify(t('account.shopSync.completedWithIssues'), { description: summary });
      } else {
        toast.success(t('account.shopSync.completed'), { description: summary });
      }
      setShopSyncResult(result);
    } catch (error) {
      toast.error(t('account.shopSync.failed'), { description: translateApiError(error) });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!unlinking) return;
    try {
      await unlinkMutation.mutateAsync(unlinking.id);
      toast.success(t('account.unlinkSuccess'), { description: unlinking.accountName });
      setUnlinking(null);
    } catch (error) {
      toast.error(t('account.unlinkFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('account.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('account.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSyncShops && (
            <Button
              variant="outline"
              onClick={() => void handleSyncShops()}
              disabled={syncShopsMutation.isPending}
              title={t('account.shopSync.hint')}
            >
              {syncShopsMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {syncShopsMutation.isPending ? t('account.shopSync.running') : t('account.shopSync.action')}
            </Button>
          )}
          {canLink && (
            <Button onClick={() => setLinkOpen(true)}>
              <Link2 className="size-4" />
              {t('account.linkAction')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('account.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Combobox
              value={query.status ?? ''}
              onChange={(value) =>
                patchQuery({
                  status: (value || undefined) as PodTiktokStatus | undefined,
                  page: 1,
                })
              }
              options={[
                { value: '', label: t('common:filter.allStatuses') },
                ...POD_TIKTOK_STATUSES.map((status) => ({
                  value: status,
                  label: t(`account.status.${status}`),
                })),
              ]}
              className="w-[200px]"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {accountsQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(accountsQuery.error)}
            </p>
          ) : (
            <TiktokAccountTable
              accounts={items}
              loading={accountsQuery.isLoading}
              canUnlink={canUnlink}
              canAssignSeller={canAssignSeller}
              onUnlink={setUnlinking}
            />
          )}

          <DataPagination
            meta={meta}
            onPageChange={(next) => patchQuery({ page: next })}
            onPageSizeChange={(next) => patchQuery({ limit: next, page: 1 })}
          />
        </CardContent>
      </Card>

      <LinkAccountDialog open={linkOpen} onClose={() => setLinkOpen(false)} />

      <ShopSyncResultDialog result={shopSyncResult} onClose={() => setShopSyncResult(null)} />

      <Modal
        open={Boolean(unlinking)}
        onClose={() => setUnlinking(null)}
        title={t('account.unlinkTitle')}
        description={t('account.unlinkDescription', { name: unlinking?.accountName ?? '' })}
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setUnlinking(null)}
            disabled={unlinkMutation.isPending}
          >
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmUnlink}
            disabled={unlinkMutation.isPending}
          >
            {unlinkMutation.isPending && <Loader2 className="animate-spin" />}
            {t('account.unlinkAction')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
