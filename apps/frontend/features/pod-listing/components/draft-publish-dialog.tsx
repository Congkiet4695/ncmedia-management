'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from './listing-status-badge';
import type { PodDraftListingDetail } from '../types';

type Tab = 'CONTENT' | 'REQUEST' | 'RESPONSE';

/**
 * Xem một Draft Listing: **nội dung**, **request đã gửi**, **response TikTok trả về**.
 *
 * 🔴 Ba tab chứ không phải một khối JSON: khi TikTok từ chối một sản phẩm, câu hỏi đầu tiên
 * luôn là "hệ thống đã gửi đúng cái mình thấy trên màn hình chưa" — và chỉ trả lời được khi
 * đặt nội dung đã dựng cạnh thân request thật.
 *
 * Request/Response chỉ có sau khi bấm Publish; trước đó hai tab kia nói thẳng là chưa có.
 */
export function DraftPublishDialog({
  draft,
  loading,
  onClose,
}: {
  draft: PodDraftListingDetail | null;
  loading?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();
  const [tab, setTab] = useState<Tab>('CONTENT');

  const open = Boolean(draft) || Boolean(loading);
  if (!open) return null;

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'CONTENT', label: t('listing.drafts.tabContent') },
    { key: 'REQUEST', label: t('listing.drafts.tabRequest') },
    { key: 'RESPONSE', label: t('listing.drafts.tabResponse') },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={draft?.title ?? t('listing.products.previewTitle')}
      className="max-w-3xl"
    >
      {loading || !draft ? (
        <div className="flex justify-center py-14">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ListingStatusBadge
              status={draft.status}
              label={t(`listing.drafts.status.${draft.status}`)}
            />
            {draft.reviewStatus && (
              <ListingStatusBadge
                status={draft.reviewStatus}
                label={t(`listing.drafts.reviewStatus.${draft.reviewStatus}`)}
              />
            )}
            <span>{draft.shop?.name ?? '—'}</span>
            {draft.publishedAt && <span>· {formatDateTime(draft.publishedAt)}</span>}
            {draft.publishRetryCount > 0 && (
              <span>· {t('listing.jobs.retryCount')}: {draft.publishRetryCount}</span>
            )}
          </div>

          {draft.reviewReason && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              {draft.reviewReason}
            </p>
          )}
          {draft.publishError && (
            <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {draft.publishError}
            </p>
          )}

          <div className="flex gap-1 border-b">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={
                  tab === item.key
                    ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                    : 'px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'CONTENT' && <DraftContent draft={draft} />}
          {tab === 'REQUEST' && (
            <JsonBlock value={draft.publishRequest} empty={t('listing.drafts.noRequest')} />
          )}
          {tab === 'RESPONSE' && (
            <JsonBlock value={draft.publishResponse} empty={t('listing.drafts.noResponse')} />
          )}

          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" onClick={onClose}>
              {t('common:action.close')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Nội dung đã dựng — đúng thứ hệ thống gửi lên sàn. */
function DraftContent({ draft }: { draft: PodDraftListingDetail }) {
  const { t } = useTranslation('pod');
  const payload = draft.payload;

  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
      <Row label={t('listing.categoryTemplates.category')} value={payload?.category?.path ?? payload?.category?.name} />
      <Row label={t('listing.categoryTemplates.brand')} value={payload?.brand?.name} />
      <Row label={t('listing.drafts.tiktokDraftId')} value={draft.tiktokDraftId} mono />
      <Row label={t('listing.publishHistory.tiktokProductId')} value={draft.tiktokProductId} mono />

      <div>
        <p className="mb-1 font-medium">{t('listing.products.images', { count: payload?.images?.length ?? 0 })}</p>
        <div className="flex flex-wrap gap-2">
          {(payload?.images ?? []).slice(0, 9).map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${image.fileId || image.url}-${index}`}
              src={image.url}
              alt=""
              className="size-14 rounded border object-cover"
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 font-medium">
          {t('listing.jobs.variants', { count: draft.items?.length ?? 0 })}
        </p>
        <div className="space-y-1">
          {(draft.items ?? []).slice(0, 20).map((item) => (
            <div key={item.id} className="flex justify-between gap-2 border-b py-1 text-xs">
              <span className="truncate">{item.variantName}</span>
              <span className="font-mono">{item.sellerSku}</span>
              <span className="tabular-nums">
                {item.retailPrice ?? '—'} {item.currency ?? ''} · {item.quantity}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value || '—'}</span>
    </div>
  );
}

/** Khối JSON cuộn riêng — bảng rộng không được phép làm cả trang trôi ngang. */
function JsonBlock({ value, empty }: { value: Record<string, unknown> | null; empty: string }) {
  if (!value) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <pre className="max-h-[50vh] overflow-auto rounded bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
