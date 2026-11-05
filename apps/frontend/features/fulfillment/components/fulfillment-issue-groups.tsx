'use client';

import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { hasIssueHint, type FulfillmentIssueEntry, type FulfillmentIssueGroup } from '../issue-summary';

interface FulfillmentIssueGroupsProps {
  groups: FulfillmentIssueGroup[];
  /** Nhóm đang mở — drawer giữ state để nút "Xem chi tiết" ở footer mở được từ xa. */
  openKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

/**
 * Lỗi / cảnh báo của một khối trong drawer Fulfill: mỗi mã lỗi MỘT dòng tóm tắt kèm số lượng; bấm mới
 * mở danh sách chi tiết (có giới hạn chiều cao, cuộn riêng) nên không làm vỡ bố cục dù có bao nhiêu mục.
 * Không mất thông tin: mở ra là thấy đầy đủ, không cắt `ellipsis`.
 */
export function FulfillmentIssueGroups({ groups, openKeys, onToggle }: FulfillmentIssueGroupsProps) {
  const { t } = useTranslation(['fulfillment']);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-1.5" data-fulfillment-issues>
      {groups.map((group) => {
        const open = openKeys.has(group.key);
        const isError = group.severity === 'error';
        const Icon = isError ? AlertTriangle : Info;
        return (
          <div
            key={group.key}
            className={cn(
              'rounded-md text-xs',
              isError ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
            )}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(group.key)}
              className="flex w-full items-center gap-1.5 rounded-md p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 font-medium">
                {t(`fulfill.issue.code.${group.code}`, {
                  defaultValue: t('fulfill.issue.unknownTitle'),
                })}{' '}
                ({group.entries.length})
              </span>
              <span className="flex shrink-0 items-center gap-0.5 font-normal">
                {open ? t('fulfill.issue.hideDetails') : t('fulfill.issue.showDetails')}
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </span>
            </button>

            {open && (
              <div className="space-y-1.5 px-2 pb-2">
                {hasIssueHint(group.code) && <p>{t(`fulfill.issue.hint.${group.code}`)}</p>}
                <ul className="max-h-60 space-y-1 overflow-y-auto rounded bg-card p-1.5 text-foreground">
                  {group.entries.map((entry) => (
                    <IssueEntry key={entry.key} entry={entry} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IssueEntry({ entry }: { entry: FulfillmentIssueEntry }) {
  const { t } = useTranslation(['fulfillment', 'pod']);
  return (
    <li className="space-y-0.5 rounded border p-1.5">
      {entry.productName && <p className="break-words font-medium">{entry.productName}</p>}
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <EntryField label={t('pod:product.productId')} value={entry.productId} mono />
        <EntryField label={t('fulfill.issue.sellerSku')} value={entry.sellerSku} mono />
        {!entry.sellerSku && <EntryField label={t('fulfill.issue.skuId')} value={entry.skuId} mono />}
        <EntryField label={t('pod:product.variant')} value={entry.skuNames.join(' · ') || null} />
        {entry.lineCount > 1 && (
          <EntryField label={t('fulfill.issue.lineCount')} value={String(entry.lineCount)} />
        )}
      </dl>
      {!entry.structured && <p className="break-words">{entry.message}</p>}
    </li>
  );
}

function EntryField({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0">{label}:</dt>
      <dd className={mono ? 'break-all font-mono' : 'break-words'}>{value}</dd>
    </div>
  );
}
