'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import {
  useExportPodTemplates,
  useImportPodTemplates,
  type PodTemplateKind,
} from '../hooks/use-pod-listing';
import type { PodTemplateBundle, PodTemplateQuery } from '../types';

interface TemplateTransferBarProps {
  kind: PodTemplateKind;
  /** Bộ lọc đang áp trên màn hình — Export đúng những gì người dùng đang nhìn thấy. */
  query: PodTemplateQuery;
  canExport: boolean;
  canImport: boolean;
}

/**
 * Nút Import / Export dùng chung cho cả sáu màn hình template.
 *
 * Gói mang đi là **JSON**, không phải Excel: một Category Template mang cây thuộc tính
 * nhiều giá trị, một SKU Template mang nhiều trục biến thể — ép xuống lưới hai chiều là
 * mất cấu trúc. (Riêng BẢNG SKU vẫn có Import/Export Excel, nằm trong form SKU Template.)
 *
 * Export lấy theo đúng bộ lọc đang xem, để "xuất cái tôi đang nhìn" đúng như trực giác.
 */
export function TemplateTransferBar({
  kind,
  query,
  canExport,
  canImport,
}: TemplateTransferBarProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const exportBundle = useExportPodTemplates(kind);
  const importBundle = useImportPodTemplates(kind);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const handleExport = async () => {
    try {
      const bundle = await exportBundle.mutateAsync(query);
      toast.success(t('listing.transfer.exported', { count: bundle.count }));
    } catch (error) {
      toast.error(t('listing.transfer.exportFailed'), { description: translateApiError(error) });
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const bundle = parseBundle(await file.text());
      const result = await importBundle.mutateAsync(bundle);

      if (result.failed > 0) {
        toast.error(t('listing.transfer.importPartial', { created: result.created, failed: result.failed }), {
          description: result.errors
            .slice(0, 3)
            .map((error) => `#${error.index + 1} ${error.name ?? ''}: ${error.message}`)
            .join(' · '),
        });
      } else {
        toast.success(t('listing.transfer.imported', { count: result.created }));
      }
      // Cảnh báo là tham chiếu bị bỏ (kho / file / template con không có ở tổ chức này).
      // Nói ra thay vì im lặng tạo một template thiếu mảnh.
      for (const warning of result.warnings.slice(0, 3)) toast.warning(warning);
    } catch (error) {
      toast.error(t('listing.transfer.importFailed'), { description: translateApiError(error) });
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!canExport && !canImport) return null;
  const busy = exportBundle.isPending || importBundle.isPending || reading;

  return (
    <>
      {canExport && (
        <Button variant="outline" onClick={() => void handleExport()} disabled={busy}>
          {exportBundle.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {t('listing.transfer.export')}
        </Button>
      )}
      {canImport && (
        <>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {importBundle.isPending || reading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {t('listing.transfer.import')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
        </>
      )}
    </>
  );
}

/** Đọc file người dùng chọn. Sai định dạng thì báo NGAY, không gửi rác lên server. */
function parseBundle(raw: string): PodTemplateBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }

  const bundle = parsed as Partial<PodTemplateBundle>;
  if (!bundle || !Array.isArray(bundle.items) || bundle.items.length === 0) {
    throw new Error('Gói không có template nào (thiếu mảng "items").');
  }
  return bundle as PodTemplateBundle;
}
