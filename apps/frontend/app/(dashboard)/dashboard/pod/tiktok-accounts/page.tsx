'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useApiError } from '@/hooks/use-api-error';
import { LinkAccountDialog } from '@/features/pod-tiktok/components/link-account-dialog';
import { TiktokAccountTable } from '@/features/pod-tiktok/components/tiktok-account-table';
import {
  usePodTiktokAccounts,
  useUnlinkPodTiktokAccount,
} from '@/features/pod-tiktok/hooks/use-pod-tiktok';
import {
  POD_TIKTOK_STATUSES,
  type PodTiktokAccountListItem,
  type PodTiktokAccountQuery,
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

  const { hasPermission } = useAuth();
  const canLink = hasPermission('pod.tiktok.account.create');
  const canUnlink = hasPermission('pod.tiktok.account.delete');
  // Phân công Seller là thao tác cập nhật kết nối ⇒ dùng chung quyền update.
  const canAssignSeller = hasPermission('pod.tiktok.account.update');

  const accountsQuery = usePodTiktokAccounts(query);
  const unlinkMutation = useUnlinkPodTiktokAccount();

  const patchQuery = (patch: Partial<PodTiktokAccountQuery>) =>
    setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const items = accountsQuery.data?.items ?? [];
  const meta = accountsQuery.data?.meta;

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
        {canLink && (
          <Button onClick={() => setLinkOpen(true)}>
            <Link2 className="size-4" />
            {t('account.linkAction')}
          </Button>
        )}
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

          {meta && meta.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t('account.pageWithConnections', {
                  page: meta.page,
                  totalPages: meta.totalPages,
                  total: meta.total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  {t('common:action.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <LinkAccountDialog open={linkOpen} onClose={() => setLinkOpen(false)} />

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
