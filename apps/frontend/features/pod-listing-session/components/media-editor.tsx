'use client';

import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FileVideo,
  ImageOff,
  Loader2,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { podListingService } from '@/features/pod-listing/services/pod-listing.service';
import type { ManualVideo, SessionImageInput } from '../types';

/**
 * Giới hạn của TikTok (tài liệu Create Product / UploadProductFile) — chặn NGAY tại chỗ
 * chọn file, không để lỗi lộ ra sau khi đã gửi hàng chục request.
 */
const IMAGE_MAX = 9;
const IMAGE_MIN_RECOMMENDED = 5;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Video: tối đa 100 MB, các định dạng TikTok liệt kê trong UploadProductFile. */
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/x-ms-wmv',
  'video/webm',
  'video/x-msvideo',
  'video/3gpp',
  'video/x-flv',
  'video/mpeg',
];

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Khu vực **Hình ảnh · Bảng size · Video**.
 *
 * 🔴 Upload đi qua Storage Module đã có (`POST /storage/upload`, quyền `storage.upload`) —
 * KHÔNG dựng cơ chế tải lên thứ hai. Form chỉ giữ `fileId` + URL xem trước; việc đẩy file
 * sang TikTok là của publisher, và nó làm MỘT lần cho cả lượt dù đăng lên bao nhiêu shop
 * (xem `ensureImageUris`).
 *
 * 🔴 Ba loại file đi ba đường khác nhau ở TikTok, nên ở đây cũng tách bạch:
 *   - Ảnh sản phẩm  → `main_images[]`      (Upload Image, use case MAIN_IMAGE)
 *   - Bảng size     → `size_chart.image`   (Upload Image, use case SIZE_CHART_IMAGE)
 *   - Video         → `video.id`           (Upload **File**, trả về ID chứ không phải uri)
 * Gộp chúng vào một danh sách là bảng size hiện ra giữa bộ ảnh sản phẩm của người mua.
 */
export function MediaEditor({
  images,
  onImagesChange,
  sizeChart,
  onSizeChartChange,
  video,
  onVideoChange,
  removable,
}: {
  images: SessionImageInput[];
  onImagesChange: (next: SessionImageInput[]) => void;
  sizeChart: SessionImageInput | null;
  onSizeChartChange: (next: SessionImageInput | null) => void;
  video: ManualVideo | null;
  onVideoChange: (next: ManualVideo | null) => void;
  /**
   * Cho phép GỠ bảng size / video hay không. Mặc định là được.
   *
   * 🔴 Màn hình Sửa sản phẩm tắt hai nút này: `partial_edit` của TikTok không có cách nào
   * diễn đạt "xoá bảng size" hay "xoá video" khỏi một sản phẩm đã đăng. Để nút ở đó nghĩa là
   * người dùng bấm gỡ, bấm Lưu, nhận thông báo thành công — rồi mở Seller Center thấy video
   * vẫn còn. Thay được thì vẫn thay được, chỉ là không gỡ trắng được.
   */
  removable?: { sizeChart?: boolean; video?: boolean };
}) {
  const { t } = useTranslation('pod');
  const [busy, setBusy] = useState<'IMAGES' | 'SIZE_CHART' | 'VIDEO' | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const chartInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  /** Kiểm định dạng + dung lượng TRƯỚC khi tải lên — hỏng thì báo ngay, khỏi tốn băng thông. */
  const reject = (file: File, types: string[], maxBytes: number): string | null => {
    if (types.length > 0 && !types.includes(file.type)) {
      return t('listing.media.badFormat', { name: file.name, type: file.type || '?' });
    }
    if (file.size > maxBytes) {
      return t('listing.media.tooLarge', {
        name: file.name,
        size: megabytes(file.size),
        max: megabytes(maxBytes),
      });
    }
    return null;
  };

  const uploadMany = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = [...files];

    const room = IMAGE_MAX - images.length;
    if (room <= 0) {
      toast.error(t('listing.media.imageLimit', { max: IMAGE_MAX }));
      return;
    }
    // Vượt trần thì lấy đúng phần còn chỗ và NÓI RÕ, thay vì im lặng bỏ bớt.
    const accepted = picked.slice(0, room);
    if (picked.length > room) {
      toast.warning(t('listing.media.imageTrimmed', { taken: room, total: picked.length }));
    }

    const invalid = accepted.map((file) => reject(file, IMAGE_TYPES, IMAGE_MAX_BYTES)).filter(Boolean);
    if (invalid.length > 0) {
      toast.error(invalid[0] as string);
      return;
    }

    setBusy('IMAGES');
    try {
      // Tải TUẦN TỰ: 9 ảnh song song trên mạng văn phòng hay timeout, và một lỗi giữa chừng
      // thì không biết ảnh nào đã lên. Tuần tự thì phần đã lên luôn được giữ lại.
      const uploadedFiles: SessionImageInput[] = [];
      for (const file of accepted) {
        const asset = await podListingService.uploadAsset(file);
        uploadedFiles.push({
          imageUrl: asset.publicUrl ?? '',
          fileId: asset.id,
          imageType: 'MAIN',
          fileName: asset.originalName,
        });
      }
      onImagesChange([...images, ...uploadedFiles]);
      toast.success(t('listing.media.uploaded', { count: uploadedFiles.length }));
    } catch (error) {
      toast.error(t('listing.media.uploadFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
      if (imageInput.current) imageInput.current.value = '';
    }
  };

  const uploadOne = async (
    file: File | undefined,
    kind: 'SIZE_CHART' | 'VIDEO',
    types: string[],
    maxBytes: number,
  ) => {
    if (!file) return;
    const error = reject(file, types, maxBytes);
    if (error) {
      toast.error(error);
      return;
    }

    setBusy(kind);
    try {
      const asset = await podListingService.uploadAsset(file);
      if (kind === 'SIZE_CHART') {
        onSizeChartChange({
          imageUrl: asset.publicUrl ?? '',
          fileId: asset.id,
          imageType: 'SIZE_CHART',
          fileName: asset.originalName,
        });
      } else {
        onVideoChange({ fileId: asset.id, fileName: asset.originalName });
      }
      toast.success(t('listing.media.uploaded', { count: 1 }));
    } catch (uploadError) {
      toast.error(t('listing.media.uploadFailed'), {
        description: uploadError instanceof Error ? uploadError.message : undefined,
      });
    } finally {
      setBusy(null);
      if (kind === 'SIZE_CHART' && chartInput.current) chartInput.current.value = '';
      if (kind === 'VIDEO' && videoInput.current) videoInput.current.value = '';
    }
  };

  /** Đổi chỗ hai ảnh. Ảnh đầu tiên là ảnh CHÍNH — đó là quy ước của TikTok, không phải cờ riêng. */
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onImagesChange(next);
  };

  return (
    <div className="space-y-5">
      {/* ---------- Ảnh sản phẩm ---------- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>
            {t('listing.media.productImages')}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <Badge variant={images.length >= IMAGE_MIN_RECOMMENDED ? 'success' : 'muted'}>
              {images.length} / {IMAGE_MAX}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || images.length >= IMAGE_MAX}
              onClick={() => imageInput.current?.click()}
            >
              {busy === 'IMAGES' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t('listing.media.uploadImages')}
            </Button>
          </div>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(event) => void uploadMany(event.target.files)}
        />

        {images.length === 0 ? (
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed py-10 text-sm text-muted-foreground hover:bg-muted/40"
          >
            <Upload className="size-6" />
            {t('listing.media.dropHint')}
          </button>
        ) : (
          <div className="flex flex-wrap gap-3">
            {images.map((image, index) => (
              <figure key={image.fileId ?? `${image.imageUrl}-${index}`} className="w-[128px] space-y-1">
                <div className="relative">
                  {image.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image.imageUrl}
                      alt={image.fileName ?? ''}
                      className="size-[128px] rounded-md border object-cover"
                    />
                  ) : (
                    <div className="flex size-[128px] items-center justify-center rounded-md border bg-muted">
                      <ImageOff className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  {index === 0 && (
                    <Badge variant="success" className="absolute left-1 top-1 gap-1">
                      <Star className="size-3" />
                      {t('listing.media.primary')}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t('listing.media.moveLeft')}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t('listing.media.moveRight')}
                      disabled={index === images.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0"
                    aria-label={t('listing.media.removeImage')}
                    onClick={() => onImagesChange(images.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </figure>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t('listing.media.imageHint', { min: IMAGE_MIN_RECOMMENDED, max: IMAGE_MAX })}
        </p>
      </div>

      {/* ---------- Bảng size + Video ---------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('listing.media.sizeChart')}</Label>
          <input
            ref={chartInput}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            hidden
            onChange={(event) =>
              void uploadOne(event.target.files?.[0], 'SIZE_CHART', IMAGE_TYPES, IMAGE_MAX_BYTES)
            }
          />
          {sizeChart ? (
            <div className="flex items-center gap-2 rounded-md border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sizeChart.imageUrl}
                alt={sizeChart.fileName ?? ''}
                className="size-16 rounded border object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{sizeChart.fileName}</span>
              {removable?.sizeChart !== false && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('listing.media.removeSizeChart')}
                  onClick={() => onSizeChartChange(null)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => chartInput.current?.click()}
              >
                {busy === 'SIZE_CHART' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {t('listing.media.replace')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => chartInput.current?.click()}
            >
              {busy === 'SIZE_CHART' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t('listing.media.uploadSizeChart')}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t('listing.media.sizeChartHint')}</p>
        </div>

        <div className="space-y-2">
          <Label>{t('listing.media.video')}</Label>
          <input
            ref={videoInput}
            type="file"
            accept={VIDEO_TYPES.join(',')}
            hidden
            onChange={(event) =>
              void uploadOne(event.target.files?.[0], 'VIDEO', VIDEO_TYPES, VIDEO_MAX_BYTES)
            }
          />
          {video ? (
            <div className="flex items-center gap-2 rounded-md border p-2">
              <FileVideo className="size-8 shrink-0 text-muted-foreground" />
              {video.url ? (
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-primary underline"
                >
                  {video.fileName || t('listing.media.video')}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{video.fileName}</span>
              )}
              {removable?.video !== false && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('listing.media.removeVideo')}
                  onClick={() => onVideoChange(null)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => videoInput.current?.click()}
              >
                {busy === 'VIDEO' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {t('listing.media.replace')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => videoInput.current?.click()}
            >
              {busy === 'VIDEO' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t('listing.media.uploadVideo')}
            </Button>
          )}
          {/* 🔴 Nói rõ giới hạn TikTok TRƯỚC khi người dùng chọn một file 400 MB rồi chờ. */}
          <p className="text-xs text-muted-foreground">{t('listing.media.videoHint')}</p>
        </div>
      </div>
    </div>
  );
}

/** Giới hạn ảnh của TikTok — form dùng lại để validate trước khi gửi, không chép lại số. */
export const MEDIA_LIMITS = {
  IMAGE_MAX,
  IMAGE_MIN_RECOMMENDED,
} as const;
