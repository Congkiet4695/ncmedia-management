'use client';

import { useRef } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { useExportTemplateRows, useImportTemplateRows } from '../hooks/use-pod-listing';
import type { PodRowTransferTemplateKind, PodTemplateImportResult } from '../types';

interface TemplateRowTransferBarProps {
  kind: PodRowTransferTemplateKind;
  /** Row đang chọn trên trang — CHỈ những row này được export. */
  selectedIds: string[];
  canExport: boolean;
  canImport: boolean;
}

/** Số dòng lỗi / cảnh báo hiện trong thông báo — phần còn lại tóm bằng con số. */
const PREVIEW = 3;

/**
 * Export / Import THEO DÒNG (CSV) cho 4 tab Category · SKU · Description · Image.
 *
 * - Export: chỉ các row đã chọn; chưa chọn row nào ⇒ nút bị khoá (không có "xuất tất cả").
 * - Import: file CSV đã export (từ tổ chức này hoặc tổ chức khác) ⇒ backend tạo template cho từng dòng
 *   trong file vào tổ chức đang đăng nhập; không xoá / sửa template khác.
 * - Kết quả không "thành công" khi chỉ một phần được nạp: có dòng lỗi ⇒ báo lỗi kèm số dòng; có cảnh báo
 *   (ảnh / kho bị bỏ) ⇒ báo cảnh báo.
 */
export function TemplateRowTransferBar({
  kind,
  selectedIds,
  canExport,
  canImport,
}: TemplateRowTransferBarProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const exportRows = useExportTemplateRows(kind);
  const importRows = useImportTemplateRows(kind);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    try {
      await exportRows.mutateAsync(selectedIds);
      toast.success(t('listing.transfer.exportedRows', { count: selectedIds.length }));
    } catch (error) {
      toast.error(t('listing.transfer.exportFailed'), { description: translateApiError(error) });
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      reportImport(await importRows.mutateAsync(file));
    } catch (error) {
      toast.error(t('listing.transfer.importFailed'), { description: translateApiError(error) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const reportImport = (result: PodTemplateImportResult) => {
    if (result.failed > 0) {
      toast.error(
        t('listing.transfer.importPartial', { created: result.created, failed: result.failed }),
        {
          description: result.errors
            .slice(0, PREVIEW)
            .map((error) =>
              [
                t('listing.transfer.rowLabel', { row: error.row ?? error.index + 2 }),
                error.name ? `"${error.name}"` : '',
                error.message,
              ]
                .filter(Boolean)
                .join(' · '),
            )
            .join('; '),
        },
      );
    } else if (result.warnings.length > 0) {
      toast.warning(
        t('listing.transfer.importedWithWarnings', {
          count: result.created,
          warnings: result.warnings.length,
        }),
      );
    } else {
      toast.success(t('listing.transfer.imported', { count: result.created }));
    }
    // Cảnh báo = tham chiếu bị bỏ (kho / ảnh không có ở tổ chức này) — nói ra, không im lặng.
    for (const warning of result.warnings.slice(0, PREVIEW)) toast.warning(warning);
  };

  if (!canExport && !canImport) return null;
  const busy = exportRows.isPending || importRows.isPending;

  return (
    <>
      {canExport && (
        <Button
          variant="outline"
          onClick={() => void handleExport()}
          disabled={busy || selectedIds.length === 0}
          title={selectedIds.length === 0 ? t('listing.transfer.selectRowsFirst') : undefined}
        >
          {exportRows.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t('listing.transfer.exportSelected', { count: selectedIds.length })}
        </Button>
      )}
      {canImport && (
        <>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {importRows.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t('listing.transfer.importCsv')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
        </>
      )}
    </>
  );
}
