'use client';

import { useReducer, useRef, useState } from 'react';
import { Check, ImageOff, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import {
  EMPTY_VARIATION_URL,
  checkSingleImageUrl,
  setVariationImage,
  variationUrlReducer,
} from '@/features/pod-listing-session/media-image-order';
import { podListingService } from '../services/pod-listing.service';

/** Ảnh của MỘT giá trị biến thể: file trong Storage + URL xem trước. */
export interface VariationValueImage {
  fileId: string;
  url: string | null;
}

/** Ảnh theo giá trị, khoá là chính giá trị (`Black` → ảnh). */
export type VariationImageMap = Record<string, VariationValueImage>;

interface VariationImagesDialogProps {
  open: boolean;
  /** Tên trục ĐẦU TIÊN — trục duy nhất được gắn ảnh (TikTok: `sku_img` ở sales attribute đầu). */
  axisName: string;
  values: string[];
  images: VariationImageMap;
  onChange: (next: VariationImageMap) => void;
  onClose: () => void;
  /** Cho nhập ảnh bằng URL bên cạnh tải file (Custom Listing). */
  allowUrlImages?: boolean;
}

/**
 * **Cập nhật ảnh biến thể** — mỗi giá trị của trục đầu một ảnh đại diện (Black → black.jpg).
 *
 * Dùng chung cho SKU Template (ảnh mặc định lưu ở giá trị trục) và Custom Listing (ảnh đi theo
 * `variations[0].images` của nháp). Upload qua Storage Module (`podListingService.uploadAsset`)
 * — cùng đường với ảnh tổ hợp trong bảng SKU; lúc đăng, publisher tải file từ Storage rồi
 * Upload Product Image `use_case = ATTRIBUTE_IMAGE`, không bao giờ gửi URL Storage cho TikTok.
 *
 * 🔴 Ảnh bằng URL cũng thành file Storage (`POST /pod/listing-assets/from-url`: hàng rào SSRF + kiểm chữ ký file ở
 * server) ⇒ form chỉ giữ `fileId` như ảnh tải từ máy, URL người dùng nhập không bao giờ đi vào payload.
 *
 * 🔴 Một ảnh cho mỗi giá trị (giữ hành vi hiện có của ảnh tổ hợp: `sku_img` là MỘT `uri`).
 * Ảnh không bắt buộc — giá trị không có ảnh thì SKU không có ảnh biến thể.
 */
export function VariationImagesDialog({
  open,
  axisName,
  values,
  images,
  onChange,
  onClose,
  allowUrlImages,
}: VariationImagesDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [urlFor, setUrlFor] = useState<string | null>(null);
  /**
   * 🔴 Bản MỚI NHẤT của ảnh + callback. Tải file là bất đồng bộ và người dùng vẫn có thể gắn ảnh cho giá trị khác
   * trong lúc chờ; ghi đè bằng `images` của lúc BẮT ĐẦU tải là âm thầm mất ảnh vừa gắn.
   */
  const latest = useRef({ images, onChange });
  latest.current = { images, onChange };

  const assign = (value: string, image: VariationValueImage): void => {
    latest.current.onChange(setVariationImage(latest.current.images, value, image));
  };

  const upload = async (value: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploadingFor(value);
    try {
      const uploaded = await podListingService.uploadAsset(file);
      assign(value, { fileId: uploaded.id, url: uploaded.publicUrl });
    } catch (error) {
      toast.error(t('listing.variantImages.uploadFailed', { value }), {
        description: translateApiError(error),
      });
    } finally {
      setUploadingFor(null);
    }
  };

  const remove = (value: string): void => {
    const next = { ...latest.current.images };
    delete next[value];
    latest.current.onChange(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('listing.variantImages.title', { axis: axisName })}
      description={t('listing.variantImages.hint')}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose} disabled={uploadingFor !== null}>
            {t('common:action.close')}
          </Button>
        </div>
      }
    >
      {values.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('listing.variantImages.noValues')}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {values.map((value) => {
            const image = images[value];
            const busy = uploadingFor === value;
            const inputId = `variation-image-${value.replace(/[^A-Za-z0-9_-]/g, '_')}`;
            return (
              <li key={value} className="space-y-2 px-3 py-2">
                <div className="flex items-center gap-3">
                  {image?.url ? (
                    // Ảnh do Storage phục vụ (CDN) — <img> thay vì next/image để khỏi khai remotePatterns.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.url} alt={value} className="size-12 shrink-0 rounded border object-cover" />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded border bg-muted">
                      <ImageOff className="size-4 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{value}</p>
                    <p className="text-xs text-muted-foreground">
                      {image ? t('listing.variantImages.hasImage') : t('listing.variantImages.noImage')}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} asChild>
                    <label htmlFor={inputId} className="cursor-pointer">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {t('listing.variantImages.upload')}
                    </label>
                  </Button>
                  <input
                    id={inputId}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Đặt lại để chọn đúng file cũ vẫn kích hoạt onChange.
                      event.target.value = '';
                      void upload(value, file);
                    }}
                  />
                  {allowUrlImages && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-expanded={urlFor === value}
                      onClick={() => setUrlFor((current) => (current === value ? null : value))}
                    >
                      <Link2 className="size-4" />
                      {t('listing.variantImages.url.toggle')}
                    </Button>
                  )}
                  {image && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={t('listing.variantImages.remove')}
                      title={t('listing.variantImages.remove')}
                      onClick={() => remove(value)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
                {allowUrlImages && urlFor === value && (
                  <VariationUrlField
                    value={value}
                    onUse={(picked) => {
                      assign(value, picked);
                      setUrlFor(null);
                      toast.success(t('listing.variantImages.url.applied', { value }));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/**
 * Nhập URL ảnh cho MỘT giá trị biến thể: kiểm hình thức → server tải + kiểm → xem trước → người dùng xác nhận mới gắn.
 *
 * Giá trị đích nằm trong `onUse` của đúng dòng đang mở; đổi dòng là component này bị gỡ cùng trạng thái của nó, nên
 * ảnh đang xem trước không thể rơi sang giá trị khác.
 */
function VariationUrlField({
  value,
  onUse,
}: {
  value: string;
  onUse: (image: VariationValueImage) => void;
}) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const [state, dispatch] = useReducer(variationUrlReducer, EMPTY_VARIATION_URL);
  const nextRequest = useRef(0);

  const load = async (): Promise<void> => {
    const checked = checkSingleImageUrl(state.input);
    if (checked.problem) {
      dispatch({ type: 'REJECTED', problem: checked.problem });
      return;
    }
    // Luôn lớn hơn mọi `requestId` đã dùng (kể cả phần `INPUT` tự tăng trong reducer).
    nextRequest.current = Math.max(nextRequest.current, state.requestId) + 1;
    const requestId = nextRequest.current;
    dispatch({ type: 'START', requestId });
    try {
      const asset = await podListingService.importAssetFromUrl(checked.url);
      dispatch({ type: 'LOADED', requestId, image: { fileId: asset.id, url: asset.publicUrl } });
    } catch (error) {
      dispatch({ type: 'FAILED', requestId, message: translateApiError(error) });
    }
  };

  const loading = state.status === 'LOADING';
  const problemText = state.problem
    ? t(
        state.problem === 'EMPTY' || state.problem === 'MULTIPLE'
          ? `listing.variantImages.url.problem.${state.problem}`
          : `listing.media.url.problem.${state.problem}`,
      )
    : state.previewFailed
      ? t('listing.variantImages.url.previewFailed')
      : state.errorMessage;

  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-2">
      <div className="flex gap-2">
        <Input
          value={state.input}
          onChange={(event) => dispatch({ type: 'INPUT', input: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!loading) void load();
            }
          }}
          aria-label={t('listing.variantImages.url.label', { value })}
          placeholder={t('listing.media.url.placeholder')}
          className="h-9 min-w-0 flex-1"
        />
        <Button variant="outline" size="sm" className="h-9" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          {t('listing.variantImages.url.load')}
        </Button>
      </div>

      {problemText && (
        <p role="alert" className="break-words text-xs text-destructive">
          {problemText}
        </p>
      )}

      {state.image && (state.status === 'PREVIEW' || state.status === 'READY') && (
        <div className="flex items-center gap-3">
          {state.image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.image.url}
              alt={value}
              className="size-20 shrink-0 rounded border object-cover"
              onLoad={() => dispatch({ type: 'PREVIEW_OK', requestId: state.requestId })}
              onError={() => dispatch({ type: 'PREVIEW_ERROR', requestId: state.requestId })}
            />
          ) : (
            <span className="flex size-20 shrink-0 items-center justify-center rounded border bg-muted">
              <ImageOff className="size-4 text-muted-foreground" />
            </span>
          )}
          <Button
            size="sm"
            disabled={state.status !== 'READY'}
            onClick={() => {
              if (state.image) onUse(state.image);
            }}
          >
            {state.status === 'READY' ? <Check className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
            {t('listing.variantImages.url.use')}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('listing.variantImages.url.hint')}</p>
    </div>
  );
}
