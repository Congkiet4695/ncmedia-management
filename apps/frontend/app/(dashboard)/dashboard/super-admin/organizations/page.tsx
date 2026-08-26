'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Clock, Eye, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
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
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { OrganizationStatusBadge } from '@/features/super-admin/components/organization-status-badge';
import {
  ApproveDialog,
  RejectDialog,
} from '@/features/super-admin/components/review-dialogs';
import {
  useApproveOrganization,
  useOrganizations,
  useRejectOrganization,
  useSuperAdminDashboard,
} from '@/features/super-admin/hooks';
import { ORGANIZATION_FILTER_STATUSES } from '@/features/super-admin/types';
import type { OrganizationRow, OrganizationStatus } from '@/features/super-admin/types';

export default function SuperAdminOrganizationsPage() {
  const { t } = useTranslation('superAdmin');
  return (
    <RequirePermission permission="platform.organization.read" message={t('noPermission')}>
      <OrganizationsView />
    </RequirePermission>
  );
}

/**
 * **Super Admin → Organizations** — hàng chờ duyệt đăng ký.
 *
 * ```
 *   Dashboard (§10)  →  Pending / Approved / Rejected / Total
 *   Danh sách (§6)   →  Organization · Owner · Email · Register Time · Status
 *   Thao tác (§8/§9) →  Approve  ·  Reject (bắt buộc lý do)
 * ```
 *
 * 🔴 Nút Approve/Reject chỉ hiện với hồ sơ **PENDING**. Backend cũng chặn, nhưng để nút hiện
 * ra rồi báo lỗi sau khi bấm là bắt người dùng học luật bằng cách phạm luật.
 */
function OrganizationsView() {
  const { t } = useTranslation(['superAdmin', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 350);
  const [status, setStatus] = useState<OrganizationStatus | ''>('PENDING');
  const [approving, setApproving] = useState<OrganizationRow | null>(null);
  const [rejecting, setRejecting] = useState<OrganizationRow | null>(null);

  const dashboard = useSuperAdminDashboard();
  const query = useOrganizations({
    page,
    limit: 20,
    status: status || undefined,
    search: search || undefined,
  });

  const approve = useApproveOrganization();
  const reject = useRejectOrganization();

  const items = query.data?.items ?? [];
  const meta = query.data?.meta;

  /** Thông báo kèm cảnh báo nếu email không gửi được — người dùng cần biết sự thật đó. */
  const notify = (message: string, emailSent?: boolean): void => {
    toast.success(message, {
      description: emailSent === false ? t('emailFailed') : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('organizations.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('organizations.subtitle')}</p>
      </div>

      {/* --- Dashboard (§10) --- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashboard.pending')}
          value={dashboard.data?.pending}
          loading={dashboard.isLoading}
          icon={<Clock className="size-5" />}
          tone="warning"
          onClick={() => {
            setStatus('PENDING');
            setPage(1);
          }}
        />
        <StatCard
          label={t('dashboard.approved')}
          value={dashboard.data?.approved}
          loading={dashboard.isLoading}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
          onClick={() => {
            setStatus('ACTIVE');
            setPage(1);
          }}
        />
        <StatCard
          label={t('dashboard.rejected')}
          value={dashboard.data?.rejected}
          loading={dashboard.isLoading}
          icon={<XCircle className="size-5" />}
          tone="destructive"
          onClick={() => {
            setStatus('REJECTED');
            setPage(1);
          }}
        />
        <StatCard
          label={t('dashboard.total')}
          value={dashboard.data?.total}
          loading={dashboard.isLoading}
          icon={<Building2 className="size-5" />}
          tone="muted"
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={searchInput}
              placeholder={t('organizations.searchPlaceholder')}
              className="w-full sm:max-w-sm"
              onChange={(event) => {
                setPage(1);
                setSearchInput(event.target.value);
              }}
            />
            <Combobox
              value={status}
              className="w-[180px]"
              onChange={(value) => {
                setStatus(value as OrganizationStatus | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('organizations.allStatuses') },
                ...ORGANIZATION_FILTER_STATUSES.map((value) => ({
                  value,
                  label: t(`status.${value}`),
                })),
              ]}
            />
          </div>

          {query.error ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(query.error)}
            </p>
          ) : query.isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {t('organizations.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('organizations.organization')}</TableHead>
                    <TableHead>{t('organizations.owner')}</TableHead>
                    <TableHead>{t('organizations.email')}</TableHead>
                    <TableHead>{t('organizations.registeredAt')}</TableHead>
                    <TableHead>{t('organizations.status')}</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((organization) => (
                    <TableRow key={organization.id}>
                      <TableCell className="max-w-[240px]">
                        <Link
                          href={`/dashboard/super-admin/organizations/${organization.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {organization.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{organization.slug}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {organization.owner?.fullName ?? '—'}
                        {organization.owner?.phone && (
                          <p className="text-xs text-muted-foreground">
                            {organization.owner.phone}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{organization.owner?.email ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(organization.registeredAt)}
                      </TableCell>
                      <TableCell>
                        <OrganizationStatusBadge status={organization.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild title={t('organizations.detail')}>
                            <Link href={`/dashboard/super-admin/organizations/${organization.id}`}>
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                          {organization.status === 'PENDING' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setApproving(organization)}
                              >
                                {t('approve.submit')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => setRejecting(organization)}
                              >
                                {t('reject.submit')}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t('common:pagination.pageWithTotal', {
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
                  onClick={() => setPage((prev) => prev - 1)}
                >
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  {t('common:action.next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ApproveDialog
        organization={approving}
        pending={approve.isPending}
        onClose={() => setApproving(null)}
        onConfirm={() => {
          if (!approving) return;
          void approve
            .mutateAsync(approving.id)
            .then((result) => {
              notify(t('approve.done', { name: approving.name }), result.emailSent);
              setApproving(null);
            })
            .catch((error: unknown) => toast.error(translateApiError(error)));
        }}
      />

      <RejectDialog
        organization={rejecting}
        pending={reject.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (!rejecting) return;
          void reject
            .mutateAsync({ id: rejecting.id, reason })
            .then((result) => {
              notify(t('reject.done', { name: rejecting.name }), result.emailSent);
              setRejecting(null);
            })
            .catch((error: unknown) => toast.error(translateApiError(error)));
        }}
      />
    </div>
  );
}

/** Một ô thống kê — bấm vào là lọc danh sách theo đúng trạng thái đó. */
function StatCard({
  label,
  value,
  loading,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value?: number;
  loading: boolean;
  icon: React.ReactNode;
  tone: 'warning' | 'success' | 'destructive' | 'muted';
  onClick: () => void;
}) {
  const TONE = {
    warning: 'bg-amber-500/10 text-amber-600',
    success: 'bg-emerald-500/10 text-emerald-600',
    destructive: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  } as const;

  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="flex items-center gap-3 pt-6">
          <span className={`flex size-10 items-center justify-center rounded-full ${TONE[tone]}`}>
            {icon}
          </span>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums">
              {loading ? <Loader2 className="size-5 animate-spin" /> : (value ?? 0)}
            </p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
