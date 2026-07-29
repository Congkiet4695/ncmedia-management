'use client';

import { useState } from 'react';
import { Download, FileDown, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ImportDialog } from '@/features/import-export/components/import-dialog';
import { getApiErrorMessage } from '@/utils/http';
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
  const [busy, setBusy] = useState<'export' | 'template' | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const run = async (kind: 'export' | 'template', action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      toast.error('Tải file thất bại', { description: getApiErrorMessage(error) });
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
        title="Import nhân viên từ Excel"
        description="Email chưa có → tạo mới (mật khẩu sinh ngẫu nhiên); email đã có trong tổ chức → cập nhật. Chỉ cần 1 dòng lỗi là toàn bộ bị rollback."
        onImported={onImported}
      />
    </div>
  );
}
