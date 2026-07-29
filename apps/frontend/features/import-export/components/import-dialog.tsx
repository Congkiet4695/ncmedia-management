'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { getApiErrorMessage } from '@/utils/http';
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
      toast.error('Chỉ chấp nhận file .xlsx');
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
        toast.success('Import thành công', {
          description: `Tạo mới ${res.created} · Cập nhật ${res.updated} · Bỏ qua ${res.skipped}`,
        });
        onImported?.();
      } else {
        toast.error(`Import có ${res.failed} dòng lỗi — đã rollback toàn bộ`);
      }
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, 'Import thất bại'));
      toast.error('Import thất bại', { description: getApiErrorMessage(err) });
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
                  <X className="size-3" /> Chọn file khác
                </button>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">Kéo thả file .xlsx vào đây</p>
                <p className="text-xs text-muted-foreground">hoặc bấm để chọn file</p>
              </>
            )}
          </div>
        )}

        {/* Progress */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Đang xử lý…
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
              {succeeded ? 'Import thành công' : 'Import thất bại — đã rollback toàn bộ'}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Tổng dòng" value={result.total} />
              <Stat label="Insert" value={result.created} tone="success" />
              <Stat label="Update" value={result.updated} tone="success" />
              <Stat label="Skip" value={result.skipped} tone="muted" />
              <Stat label="Lỗi" value={result.failed} tone={result.failed ? 'danger' : 'muted'} />
            </div>

            {result.durationMs !== undefined && (
              <p className="text-xs text-muted-foreground">
                Thời gian xử lý: {formatDuration(result.durationMs)}
              </p>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Danh sách lỗi ({result.errors.length})
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
                      Tải file lỗi (.xlsx)
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadErrorCsv(result.errors, 'import-errors.csv')}
                    >
                      Tải file lỗi (.csv)
                    </Button>
                  )}
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1.5">Sheet</th>
                        <th className="px-2 py-1.5">Dòng</th>
                        <th className="px-2 py-1.5">Cột</th>
                        <th className="px-2 py-1.5">Lỗi</th>
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
            {result ? 'Đóng' : 'Hủy'}
          </Button>
          {!result && (
            <Button onClick={doImport} disabled={!file || uploading}>
              {uploading && <Loader2 className="size-4 animate-spin" />}
              Import
            </Button>
          )}
          {result && (
            <Button variant="secondary" onClick={reset}>
              Import file khác
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** 1234 → "1.23 giây"; < 1s giữ nguyên mili giây. */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} giây`;
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
