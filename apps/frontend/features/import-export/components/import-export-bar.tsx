'use client';

import { useState } from 'react';
import { Download, FileDown, FileUp, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { downloadXlsx } from '../service';
import { ImportDialog } from './import-dialog';

interface ImportExportBarProps {
  entity: string; // 'Account' | 'Order' (nhãn hiển thị)
  exportExamplePath: string;
  exportPath: string;
  importPath: string;
  importUpdatePath: string;
  exampleFilename: string;
  exportFilename: string;
  /** Gate theo quyền: xuất (example + export) và nhập (import + import-update). */
  canExport: boolean;
  canImport: boolean;
  canImportUpdate: boolean;
  onImported?: () => void;
}

export function ImportExportBar({
  entity,
  exportExamplePath,
  exportPath,
  importPath,
  importUpdatePath,
  exampleFilename,
  exportFilename,
  canExport,
  canImport,
  canImportUpdate,
  onImported,
}: ImportExportBarProps) {
  const { t } = useTranslation();
  const translateApiError = useApiError();
  const [busy, setBusy] = useState<'example' | 'export' | null>(null);
  const [dialog, setDialog] = useState<'import' | 'update' | null>(null);

  const download = async (kind: 'example' | 'export', path: string, filename: string) => {
    setBusy(kind);
    try {
      await downloadXlsx(path, filename);
    } catch (err) {
      toast.error(t('action.downloadFailed'), { description: translateApiError(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!canExport && !canImport && !canImportUpdate) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canExport && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => download('example', exportExamplePath, exampleFilename)}
          >
            {busy === 'example' ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            Export Example
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => download('export', exportPath, exportFilename)}
          >
            {busy === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export
          </Button>
        </>
      )}
      {canImport && (
        <Button variant="outline" size="sm" onClick={() => setDialog('import')}>
          <Upload className="size-4" />
          Import Excel
        </Button>
      )}
      {canImportUpdate && (
        <Button variant="outline" size="sm" onClick={() => setDialog('update')}>
          <FileUp className="size-4" />
          Import Update
        </Button>
      )}

      <ImportDialog
        open={dialog === 'import'}
        onClose={() => setDialog(null)}
        path={importPath}
        title={t('importExport.importTitle', { entity })}
        description={t('importExport.createDescription')}
        onImported={onImported}
      />
      <ImportDialog
        open={dialog === 'update'}
        onClose={() => setDialog(null)}
        path={importUpdatePath}
        title={`Import Update ${entity} (theo ID)`}
        description={t('importExport.updateDescription')}
        onImported={onImported}
      />
    </div>
  );
}
