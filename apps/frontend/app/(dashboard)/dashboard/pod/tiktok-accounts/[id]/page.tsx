'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldCheck, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useApiError } from '@/hooks/use-api-error';
import { TiktokStatusBadge } from '@/features/pod-tiktok/components/tiktok-status-badge';
import { usePodTiktokAccount } from '@/features/pod-tiktok/hooks/use-pod-tiktok';

export default function PodTiktokAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.tiktok.account.read" message={t('account.noPermission')}>
      <DetailView id={id} />
    </RequirePermission>
  );
}

/** Một dòng thông tin dạng nhãn — giá trị. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

function DetailView({ id }: { id: string }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatDate } = useLocaleFormat();
  const { data: account, isLoading, isError, error } = usePodTiktokAccount(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/pod/tiktok-accounts">
            <ArrowLeft className="size-4" />
            {t('common:action.back')}
          </Link>
        </Button>
        <p className="py-10 text-center text-sm text-destructive">
          {translateApiError(error)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon" aria-label={t('common:action.back')}>
            <Link href="/dashboard/pod/tiktok-accounts">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{account.accountName}</h1>
            <p className="text-sm text-muted-foreground">
              {account.sellerName ?? t('account.unknownSeller')} ·{' '}
              {t('account.shopCount', { count: account.shops.length })}
            </p>
          </div>
        </div>
        <TiktokStatusBadge status={account.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('account.connectionInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="Seller Name">{account.sellerName ?? '—'}</InfoRow>
            <InfoRow label="Seller Base Region">{account.sellerBaseRegion ?? '—'}</InfoRow>
            <InfoRow label="Open ID">
              <span className="font-mono text-xs">{account.openIdMasked}</span>
            </InfoRow>
            <InfoRow label="User Type">
              {account.userType} {account.userType === 0 ? '(Seller)' : '(Global Selling seller)'}
            </InfoRow>
            <InfoRow label={t('account.linkedAt')}>{formatDate(account.createdAt)}</InfoRow>
            <InfoRow label={t('account.lastSyncedAt')}>{formatDate(account.lastSyncedAt)}</InfoRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('account.tokenSection')}</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label={t('account.accessTokenExpiry')}>
              <span className={account.accessTokenExpired ? 'text-destructive' : undefined}>
                {formatDate(account.accessTokenExpiresAt)}
                {account.accessTokenExpired && t('account.expiredSuffix')}
              </span>
            </InfoRow>
            <InfoRow label={t('account.reauthDeadline')}>
              {formatDate(account.refreshTokenExpiresAt)}
            </InfoRow>
            <InfoRow label={t('account.remaining')}>
              <span className={account.daysUntilReauthorize <= 30 ? 'text-amber-600' : undefined}>
                {t('account.daysLeft', { count: account.daysUntilReauthorize })}
              </span>
            </InfoRow>
            <InfoRow label={t('account.lastRefreshedAt')}>{formatDate(account.lastRefreshedAt)}</InfoRow>
            {account.lastErrorCode && (
              <InfoRow label={t('account.lastError')}>
                <span className="text-destructive">
                  {account.lastErrorCode} — {account.lastErrorMessage}
                </span>
              </InfoRow>
            )}
            <p className="pt-3 text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5" />
              {t('account.tokenEncrypted')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('account.scopeSection')}</CardTitle>
        </CardHeader>
        <CardContent>
          {account.grantedScopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('account.scopeEmpty')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {account.grantedScopes.map((scope) => (
                <Badge key={scope} variant="muted">
                  {scope}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">TikTok Shops ({account.shops.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {account.shops.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Store className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('account.noShop')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop Name</TableHead>
                    <TableHead>Shop ID</TableHead>
                    <TableHead>Shop Code</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Seller Type</TableHead>
                    <TableHead>Sync</TableHead>
                    <TableHead>Last Sync</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.shops.map((shop) => (
                    <TableRow key={shop.id}>
                      <TableCell className="font-medium">{shop.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shop.tiktokShopId}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shop.shopCode ?? '—'}
                      </TableCell>
                      <TableCell>{shop.region}</TableCell>
                      <TableCell>{shop.sellerType}</TableCell>
                      <TableCell>
                        <Badge variant={shop.syncEnabled ? 'success' : 'muted'}>
                          {t(shop.syncEnabled ? 'account.syncOn' : 'account.syncOff')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(shop.lastOrderSyncAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
