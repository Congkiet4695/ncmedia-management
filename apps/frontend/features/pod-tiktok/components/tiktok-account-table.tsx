'use client';

import Link from 'next/link';
import { Eye, Loader2, RefreshCw, RotateCw, Store, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { SellerAssignSelect } from './seller-assign-select';
import { TiktokStatusBadge } from './tiktok-status-badge';
import type { PodTiktokAccountListItem } from '../types';

interface TiktokAccountTableProps {
  accounts: PodTiktokAccountListItem[];
  loading?: boolean;
  canUnlink?: boolean;
  /** Có quyền `pod.tiktok.account.update` ⇒ được phân công Seller ngay trên bảng. */
  canAssignSeller?: boolean;
  onUnlink: (account: PodTiktokAccountListItem) => void;
}

/** Nhãn thời hạn token — cảnh báo khi sắp/đã hết hạn. */
function TokenExpiry({ iso, expired }: { iso: string; expired: boolean }) {
  const { t } = useTranslation('pod');
  const { formatDate } = useLocaleFormat();
  return (
    <span className={expired ? 'text-destructive' : 'text-muted-foreground'}>
      {formatDate(iso)}
      {expired && t('account.tokenExpired')}
    </span>
  );
}

export function TiktokAccountTable({
  accounts,
  loading,
  canUnlink,
  canAssignSeller = false,
  onUnlink,
}: TiktokAccountTableProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDate } = useLocaleFormat();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Store className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t('account.emptyList')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('account.accountName')}</TableHead>
            <TableHead>{t('account.shopName')}</TableHead>
            <TableHead>{t('account.shopId')}</TableHead>
            <TableHead>{t('account.region')}</TableHead>
            <TableHead>{t('account.tiktokSeller')}</TableHead>
            <TableHead className="min-w-[200px]">{t('account.assignedSeller')}</TableHead>
            <TableHead>{t('account.status.columnLabel')}</TableHead>
            <TableHead className="whitespace-nowrap">{t('account.tokenExpiry')}</TableHead>
            <TableHead className="whitespace-nowrap">{t('account.lastSync')}</TableHead>
            <TableHead className="whitespace-nowrap">{t('account.created')}</TableHead>
            <TableHead className="text-right">{t('common:table.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell className="font-medium">
                {account.accountName}
                {account.shopCount > 1 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {t('account.extraShops', { count: account.shopCount - 1 })}
                  </span>
                )}
              </TableCell>
              <TableCell>{account.shopName ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {account.tiktokShopId ?? '—'}
              </TableCell>
              <TableCell>{account.region ?? '—'}</TableCell>
              <TableCell>{account.sellerName ?? '—'}</TableCell>
              {/* Seller phụ trách — nguồn duy nhất cho Order/Payout/Dashboard. */}
              <TableCell>
                <SellerAssignSelect
                  accountId={account.id}
                  accountName={account.accountName}
                  sellerId={account.sellerId}
                  sellerFullName={account.sellerFullName}
                  sellerEmail={account.sellerEmail}
                  editable={canAssignSeller}
                />
              </TableCell>
              <TableCell>
                <TiktokStatusBadge status={account.status} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <TokenExpiry
                  iso={account.accessTokenExpiresAt}
                  expired={account.accessTokenExpired}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(account.lastSyncedAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(account.createdAt)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label={t('common:action.viewDetail')}>
                    <Link href={`/dashboard/pod/tiktok-accounts/${account.id}`}>
                      <Eye className="size-4" />
                    </Link>
                  </Button>
                  {/* Placeholder — triển khai ở Sprint Token Lifecycle */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('account.refreshTokenLabel')}
                    title={t('account.refreshTokenSoon')}
                    disabled
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  {/* Placeholder — triển khai ở Sprint Sync Orders */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('account.syncOrdersLabel')}
                    title={t('account.syncOrdersSoon')}
                    disabled
                  >
                    <RotateCw className="size-4" />
                  </Button>
                  {canUnlink && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('account.unlinkAction')}
                      title={t('account.unlinkAction')}
                      onClick={() => onUnlink(account)}
                    >
                      <Unlink className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
