'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileSearch, RotateCcw } from 'lucide-react';
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
import { JobProgressBar } from '@/features/pod-listing/components/job-progress-bar';
import { JobLogDialog } from '@/features/pod-listing/components/job-log-dialog';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import {
  useListingJobs,
  useRetryListingJob,
} from '@/features/pod-listing/hooks/use-pod-listing';
import {
  POD_LISTING_JOB_STATUSES,
  POD_LISTING_JOB_TYPES,
} from '@/features/pod-listing/types';
import type { PodListingJobStatus, PodListingJobType } from '@/features/pod-listing/types';

export default function PublishHistoryPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.listing.read" message={t('listing.common.noPermission')}>
      <PublishHistoryView />
    </RequirePermission>
  );
}

/**
 * **POD → Publish History** — nhật ký từng LƯỢT chạy lên TikTok.
 *
 * Một dòng = một lượt bấm nút: tổng, thành công, thất bại, thời lượng, thời điểm. Mở ra thì
 * thấy từng sản phẩm trong lượt, log theo bước, và response TikTok đã trả về.
 *
 * 🔴 Cấp độ LƯỢT chứ không phải cấp độ sản phẩm: người vận hành chạy 500 sản phẩm rồi hỏi
 * "lượt đó ra sao" — một bảng 500 dòng không trả lời được câu đó. Chi tiết từng sản phẩm
 * nằm một cú bấm bên trong, đúng chỗ nó cần đến.
 */
function PublishHistoryView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const canPublish = hasPermission('pod.listing.publish');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodListingJobStatus | ''>('');
  // Mặc định hiện CẢ HAI loại: màn hình này là nhật ký của mọi lượt đã đẩy lên sàn, và lọc
  // sẵn về PUBLISH thì trước lượt publish đầu tiên nó trông như chưa từng có gì xảy ra.
  const [type, setType] = useState<PodListingJobType | ''>('');
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const retry = useRetryListingJob();
  const jobs = useListingJobs({
    page,
    limit: 20,
    search: search || undefined,
    status: status || undefined,
    type: type || undefined,
  });

  const items = jobs.data?.items ?? [];

  return (
    <>
      <TemplatePageShell
        title={t('listing.publishHistory.title')}
        subtitle={t('listing.publishHistory.subtitle')}
        loading={jobs.isLoading}
        error={jobs.error}
        empty={items.length === 0}
        emptyMessage={t('listing.publishHistory.empty')}
        meta={jobs.data?.meta ?? null}
        onPageChange={setPage}
        searchPlaceholder={t('listing.jobs.searchPlaceholder')}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        filters={
          <>
            <Combobox
              value={type}
              className="w-[180px]"
              onChange={(value) => {
                setType(value as PodListingJobType | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('listing.publishHistory.allTypes') },
                ...POD_LISTING_JOB_TYPES.map((value) => ({
                  value,
                  label: t(`listing.publishHistory.type.${value}`),
                })),
              ]}
            />
            <Combobox
              value={status}
              className="w-[190px]"
              onChange={(value) => {
                setStatus(value as PodListingJobStatus | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('listing.jobs.allStatuses') },
                ...POD_LISTING_JOB_STATUSES.map((value) => ({
                  value,
                  label: t(`listing.jobs.status.${value}`),
                })),
              ]}
            />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.jobs.name')}</TableHead>
              <TableHead>{t('listing.common.shop')}</TableHead>
              <TableHead className="text-right">{t('listing.jobs.items')}</TableHead>
              <TableHead className="text-right">{t('listing.jobs.success')}</TableHead>
              <TableHead className="text-right">{t('listing.jobs.failed')}</TableHead>
              <TableHead className="w-[160px]">{t('listing.jobs.progress')}</TableHead>
              <TableHead>{t('listing.jobs.duration')}</TableHead>
              <TableHead>{t('listing.jobs.createdAt')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="max-w-[260px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{job.name}</span>
                    <ListingStatusBadge
                      status={job.status}
                      label={t(`listing.jobs.status.${job.status}`)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`listing.publishHistory.type.${job.type ?? 'CREATE_DRAFT'}`)} · {job.market}
                    {/* Lượt chạy từ một Listing Session mở lại được đúng lượt đăng đó. */}
                    {job.sessionId && (
                      <>
                        {' · '}
                        <Link
                          href={`/dashboard/pod/auto-listing/${job.sessionId}`}
                          className="hover:underline"
                        >
                          {t('listing.sessions.title')}
                        </Link>
                      </>
                    )}
                  </p>
                </TableCell>
                <TableCell className="max-w-[180px] text-sm">
                  <span className="line-clamp-2">
                    {(job.shops ?? []).map((shop) => shop.name).join(', ') || '—'}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{job.totalItems}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">
                  {job.successItems}
                </TableCell>
                <TableCell className="text-right tabular-nums text-destructive">
                  {job.failedItems}
                </TableCell>
                <TableCell>
                  <JobProgressBar job={job} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {job.durationMs === null ? '—' : `${(job.durationMs / 1000).toFixed(1)}s`}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDateTime(job.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('listing.publishHistory.viewDetail')}
                      onClick={() => setOpenJobId(job.id)}
                    >
                      <FileSearch className="size-4" />
                    </Button>
                    {canPublish && job.failedItems > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('listing.jobs.retryFailed')}
                        disabled={retry.isPending}
                        onClick={() =>
                          void retry
                            .mutateAsync({ id: job.id })
                            .then(() => toast.success(t('listing.jobs.retryStarted')))
                            .catch((error: unknown) => toast.error(translateApiError(error)))
                        }
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TemplatePageShell>

      <JobLogDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />
    </>
  );
}
