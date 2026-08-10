'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ImageUp, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/hooks/use-auth';
import { useApiError } from '@/hooks/use-api-error';
import { useDeleteDesign, useUploadDesign } from '../hooks/use-pod-orders';
import { ImageLightbox } from './image-lightbox';
import {
  POD_ACTIVE_PLACEMENTS,
  type PodDesign,
  type PodDesignPlacement,
  type PodOrderItem,
} from '../order-types';

interface UploadDesignDialogProps {
  open: boolean;
  item: PodOrderItem | null;
  onClose: () => void;
}

/** Nhãn từng vị trí in nằm ở `pod.json` (khoá `design.placement.*`). */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Dialog upload design cho MỘT sản phẩm.
 *
 * Mỗi vị trí in (Front/Back) là một khối độc lập: upload/thay/xoá vị trí này
 * không ảnh hưởng vị trí kia, cũng không ảnh hưởng sản phẩm khác trong đơn.
 * Mở lại dialog khi đã có design → hiển thị Preview + URL (readonly) + nút thay thế.
 */
export function UploadDesignDialog({ open, item, onClose }: UploadDesignDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('design.dialogTitle')}
        description={t('design.dialogDescription')}
        className="max-w-3xl"
      >
        {item && (
          <div className="space-y-5">
            {/* Thông tin sản phẩm */}
            <div className="grid gap-x-6 gap-y-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2">
              <InfoLine label={t('design.productName')} value={item.productName} />
              <InfoLine label={t('product.productId')} value={item.productId} mono />
              <InfoLine label={t('product.sku')} value={item.sellerSku ?? item.skuId} mono />
              <InfoLine label={t('product.variant')} value={item.skuName} />
            </div>

            {/* Mỗi vị trí in một khối độc lập */}
            <div className="grid gap-4 sm:grid-cols-2">
              {POD_ACTIVE_PLACEMENTS.map((placement) => (
                <DesignSlot
                  key={placement}
                  orderItemId={item.id}
                  placement={placement}
                  design={item.designs.find((d) => d.placement === placement) ?? null}
                  onPreview={setLightbox}
                />
              ))}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                {t('common:action.close')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ImageLightbox open={Boolean(lightbox)} src={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}

function InfoLine({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className={mono ? 'break-all font-mono text-xs' : 'break-words font-medium'}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/** Một vị trí in: upload / preview / URL readonly / thay thế / xoá. */
function DesignSlot({
  orderItemId,
  placement,
  design,
  onPreview,
}: {
  orderItemId: string;
  placement: PodDesignPlacement;
  design: PodDesign | null;
  onPreview: (src: string) => void;
}) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const placementLabel = t(`design.placement.${placement}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  // Giữ bản ghi cục bộ để hiển thị ngay sau khi upload, không cần đợi refetch danh sách.
  const [current, setCurrent] = useState<PodDesign | null>(design);
  const [copied, setCopied] = useState(false);

  const { hasPermission } = useAuth();
  const canUpload = hasPermission('pod.tiktok.design.upload');
  const canDelete = hasPermission('pod.tiktok.design.delete');

  const uploadMutation = useUploadDesign();
  const deleteMutation = useDeleteDesign();

  useEffect(() => setCurrent(design), [design]);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      const saved = await uploadMutation.mutateAsync({
        orderItemId,
        placement,
        file,
        onProgress: setProgress,
      });
      setCurrent(saved);
      toast.success(t('design.uploaded', { placement: placementLabel }), {
        description: `${saved.fileName} · ${formatBytes(saved.fileSize)}`,
      });
    } catch (error) {
      toast.error(t('design.uploadFailed'), { description: translateApiError(error) });
    } finally {
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ orderItemId, placement });
      setCurrent(null);
      toast.success(t('design.deleted', { placement: placementLabel }));
    } catch (error) {
      toast.error(t('design.deleteFailed'), { description: translateApiError(error) });
    }
  };

  const handleCopyUrl = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.fileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('design.copyFailed'));
    }
  };

  const busy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{placementLabel}</Label>
        {current && (
          <span className="text-xs text-muted-foreground">
            {current.version > 1
              ? t('design.replacedTimes', { count: current.version - 1 })
              : t('design.firstVersion')}
          </span>
        )}
      </div>

      {/* Preview */}
      <div className="flex h-40 items-center justify-center overflow-hidden rounded border bg-muted/30">
        {busy && uploadMutation.isPending ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">
              {progress > 0
                ? t('design.uploadingPercent', { percent: progress })
                : t('common:state.processing', { ns: 'common' })}
            </span>
          </div>
        ) : current ? (
          <button
            type="button"
            onClick={() => onPreview(current.fileUrl)}
            className="size-full cursor-zoom-in"
            aria-label={t('design.viewLarge')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.fileUrl}
              alt={placementLabel}
              className="size-full object-contain"
            />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageUp className="size-8" />
            <span className="text-xs">{t('design.missing')}</span>
          </div>
        )}
      </div>

      {/* URL readonly sau khi upload */}
      {current && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">URL</Label>
          <div className="flex gap-1">
            <Input readOnly value={current.fileUrl} className="h-8 font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              onClick={handleCopyUrl}
              aria-label={t('design.copyUrl')}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={current.fileName}>
            {current.fileName} · {formatBytes(current.fileSize)}
            {current.uploadedByName ? ` · ${current.uploadedByName}` : ''}
          </p>
        </div>
      )}

      {/* Hành động */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        {canUpload && (
          <Button
            type="button"
            variant={current ? 'outline' : 'default'}
            size="sm"
            className="flex-1"
            onClick={handlePick}
            disabled={busy}
          >
            <Upload className="size-4" />
            {current ? t('design.replace') : t('design.pickFile')}
          </Button>
        )}
        {current && canDelete && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={handleDelete}
            disabled={busy}
            aria-label={t('design.deleteDesign')}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('design.fileHint')}</p>
    </div>
  );
}
