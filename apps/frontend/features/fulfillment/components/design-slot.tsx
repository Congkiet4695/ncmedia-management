'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ImageUp, Link2, Loader2, Trash2, Upload } from 'lucide-react';
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

/** Cách cung cấp file design cho một vị trí in. */
type DesignSourceMode = 'UPLOAD' | 'URL';

/**
 * Kiểm URL design NGAY tại trình duyệt: http/https + hostname có tên miền. Chỉ là lớp trải nghiệm —
 * backend kiểm lại (chặn localhost / IP nội bộ ở mọi bước chuyển hướng, kiểm file thật là ảnh) và là
 * nơi quyết định cuối cùng.
 */
function designUrlProblem(raw: string): 'EMPTY' | 'MALFORMED' | 'UNSUPPORTED_PROTOCOL' | null {
  const value = raw.trim();
  if (!value) return 'EMPTY';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'MALFORMED';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'UNSUPPORTED_PROTOCOL';
  if (!parsed.hostname.includes('.')) return 'MALFORMED';
  return null;
}

/**
 * Một vị trí in của MỘT Product Mapping: preview · upload · dán URL công khai · thay thế · xoá.
 *
 * 🔴 Hai cách đưa file vào, MỘT nơi lưu: **Upload file** (từ máy) hoặc **Public URL** (server tải file
 * về rồi lưu lên kho — Drive / CDN chỉ là nguồn, không phải URL chính thức). Cả hai đều kết thúc bằng
 * một file trên kho lưu trữ (R2); preview, Order List và nhà cung cấp chỉ thấy URL đó. Tải / lưu hỏng
 * ⇒ design cũ giữ nguyên, lỗi hiện ngay dưới ô nhập.
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

  const { upload, remove, setUrl } = useMappingDesignActions();
  const [mode, setMode] = useState<DesignSourceMode>(design?.source === 'URL' ? 'URL' : 'UPLOAD');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => setCurrent(design), [design]);

  const handleSetUrl = async () => {
    const problem = designUrlProblem(urlInput);
    if (problem) {
      setUrlError(t(`pod:design.url.error.${problem}`));
      return;
    }
    setUrlError(null);
    try {
      const saved = await setUrl.mutateAsync({
        key: productKey,
        placement,
        url: urlInput.trim(),
      });
      setCurrent(saved);
      setUrlInput('');
      toast.success(t('pod:design.url.saved', { placement: placementLabel }));
    } catch (error) {
      // Lỗi nằm ở URL (sai hình thức / mạng nội bộ / link hết hạn / không phải ảnh / quá lớn) hoặc ở
      // bước lưu lên kho — hiện ngay dưới ô nhập, không chỉ toast. Design cũ không bị thay.
      const message = translateApiError(error);
      setUrlError(message);
      toast.error(t('pod:design.url.failed'), { description: message });
    }
  };

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
        description:
          saved.fileSize === null
            ? saved.fileName
            : `${saved.fileName} · ${formatFileSize(saved.fileSize)}`,
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

  const busy = upload.isPending || remove.isPending || setUrl.isPending;

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
            {current.source === 'URL' ? `${t('pod:design.url.sourceLabel')} · ` : ''}
            {current.fileName}
            {current.fileSize === null ? '' : ` · ${formatFileSize(current.fileSize)}`}
            {current.uploadedByName ? ` · ${current.uploadedByName}` : ''}
          </p>
        </div>
      )}

      {/* Chọn nguồn file — hai cách rõ ràng, không gộp vào một ô. */}
      {canUpload && (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5" role="tablist">
          {(['UPLOAD', 'URL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                setUrlError(null);
              }}
              disabled={busy}
              className={
                mode === value
                  ? 'rounded bg-background px-2 py-1 text-xs font-medium shadow-sm'
                  : 'rounded px-2 py-1 text-xs text-muted-foreground'
              }
            >
              {t(`pod:design.mode.${value}`)}
            </button>
          ))}
        </div>
      )}

      {canUpload && mode === 'URL' && (
        <div className="space-y-1">
          <div className="flex gap-1">
            <Input
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSetUrl();
                }
              }}
              placeholder={t('pod:design.url.placeholder')}
              className="h-8 text-xs"
              aria-invalid={urlError ? true : undefined}
              disabled={busy}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => void handleSetUrl()}
              disabled={busy || !urlInput.trim()}
            >
              {setUrl.isPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {current ? t('pod:design.url.replace') : t('pod:design.url.use')}
            </Button>
          </div>
          {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          <p className="text-xs text-muted-foreground">{t('pod:design.url.hint')}</p>
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
        {canUpload && mode === 'UPLOAD' && (
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
      {mode === 'UPLOAD' && (
        <p className="text-xs text-muted-foreground">
          {t('pod:design.fileHint', { size: MAX_UPLOAD_MB })}
        </p>
      )}
    </div>
  );
}
