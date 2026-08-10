'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { useApiError } from '@/hooks/use-api-error';
import { downloadBase64Xlsx, downloadErrorCsv, uploadXlsx } from '../service';
import type { ImportResult } from '../types';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Endpoint import, vd '/accounts/import' hoặc '/orders/import/update'. */
  path: string;
  title: string;
  description?: string;
  /** Gọi lại khi import xong (để refetch danh sách). */
  onImported?: () => void;
}

export function ImportDialog({ open, onClose, path, title, description, onImported }: ImportDialogProps) {
  const { t } = useTranslation();
  const translateApiError = useApiError();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setUploading(false);
    setProgress(0);
    setResult(null);
    setErrorMsg(null);
  }, []);

  const close = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      toast.error(t('importExport.onlyXlsx'));
      return;
    }
    setFile(f);
    setResult(null);
    setErrorMsg(null);
  };

  const doImport = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await uploadXlsx(path, file, setProgress);
      setResult(res);
      if (res.failed === 0) {
        toast.success(t('importExport.success'), {
          description: t('importExport.successDetail', {
            created: res.created,
            updated: res.updated,
            skipped: res.skipped,
          }),
        });
        onImported?.();
      } else {
        toast.error(t('importExport.failedRows', { count: res.failed }));
      }
    } catch (err) {
      setErrorMsg(translateApiError(err));
      toast.error(t('importExport.failed'), { description: translateApiError(err) });
    } finally {
      setUploading(false);
    }
  };

  const succeeded = result && result.failed === 0;

  return (
    <Modal open={open} onClose={close} title={title} description={description}>
      <div className="space-y-4">
        {/* Drag & drop */}
        {!result && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <>
                <FileSpreadsheet className="size-8 text-emerald-600" />
                <p className="text-sm font-medium">{file.name}</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  <X className="size-3" /> {t('importExport.pickAnother')}
                </button>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t('importExport.dropHere')}</p>
                <p className="text-xs text-muted-foreground">{t('importExport.orClick')}</p>
              </>
            )}
          </div>
        )}

        {/* Progress */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('state.processing')}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(8, progress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Structural error */}
        {errorMsg && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMsg}
          </p>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {succeeded ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <X className="size-5 text-destructive" />
              )}
              {t(succeeded ? 'importExport.success' : 'importExport.failedRollback')}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label={t('importExport.totalRows')} value={result.total} />
              <Stat label="Insert" value={result.created} tone="success" />
              <Stat label="Update" value={result.updated} tone="success" />
              <Stat label="Skip" value={result.skipped} tone="muted" />
              <Stat
                label={t('importExport.errors')}
                value={result.failed}
                tone={result.failed ? 'danger' : 'muted'}
              />
            </div>

            {result.durationMs !== undefined && (
              <p className="text-xs text-muted-foreground">
                {t('importExport.duration', {
                  value: formatDuration(result.durationMs, (v) =>
                    t('importExport.seconds', { value: v }),
                  ),
                })}
              </p>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('importExport.errorList', { count: result.errors.length })}
                  </span>
                  {result.errorFile ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadBase64Xlsx(
                          result.errorFile as string,
                          result.errorFileName ?? 'import-errors.xlsx',
                        )
                      }
                    >
                      {t('importExport.downloadXlsx')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadErrorCsv(result.errors, 'import-errors.csv')}
                    >
                      {t('importExport.downloadCsv')}
                    </Button>
                  )}
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1.5">{t('importExport.sheet')}</th>
                        <th className="px-2 py-1.5">{t('importExport.row')}</th>
                        <th className="px-2 py-1.5">{t('importExport.column')}</th>
                        <th className="px-2 py-1.5">{t('importExport.error')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5 text-muted-foreground">{e.sheet ?? '—'}</td>
                          <td className="px-2 py-1.5 tabular-nums">{e.row || '—'}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{e.field ?? '—'}</td>
                          <td className="px-2 py-1.5">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={uploading}>
            {t(result ? 'action.close' : 'action.cancel')}
          </Button>
          {!result && (
            <Button onClick={doImport} disabled={!file || uploading}>
              {uploading && <Loader2 className="size-4 animate-spin" />}
              Import
            </Button>
          )}
          {result && (
            <Button variant="secondary" onClick={reset}>
              {t('importExport.importAnother')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 1234 → "1.23 giây" / "1.23 s"; dưới 1 giây giữ nguyên mili giây.
 * Nhận sẵn mẫu câu đã dịch vì hàm nằm ngoài component nên không dùng được hook.
 */
function formatDuration(ms: number, secondsTemplate: (value: string) => string): string {
  return ms < 1000 ? `${ms} ms` : secondsTemplate((ms / 1000).toFixed(2));
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' | 'muted' }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p
        className={cn(
          'text-lg font-bold tabular-nums',
          tone === 'success' && 'text-emerald-600',
          tone === 'danger' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
