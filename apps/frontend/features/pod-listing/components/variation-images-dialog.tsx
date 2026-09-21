'use client';

import { useState } from 'react';
import { ImageOff, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
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
}

/**
 * **Cập nhật ảnh biến thể** — mỗi giá trị của trục đầu một ảnh đại diện (Black → black.jpg).
 *
 * Dùng chung cho SKU Template (ảnh mặc định lưu ở giá trị trục) và Custom Listing (ảnh đi theo
 * `variations[0].images` của nháp). Upload qua Storage Module (`podListingService.uploadAsset`)
 * — cùng đường với ảnh tổ hợp trong bảng SKU; lúc đăng, publisher tải file từ Storage rồi
 * Upload Product Image `use_case = ATTRIBUTE_IMAGE`, không bao giờ gửi URL Storage cho TikTok.
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
}: VariationImagesDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const upload = async (value: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploadingFor(value);
    try {
      const uploaded = await podListingService.uploadAsset(file);
      onChange({ ...images, [value]: { fileId: uploaded.id, url: uploaded.publicUrl } });
    } catch (error) {
      toast.error(t('listing.variantImages.uploadFailed', { value }), {
        description: translateApiError(error),
      });
    } finally {
      setUploadingFor(null);
    }
  };

  const remove = (value: string): void => {
    const next = { ...images };
    delete next[value];
    onChange(next);
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
              <li key={value} className="flex items-center gap-3 px-3 py-2">
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
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
