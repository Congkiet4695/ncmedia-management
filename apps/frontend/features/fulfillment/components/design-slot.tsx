'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ImageUp, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useApiError } from '@/hooks/use-api-error';
import { MAX_UPLOAD_MB, exceedsMaxUploadSize, formatFileSize } from '@/lib/file-size';
import type { PodDesign, PodDesignPlacement } from '@/features/pod-tiktok/order-types';
import type { ProductDesignKey } from '../types';
import { useMappingDesignActions } from '../hooks/use-fulfillment';

interface DesignSlotProps {
  /**
   * Địa chỉ để ghi design: cặp (Product ID + Seller SKU).
   *
   * 🔴 KHÔNG phải id của Product Mapping. Sản phẩm chưa ánh xạ vẫn upload design được —
   * Design và Product Mapping là hai nghiệp vụ độc lập.
   */
  productKey: ProductDesignKey;
  placement: PodDesignPlacement;
  design: PodDesign | null;
  onPreview: (src: string) => void;
}

/**
 * Một vị trí in của MỘT Product Mapping: preview · upload · thay thế · xoá.
 *
 * 🔴 Dùng chung giữa màn hình **Product Mapping** (nơi quản trị sản phẩm) và dialog trên màn
 * hình **Orders** (nơi phát hiện thiếu design). Hai bản sao của khối này sẽ lệch nhau ở đúng
 * chỗ nguy hiểm nhất — một bên gọi `:placement` đúng, một bên quên — nên chỉ có một bản.
 *
 * 🔴 Mỗi vị trí là một khối ĐỘC LẬP: thay Front không đụng Back, và không bao giờ bắt gửi cả
 * hai cùng lúc. Xoá chỉ xoá FILE; Product Mapping và đơn hàng còn nguyên.
 *
 * 🔴 KHÔNG đòi hỏi sản phẩm đã được ánh xạ. Design lưu theo (Product ID + Seller SKU); ánh xạ
 * chỉ cần khi Fulfill.
 *
 * Sau mỗi thao tác, mọi màn hình đọc design đều được làm mới qua `useMappingDesignActions` —
 * không cần F5, và không có bước sao chép dữ liệu nào sang đơn hàng.
 */
export function DesignSlot({ productKey, placement, design, onPreview }: DesignSlotProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const placementLabel = t(`pod:design.placement.${placement}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  // Giữ bản ghi cục bộ để hiển thị ngay sau khi upload, không cần đợi refetch danh sách.
  const [current, setCurrent] = useState<PodDesign | null>(design);
  const [copied, setCopied] = useState(false);

  const { hasPermission } = useAuth();
  const canUpload = hasPermission('pod.tiktok.design.upload');
  const canDelete = hasPermission('pod.tiktok.design.delete');

  const { upload, remove } = useMappingDesignActions();

  useEffect(() => setCurrent(design), [design]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    // Chặn NGAY tại trình duyệt: gửi 100MB lên rồi mới nhận lỗi là lãng phí băng thông của
    // người dùng và thời gian chờ. Backend vẫn kiểm lại — đây chỉ là lớp cải thiện trải nghiệm.
    if (exceedsMaxUploadSize(file)) {
      toast.error(t('pod:design.tooLarge', { size: MAX_UPLOAD_MB }), {
        description: t('pod:design.tooLargeDetail', { actual: formatFileSize(file.size) }),
      });
      // Xoá lựa chọn để chọn lại đúng file đó lần nữa vẫn kích hoạt onChange.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setProgress(0);
    try {
      const saved = await upload.mutateAsync({
        key: productKey,
        placement,
        file,
        onProgress: setProgress,
      });
      setCurrent(saved);
      toast.success(t('pod:design.uploaded', { placement: placementLabel }), {
        description: `${saved.fileName} · ${formatFileSize(saved.fileSize)}`,
      });
    } catch (error) {
      toast.error(t('pod:design.uploadFailed'), { description: translateApiError(error) });
    } finally {
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    try {
      // Chỉ xoá FILE của vị trí này — Product Mapping và vị trí còn lại giữ nguyên.
      await remove.mutateAsync({ key: productKey, placement });
      setCurrent(null);
      toast.success(t('pod:design.deleted', { placement: placementLabel }));
    } catch (error) {
      toast.error(t('pod:design.deleteFailed'), { description: translateApiError(error) });
    }
  };

  const handleCopyUrl = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.fileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('pod:design.copyFailed'));
    }
  };

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{placementLabel}</Label>
        {current && (
          <span className="text-xs text-muted-foreground">
            {current.version > 1
              ? t('pod:design.replacedTimes', { count: current.version - 1 })
              : t('pod:design.firstVersion')}
          </span>
        )}
      </div>

      {/* Preview */}
      <div className="flex h-40 items-center justify-center overflow-hidden rounded border bg-muted/30">
        {upload.isPending ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">
              {progress > 0
                ? t('pod:design.uploadingPercent', { percent: progress })
                : t('common:state.processing')}
            </span>
          </div>
        ) : current ? (
          <button
            type="button"
            onClick={() => onPreview(current.fileUrl)}
            className="size-full cursor-zoom-in"
            aria-label={t('pod:design.viewLarge')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.fileUrl} alt={placementLabel} className="size-full object-contain" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageUp className="size-8" />
            <span className="text-xs">{t('pod:design.missing')}</span>
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
              onClick={() => void handleCopyUrl()}
              aria-label={t('pod:design.copyUrl')}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={current.fileName}>
            {current.fileName} · {formatFileSize(current.fileSize)}
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
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="size-4" />
            {current ? t('pod:design.replace') : t('pod:design.pickFile')}
          </Button>
        )}
        {current && canDelete && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => void handleDelete()}
            disabled={busy}
            aria-label={t('pod:design.deleteDesign')}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('pod:design.fileHint', { size: MAX_UPLOAD_MB })}
      </p>
    </div>
  );
}
