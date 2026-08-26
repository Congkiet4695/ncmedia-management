'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { OrganizationStatusBadge } from '@/features/super-admin/components/organization-status-badge';
import { ApproveDialog, RejectDialog } from '@/features/super-admin/components/review-dialogs';
import {
  useApproveOrganization,
  useOrganization,
  useRejectOrganization,
} from '@/features/super-admin/hooks';
import type { OrganizationDetail } from '@/features/super-admin/types';

export default function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = useTranslation('superAdmin');
  const { id } = use(params);
  return (
    <RequirePermission permission="platform.organization.read" message={t('noPermission')}>
      <DetailView id={id} />
    </RequirePermission>
  );
}

/**
 * **Super Admin → Organization Detail** (§7).
 *
 * Hiển thị đủ thông tin để RA QUYẾT ĐỊNH: tổ chức là ai, chủ tài khoản là ai, liên hệ thế
 * nào, đăng ký lúc nào — cộng với **lịch sử duyệt** để biết chuyện gì đã xảy ra trước đó.
 */
function DetailView({ id }: { id: string }) {
  const { t } = useTranslation(['superAdmin', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const query = useOrganization(id);
  const approve = useApproveOrganization();
  const reject = useRejectOrganization();

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="text-sm text-destructive">
        {query.error ? translateApiError(query.error) : t('organizations.notFound')}
      </p>
    );
  }

  const org: OrganizationDetail = query.data;
  const isPending = org.status === 'PENDING';

  const notify = (message: string, emailSent?: boolean): void => {
    toast.success(message, {
      description: emailSent === false ? t('emailFailed') : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/super-admin/organizations">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
              <OrganizationStatusBadge status={org.status} />
            </div>
            <p className="text-sm text-muted-foreground">{org.slug}</p>
          </div>
        </div>

        {/* Chỉ hồ sơ PENDING mới có hành động — khớp đúng ràng buộc của backend. */}
        {isPending && (
          <div className="flex gap-2">
            <Button variant="outline" className="text-destructive" onClick={() => setRejectOpen(true)}>
              {t('reject.submit')}
            </Button>
            <Button onClick={() => setApproveOpen(true)}>{t('approve.submit')}</Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Organization Information --- */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-semibold">{t('detail.organizationInfo')}</h2>
            <Row label={t('organizations.organization')} value={org.name} />
            <Row label={t('detail.slug')} value={org.slug} mono />
            <Row label={t('detail.userCount')} value={String(org.userCount)} />
            <Row label={t('organizations.registeredAt')} value={formatDateTime(org.registeredAt)} />
            <Row label={t('detail.createdAt')} value={formatDateTime(org.createdAt)} />
            <Row label={t('detail.updatedAt')} value={formatDateTime(org.updatedAt)} />
          </CardContent>
        </Card>

        {/* --- Owner --- */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-semibold">{t('detail.ownerInfo')}</h2>
            <Row label={t('organizations.owner')} value={org.owner?.fullName ?? '—'} />
            <Row label={t('organizations.email')} value={org.owner?.email ?? '—'} />
            <Row label={t('detail.phone')} value={org.owner?.phone ?? '—'} />
            <Row label={t('detail.ownerStatus')} value={org.owner?.status ?? '—'} />
            <Row
              label={t('detail.lastLoginAt')}
              value={org.owner?.lastLoginAt ? formatDateTime(org.owner.lastLoginAt) : '—'}
            />
          </CardContent>
        </Card>
      </div>

      {/* --- Kết quả duyệt gần nhất --- */}
      {(org.approvedAt || org.rejectedAt) && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-semibold">{t('detail.reviewResult')}</h2>
            {org.approvedAt && (
              <Row label={t('detail.approvedAt')} value={formatDateTime(org.approvedAt)} />
            )}
            {org.rejectedAt && (
              <>
                <Row label={t('detail.rejectedAt')} value={formatDateTime(org.rejectedAt)} />
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="mb-1 text-xs font-medium text-destructive">
                    {t('reject.reason')}
                  </p>
                  <p className="text-sm">{org.rejectedReason}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Audit Log (§13) --- */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-semibold">{t('detail.auditLog')}</h2>
          {org.approvalLogs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('detail.auditEmpty')}
            </p>
          ) : (
            <div className="space-y-2">
              {org.approvalLogs.map((log) => (
                <div key={log.id} className="flex flex-wrap gap-2 border-b pb-2 text-sm last:border-0">
                  <span className="w-40 shrink-0 text-muted-foreground">
                    {formatDateTime(log.createdAt)}
                  </span>
                  <span className="font-medium">{t(`action.${log.action}`)}</span>
                  <span className="text-muted-foreground">
                    {log.oldStatus} → {log.newStatus}
                  </span>
                  <span className="text-muted-foreground">· {log.operatorEmail}</span>
                  {log.reason && <p className="w-full text-xs text-destructive">{log.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ApproveDialog
        organization={approveOpen ? org : null}
        pending={approve.isPending}
        onClose={() => setApproveOpen(false)}
        onConfirm={() =>
          void approve
            .mutateAsync(org.id)
            .then((result) => {
              notify(t('approve.done', { name: org.name }), result.emailSent);
              setApproveOpen(false);
            })
            .catch((error: unknown) => toast.error(translateApiError(error)))
        }
      />

      <RejectDialog
        organization={rejectOpen ? org : null}
        pending={reject.isPending}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reason) =>
          void reject
            .mutateAsync({ id: org.id, reason })
            .then((result) => {
              notify(t('reject.done', { name: org.name }), result.emailSent);
              setRejectOpen(false);
            })
            .catch((error: unknown) => toast.error(translateApiError(error)))
        }
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}
