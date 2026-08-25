'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { useDeleteSession, useListingSessions } from '@/features/pod-listing-session/hooks';
import { POD_SESSION_STATUSES } from '@/features/pod-listing-session/types';
import type { PodSessionStatus } from '@/features/pod-listing-session/types';

export default function AutoListingPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.session.read" message={t('listing.common.noPermission')}>
      <ListingSessionListView />
    </RequirePermission>
  );
}

/**
 * **POD → Auto Listing** — danh sách các **lượt đăng hàng** (Listing Session).
 *
 * ```
 *   New Listing → Market → Shops → 5 Template → Import → Review → Start Listing
 * ```
 *
 * 🔴 Không còn màn "Draft Listing" riêng: Draft Product chỉ tồn tại bên trong một lượt đăng,
 * nên đường duy nhất tới nó là mở lượt đăng ra.
 */
function ListingSessionListView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const canWrite = hasPermission('pod.session.write');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodSessionStatus | ''>('');

  const sessions = useListingSessions({
    page,
    limit: 20,
    search: search || undefined,
    status: status || undefined,
  });
  const remove = useDeleteSession();

  const items = sessions.data?.items ?? [];
  const create = (): void => router.push('/dashboard/pod/auto-listing/new');

  return (
    <TemplatePageShell
      title={t('listing.sessions.title')}
      subtitle={t('listing.sessions.subtitle')}
      createLabel={t('listing.sessions.create')}
      onCreate={canWrite ? create : undefined}
      loading={sessions.isLoading}
      error={sessions.error}
      empty={items.length === 0}
      emptyMessage={t('listing.sessions.empty')}
      onSearchChange={setSearch}
      searchPlaceholder={t('listing.sessions.searchPlaceholder')}
      meta={sessions.data?.meta ?? null}
      onPageChange={setPage}
      filters={
        <Combobox
          value={status}
          onChange={(value) => setStatus(value as PodSessionStatus | '')}
          options={[
            { value: '', label: t('listing.sessions.allStatuses') },
            ...POD_SESSION_STATUSES.map((value) => ({
              value,
              label: t(`listing.sessions.status.${value}`),
            })),
          ]}
          className="w-[210px]"
        />
      }
      actions={
        !canWrite ? undefined : (
          <Button variant="outline" onClick={create}>
            <Plus className="size-4" />
            {t('listing.sessions.create')}
          </Button>
        )
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('listing.sessions.name')}</TableHead>
            <TableHead>{t('listing.sessions.market')}</TableHead>
            <TableHead>{t('listing.sessions.shops')}</TableHead>
            <TableHead className="text-right">{t('listing.sessions.products')}</TableHead>
            <TableHead>{t('listing.common.status')}</TableHead>
            <TableHead>{t('listing.sessions.updatedAt')}</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((session) => (
            <TableRow key={session.id}>
              <TableCell>
                <Link
                  href={`/dashboard/pod/auto-listing/${session.id}`}
                  className="font-medium hover:underline"
                >
                  {session.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {session.sourceFile ?? t('listing.sessions.noImport')}
                </p>
              </TableCell>
              <TableCell>{session.market}</TableCell>
              <TableCell className="text-sm">
                {session.shops.length === 0
                  ? '—'
                  : session.shops.map((link) => link.shop.name).join(', ')}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="text-emerald-600">{session.counts.UPLOADED}</span>
                {' / '}
                <span className="text-destructive">{session.counts.FAILED}</span>
                {' / '}
                {session.counts.TOTAL}
              </TableCell>
              <TableCell>
                <ListingStatusBadge
                  status={session.status}
                  label={t(`listing.sessions.status.${session.status}`)}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateTime(session.updatedAt)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/pod/auto-listing/${session.id}`}>
                      <Eye className="size-4" />
                    </Link>
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('common:action.delete')}
                      onClick={() => {
                        if (
                          !window.confirm(
                            t('listing.sessions.deleteConfirm', { name: session.name }),
                          )
                        ) {
                          return;
                        }
                        void remove
                          .mutateAsync(session.id)
                          .then(() => toast.success(t('listing.sessions.deleted')))
                          .catch((error: unknown) => toast.error(translateApiError(error)));
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TemplatePageShell>
  );
}
