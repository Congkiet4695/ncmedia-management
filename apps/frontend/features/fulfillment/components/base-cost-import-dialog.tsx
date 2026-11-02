'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useImportBaseCost } from '../hooks/use-fulfillment';
import type { BaseCostImportChange, BaseCostImportResult, FulfillmentStatus } from '../types';

/** Khớp `BASE_COST_IMPORT_MAX_BYTES` / `BASE_COST_IMPORT_MAX_ROWS` của backend (backend vẫn kiểm lại). */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

const BANNER_TONE: Record<BaseCostImportResult['status'], string> = {
  READY: 'bg-success/10 text-success',
  APPLIED: 'bg-success/10 text-success',
  PARTIAL: 'bg-warning/10 text-warning',
  REJECTED: 'bg-destructive/10 text-destructive',
};

/**
 * **Import Base Cost / Tracking Number** (Excel `.xlsx`: `OrderID` · `Basecost` · `Tracking Number`; file cũ 2 cột vẫn
 * dùng được) — chỉ Admin (`fulfillment.basecost.update`).
 *
 * Luồng: chọn file ⇒ server KIỂM TRA và trả bản xem trước (`dryRun`, không ghi) ⇒ Admin bấm Xác nhận ⇒ server kiểm lại
 * từ đầu rồi ghi từng dòng (mỗi dòng một transaction).
 *
 * 🔴 MỘT PHẦN (quyết định PO 2026-11-02): dòng lỗi bị BỎ QUA, dòng hợp lệ vẫn ghi — nên giao diện phải nói rõ trước khi
 * xác nhận (banner vàng "sẽ bỏ qua N dòng") và sau khi ghi (không bao giờ báo thành công tổng thể khi còn dòng lỗi).
 */
export function BaseCostImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const { formatCurrency } = useLocaleFormat();
  const translateApiError = useApiError();
  const importMutation = useImportBaseCost();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BaseCostImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setResult(null);
    setFileError(null);
    importMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ dọn khi đóng
  }, [open]);

  const busy = importMutation.isPending;
  const toWriteOf = (target: BaseCostImportResult) => target.changes.filter((change) => !change.unchanged).length;

  const run = async (target: File, dryRun: boolean) => {
    setFileError(null);
    try {
      const next = await importMutation.mutateAsync({ file: target, dryRun });
      setResult(next);
      if (dryRun) return;
      if (next.status === 'APPLIED') {
        toast.success(t('baseCostImport.applied', { count: next.updatedOrders }));
      } else if (next.status === 'PARTIAL') {
        toast.warning(t('baseCostImport.partialApplied', { count: next.updatedOrders, failed: next.invalidRows + next.writeFailedRows }));
      } else {
        toast.error(t('baseCostImport.rejected', { count: next.invalidRows + next.writeFailedRows }));
      }
    } catch (error) {
      setResult(null);
      setFileError(translateApiError(error));
    }
  };

  const onPick = (picked: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!picked) return;
    setResult(null);
    if (!/\.xlsx$/i.test(picked.name)) {
      setFile(null);
      setFileError(t('baseCostImport.onlyXlsx'));
      return;
    }
    if (picked.size > MAX_BYTES) {
      setFile(null);
      setFileError(t('baseCostImport.tooLarge', { mb: MAX_BYTES / 1024 / 1024 }));
      return;
    }
    setFile(picked);
    void run(picked, true);
  };

  const money = (value: number | null, currency: string | null) =>
    value === null ? '—' : currency ? formatCurrency(value, currency) : String(value);
  const statusLabel = (status: FulfillmentStatus | null) =>
    status ? t(`status.${status}`) : t('baseCostImport.notFulfilledYet');
  const applied = Boolean(result && !result.dryRun);
  const toWrite = result ? toWriteOf(result) : 0;
  const canConfirm =
    Boolean(file) && result?.dryRun === true && (result.status === 'READY' || result.status === 'PARTIAL') && toWrite > 0 && !busy;

  const bannerText = (target: BaseCostImportResult) => {
    const failed = target.invalidRows + target.writeFailedRows;
    switch (target.status) {
      case 'READY':
        return t('baseCostImport.ready', { count: toWriteOf(target) });
      case 'PARTIAL':
        return target.dryRun
          ? t('baseCostImport.partialPreview', { invalid: target.invalidRows, count: toWriteOf(target) })
          : t('baseCostImport.partialApplied', { count: target.updatedOrders, failed });
      case 'REJECTED':
        return t('baseCostImport.rejected', { count: failed });
      default:
        return t('baseCostImport.applied', { count: target.updatedOrders });
    }
  };

  const changeCells = (change: BaseCostImportChange): string[] => [
    String(change.row),
    change.orderId,
    change.action === 'MARK_FULFILLED'
      ? t('baseCostImport.actionValue.MARK_FULFILLED', {
          from: statusLabel(change.statusBefore),
          to: statusLabel(change.statusAfter),
        })
      : t('baseCostImport.actionValue.UPDATE', { status: statusLabel(change.statusBefore) }),
    change.baseCostChanged
      ? `${money(change.before, change.currency)} → ${money(change.after, change.currency)}`
      : `${money(change.before, change.currency)} (${t('baseCostImport.unchanged')})`,
    change.trackingChanged
      ? `${change.trackingBefore ?? '—'} → ${change.trackingAfter ?? '—'}`
      : `${change.trackingBefore ?? '—'} (${t('baseCostImport.unchanged')})`,
    change.unchanged
      ? t('baseCostImport.unchanged')
      : result?.dryRun
        ? t('baseCostImport.result.willWrite')
        : change.applied
          ? t('baseCostImport.result.written')
          : t('baseCostImport.result.notWritten'),
  ];

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      className="max-w-4xl"
      title={t('baseCostImport.title')}
      description={t('baseCostImport.description', { max: MAX_ROWS })}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="space-y-0.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('baseCostImport.formatTitle')}</p>
          <p>{t('baseCostImport.formatColumns')}</p>
          <p>{t('baseCostImport.formatRules')}</p>
          <p>{t('baseCostImport.formatStatus')}</p>
          <p>{t('baseCostImport.formatAtomic')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => onPick(event.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || applied}>
            <Upload className="size-4" />
            {file ? t('baseCostImport.chooseAnother') : t('baseCostImport.choose')}
          </Button>
          {file && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-4 shrink-0" />
              <span className="truncate">{file.name}</span>
            </span>
          )}
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {fileError && (
          <p className="flex items-start gap-1 text-xs text-destructive">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            {fileError}
          </p>
        )}

        {result && (
          <>
            <div className={`flex items-start gap-2 rounded-md p-3 text-xs ${BANNER_TONE[result.status]}`}>
              {result.status === 'REJECTED' ? (
                <XCircle className="mt-0.5 size-4 shrink-0" />
              ) : result.status === 'PARTIAL' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{bannerText(result)}</span>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label={t('baseCostImport.stat.total')} value={result.totalRows} />
              <Stat label={t('baseCostImport.stat.valid')} value={result.validRows} />
              <Stat label={t('baseCostImport.stat.invalid')} value={result.invalidRows} tone="negative" />
              <Stat label={t('baseCostImport.stat.notFound')} value={result.notFoundRows} tone="negative" />
              <Stat label={t('baseCostImport.stat.duplicate')} value={result.duplicateRows} tone="negative" />
              <Stat label={t('baseCostImport.stat.unchanged')} value={result.unchangedRows} />
              <Stat label={t('baseCostImport.stat.baseCost')} value={result.baseCostUpdated} tone="positive" />
              <Stat label={t('baseCostImport.stat.tracking')} value={result.trackingUpdated} tone="positive" />
              <Stat label={t('baseCostImport.stat.marked')} value={result.markedFulfilled} tone="positive" />
              {!result.dryRun && (
                <>
                  <Stat label={t('baseCostImport.stat.updated')} value={result.updatedOrders} tone="positive" />
                  <Stat label={t('baseCostImport.stat.writeFailed')} value={result.writeFailedRows} tone="negative" />
                </>
              )}
            </dl>

            {result.ignoredHeaders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('baseCostImport.ignoredHeaders', { headers: result.ignoredHeaders.join(', ') })}
              </p>
            )}

            {result.errors.length > 0 && (
              <ResultTable
                title={t('baseCostImport.errorsTitle')}
                head={[t('baseCostImport.col.row'), 'OrderID', t('baseCostImport.col.reason')]}
                rows={result.errors.map((error) => [String(error.row), error.orderId ?? '—', error.message])}
              />
            )}

            {result.changes.length > 0 && (
              <ResultTable
                title={t('baseCostImport.changesTitle')}
                head={[
                  t('baseCostImport.col.row'),
                  'OrderID',
                  t('baseCostImport.col.action'),
                  t('baseCostImport.col.baseCost'),
                  t('baseCostImport.col.tracking'),
                  t('baseCostImport.col.result'),
                ]}
                rows={result.changes.map(changeCells)}
              />
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {applied ? t('common:action.close') : t('common:action.cancel')}
          </Button>
          {!applied && (
            <Button onClick={() => file && void run(file, false)} disabled={!canConfirm}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('baseCostImport.confirm', { count: toWrite })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'negative' }) {
  return (
    <div className="rounded-md border p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`text-base font-semibold tabular-nums ${
          value > 0 && tone === 'negative' ? 'text-destructive' : value > 0 && tone === 'positive' ? 'text-success' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function ResultTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <div className="max-h-60 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {head.map((cell) => (
                <th key={cell} className="px-2 py-1 text-left font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1 align-top tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
