'use client';

import { useState } from 'react';
import { Download, FileDown, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ImportDialog } from '@/features/import-export/components/import-dialog';
import { useApiError } from '@/hooks/use-api-error';
import { employeeService } from '../services/employee.service';
import type { EmployeeQuery } from '../types';

interface EmployeeImportExportBarProps {
  /** Filter đang áp dụng ở màn hình danh sách — export sẽ dùng đúng filter này. */
  query: EmployeeQuery;
  /** Gọi lại sau khi import thành công (reload danh sách). */
  onImported: () => void;
}

/**
 * Thanh công cụ Import/Export Excel cho màn hình Employee (chỉ hiển thị trong RequireAdmin).
 * Tái sử dụng ImportDialog dùng chung (drag & drop, progress, kết quả, file lỗi).
 */
export function EmployeeImportExportBar({ query, onImported }: EmployeeImportExportBarProps) {
  const { t } = useTranslation(['employee', 'common']);
  const translateApiError = useApiError();
  const [busy, setBusy] = useState<'export' | 'template' | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const run = async (kind: 'export' | 'template', action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      toast.error(t('common:action.downloadFailed'), { description: translateApiError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => run('export', () => employeeService.exportExcel(query))}
      >
        {busy === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        Export Excel
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => run('template', () => employeeService.downloadTemplate())}
      >
        {busy === 'template' ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        Download Template
      </Button>

      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
        <Upload className="size-4" />
        Import Excel
      </Button>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        path="/employees/import"
        title={t('importTitle')}
        description={t('importDescription')}
        onImported={onImported}
      />
    </div>
  );
}
