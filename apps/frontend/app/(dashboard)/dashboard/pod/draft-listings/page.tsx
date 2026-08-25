'use client';

import { useState } from 'react';
import { Eye, ImageOff, Loader2, RefreshCw, Rocket, RotateCcw, Trash2 } from 'lucide-react';
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
import { DraftPublishDialog } from '@/features/pod-listing/components/draft-publish-dialog';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { PublishProgressCard } from '@/features/pod-listing/components/publish-progress-card';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import {
  useCancelListingJob,
  useDeleteDraft,
  useDraftListing,
  useDraftListings,
  useListingJob,
  usePublishDrafts,
  useRetryListingJob,
  useSyncReviewStatus,
} from '@/features/pod-listing/hooks/use-pod-listing';
import {
  POD_DRAFT_STATUSES,
  POD_LISTING_MARKETS,
  POD_REVIEW_STATUSES,
} from '@/features/pod-listing/types';
import type {
  PodDraftListing,
  PodDraftStatus,
  PodListingMarket,
  PodReviewStatus,
} from '@/features/pod-listing/types';

export default function DraftListingsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.draft.read" message={t('listing.common.noPermission')}>
      <DraftListingsView />
    </RequirePermission>
  );
}

/**
 * **POD → Draft Listings** — nơi Draft đã dựng xong được đưa lên sàn.
 *
 * ```
 *   Draft Listing (đã có trên TikTok ở dạng Draft)
 *        ↓ Publish Selected / Publish All
 *        ↓ Edit Product (save_mode = LISTING)   ← KHÔNG tạo sản phẩm mới
 *        ↓ chờ TikTok duyệt
 *        ↓ Review Status tự cập nhật (scheduler 5 phút/lần)
 * ```
 *
 * 🔴 Hai cột trạng thái, không phải một: **Publish Status** là hệ thống đã gửi tới đâu,
 * **Review Status** là TikTok đã xử lý tới đâu. Gộp lại thì một sản phẩm bị từ chối vẫn hiện
 * xanh vì "đã gửi thành công" — đúng về kỹ thuật, vô dụng với người bán hàng.
 *
 * 🔴 Lỗi hiển thị THEO TỪNG DÒNG, không popup cả lượt: một lượt 500 sản phẩm hỏng 12 cái thì
 * thứ người vận hành cần là biết 12 cái nào và vì sao, không phải một hộp thoại báo "có lỗi".
 */
function DraftListingsView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const canPublish = hasPermission('pod.listing.publish');
  const canDelete = hasPermission('pod.draft.generate');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodDraftStatus | ''>('');
  const [reviewStatus, setReviewStatus] = useState<PodReviewStatus | ''>('');
  const [market, setMarket] = useState<PodListingMarket | ''>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** Lượt publish vừa tạo — thẻ tiến độ bám theo id này cho tới khi job dừng. */
  const [jobId, setJobId] = useState<string | null>(null);

  const job = useListingJob(jobId ?? undefined);
  const running = job.data?.status === 'PENDING' || job.data?.status === 'PROCESSING';

  const drafts = useDraftListings(
    {
      page,
      limit: 20,
      search: search || undefined,
      status: status || undefined,
      reviewStatus: reviewStatus || undefined,
      market: market || undefined,
    },
    // Job đang chạy ⇒ bảng tự làm mới để trạng thái từng dòng đổi ngay trước mắt.
    running,
  );
  const preview = useDraftListing(previewId ?? undefined);

  const publish = usePublishDrafts();
  const cancelJob = useCancelListingJob();
  const retryJob = useRetryListingJob();
  const syncReview = useSyncReviewStatus();
  const removeDraft = useDeleteDraft();

  const items = drafts.data?.items ?? [];
  // Chỉ cho chọn cái publish được: tick vào một Draft đã publish rồi bấm nút chỉ để nhận về
  // "đã bỏ qua" là một vòng lặp vô ích.
  const publishable = items.filter(isPublishable);
  const allSelected = publishable.length > 0 && selected.length === publishable.length;

  /** `draftIds` có giá trị = Publish Selected; bỏ trống = Publish All theo bộ lọc hiện tại. */
  const startPublish = (draftIds?: string[]): void => {
    const message = draftIds?.length
      ? t('listing.publish.confirmSelected', { count: draftIds.length })
      : t('listing.publish.confirmAll');
    if (!window.confirm(message)) return;

    void publish
      .mutateAsync(
        draftIds?.length
          ? { draftIds }
          : // Publish All đi theo ĐÚNG bộ lọc đang hiển thị — người dùng thấy gì thì gửi nấy.
            {
              status: status || undefined,
              search: search || undefined,
              market: market || undefined,
            },
      )
      .then((result) => {
        setJobId(result.id);
        setSelected([]);
        toast.success(t('listing.publish.started', { count: result.totalItems }), {
          description:
            result.skipped.length > 0
              ? t('listing.publish.skipped', {
                  count: result.skipped.length,
                  reason: result.skipped[0]?.reason ?? '',
                })
              : undefined,
        });
      })
      .catch((error: unknown) => toast.error(translateApiError(error)));
  };

  return (
    <>
      {jobId && job.data && (
        <div className="mb-4">
          <PublishProgressCard
            job={job.data}
            canRun={canPublish}
            onCancel={() =>
              void cancelJob
                .mutateAsync(jobId)
                .then(() => toast.success(t('listing.jobs.cancelled')))
                .catch((error: unknown) => toast.error(translateApiError(error)))
            }
            onRetry={() =>
              void retryJob
                .mutateAsync({ id: jobId })
                .then(() => toast.success(t('listing.jobs.retryStarted')))
                .catch((error: unknown) => toast.error(translateApiError(error)))
            }
          />
        </div>
      )}

      <TemplatePageShell
        title={t('listing.drafts.title')}
        subtitle={t('listing.drafts.subtitle')}
        loading={drafts.isLoading}
        error={drafts.error}
        empty={items.length === 0}
        emptyMessage={t('listing.drafts.empty')}
        meta={drafts.data?.meta ?? null}
        onPageChange={setPage}
        searchPlaceholder={t('listing.products.searchPlaceholder')}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        filters={
          <>
            {/* Một lượt chạy mang MỘT thị trường: server từ chối lô trộn thị trường, nên bộ
                lọc này là đường thoát — không có nó, Publish All bế tắc ở tổ chức bán đa vùng. */}
            <Combobox
              value={market}
              className="w-[140px]"
              onChange={(value) => {
                setMarket(value as PodListingMarket | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('listing.filters.allMarkets') },
                ...POD_LISTING_MARKETS.map((value) => ({ value, label: value })),
              ]}
            />
            <Combobox
              value={status}
              className="w-[180px]"
              onChange={(value) => {
                setStatus(value as PodDraftStatus | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('listing.drafts.allPublishStatuses') },
                ...POD_DRAFT_STATUSES.map((value) => ({
                  value,
                  label: t(`listing.drafts.status.${value}`),
                })),
              ]}
            />
            <Combobox
              value={reviewStatus}
              className="w-[180px]"
              onChange={(value) => {
                setReviewStatus(value as PodReviewStatus | '');
                setPage(1);
              }}
              options={[
                { value: '', label: t('listing.drafts.allReviewStatuses') },
                ...POD_REVIEW_STATUSES.map((value) => ({
                  value,
                  label: t(`listing.drafts.reviewStatus.${value}`),
                })),
              ]}
            />
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={syncReview.isPending}
              title={t('listing.drafts.syncReviewHint')}
              onClick={() =>
                void syncReview
                  .mutateAsync(undefined)
                  .then((result) =>
                    toast.success(
                      t('listing.drafts.syncReviewDone', {
                        checked: result.checked,
                        changed: result.changed,
                      }),
                    ),
                  )
                  .catch((error: unknown) => toast.error(translateApiError(error)))
              }
            >
              {syncReview.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t('listing.drafts.syncReview')}
            </Button>

            {canPublish && (
              <>
                <Button
                  variant="outline"
                  disabled={publish.isPending || running}
                  onClick={() => startPublish(undefined)}
                >
                  {t('listing.publish.all')}
                </Button>
                <Button
                  disabled={selected.length === 0 || publish.isPending || running}
                  onClick={() => startPublish(selected)}
                >
                  {publish.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Rocket className="size-4" />
                  )}
                  {t('listing.publish.selected', { count: selected.length })}
                </Button>
              </>
            )}
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  aria-label={t('listing.publish.selectAll')}
                  checked={allSelected}
                  disabled={publishable.length === 0}
                  onChange={() =>
                    setSelected(allSelected ? [] : publishable.map((draft) => draft.id))
                  }
                />
              </TableHead>
              <TableHead className="w-[64px]">{t('listing.products.thumbnail')}</TableHead>
              <TableHead>{t('listing.products.title')}</TableHead>
              <TableHead>{t('listing.common.shop')}</TableHead>
              <TableHead>{t('listing.drafts.tiktokDraftId')}</TableHead>
              <TableHead>{t('listing.publishHistory.tiktokProductId')}</TableHead>
              <TableHead>{t('listing.drafts.publishStatus')}</TableHead>
              <TableHead>{t('listing.drafts.reviewStatusColumn')}</TableHead>
              <TableHead>{t('listing.jobs.createdAt')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((draft) => {
              const selectable = isPublishable(draft);
              const thumbnail = draft.sessionProduct?.images?.[0]?.imageUrl;
              return (
                <TableRow key={draft.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={selected.includes(draft.id)}
                      onChange={() =>
                        setSelected((prev) =>
                          prev.includes(draft.id)
                            ? prev.filter((id) => id !== draft.id)
                            : [...prev, draft.id],
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnail} alt="" className="size-10 rounded border object-cover" />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded border bg-muted">
                        <ImageOff className="size-4 text-muted-foreground" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate font-medium">{draft.title ?? '—'}</p>
                    {draft.publishError && (
                      <p className="line-clamp-2 text-xs text-destructive">{draft.publishError}</p>
                    )}
                    {draft.reviewReason && !draft.publishError && (
                      <p className="line-clamp-2 text-xs text-amber-600">{draft.reviewReason}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{draft.shop?.name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{draft.tiktokDraftId ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{draft.tiktokProductId ?? '—'}</TableCell>
                  <TableCell>
                    <ListingStatusBadge
                      status={draft.status}
                      label={t(`listing.drafts.status.${draft.status}`)}
                    />
                  </TableCell>
                  <TableCell>
                    {draft.reviewStatus ? (
                      <ListingStatusBadge
                        status={draft.reviewStatus}
                        label={t(`listing.drafts.reviewStatus.${draft.reviewStatus}`)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(draft.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('listing.products.preview')}
                        onClick={() => setPreviewId(draft.id)}
                      >
                        <Eye className="size-4" />
                      </Button>

                      {canPublish && selectable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={publish.isPending || running}
                          title={
                            draft.publishError
                              ? t('listing.publish.retryOne')
                              : t('listing.publish.one')
                          }
                          onClick={() => startPublish([draft.id])}
                        >
                          {draft.publishError ? (
                            <RotateCcw className="size-4" />
                          ) : (
                            <Rocket className="size-4" />
                          )}
                        </Button>
                      )}

                      {canDelete && selectable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('listing.drafts.delete')}
                          onClick={() => {
                            // Draft đã có trên sàn ⇒ xoá cả bên TikTok, không để lại bản mồ côi
                            // trong Seller Center mà hệ thống không còn theo dõi.
                            const remote = Boolean(draft.tiktokDraftId);
                            if (
                              !window.confirm(
                                remote
                                  ? t('listing.drafts.deleteRemoteConfirm')
                                  : t('listing.drafts.deleteConfirm'),
                              )
                            ) {
                              return;
                            }
                            void removeDraft
                              .mutateAsync({ id: draft.id, remote })
                              .then(() => toast.success(t('listing.drafts.deleted')))
                              .catch((error: unknown) => toast.error(translateApiError(error)));
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TemplatePageShell>

      <DraftPublishDialog
        draft={preview.data ?? null}
        loading={Boolean(previewId) && preview.isLoading}
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}

/**
 * Draft nào được phép publish — **cùng bộ điều kiện với server**.
 *
 * DRAFT/READY = còn nằm ở database · TIKTOK_DRAFT = đã có trên sàn. Không lấy PUBLISHED (đã
 * gửi rồi), PUBLISHING (đang chạy), FAILED (draft lỗi), ARCHIVED.
 *
 * 🔴 Lệch với server là nút Publish báo lỗi ngay sau khi người dùng bấm — nên hai danh sách
 * phải nói cùng một điều.
 */
function isPublishable(draft: PodDraftListing): boolean {
  return (
    draft.errorCount === 0 &&
    (draft.status === 'DRAFT' || draft.status === 'READY' || draft.status === 'TIKTOK_DRAFT')
  );
}
