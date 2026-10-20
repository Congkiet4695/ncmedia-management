'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ArrowRight,
  FileVideo,
  GripVertical,
  ImageOff,
  Link2,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { cn } from '@/lib/utils';
import { usePodAsset } from '@/features/pod-listing/hooks/use-pod-listing';
import { podListingService } from '@/features/pod-listing/services/pod-listing.service';
import { imageKeys, moveImage, normalizeImageUrl, parseImageUrls } from '../media-image-order';
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
  allowUrlImages,
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
  /**
   * Cho thêm ảnh sản phẩm bằng URL (Custom Listing). Ảnh URL được server tải về + lưu Storage ⇒ thành ảnh
   * `fileId` như ảnh tải từ máy. Tắt ở màn Sửa sản phẩm (luồng ảnh `uri` đã đăng riêng của nó).
   */
  allowUrlImages?: boolean;
}) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const [busy, setBusy] = useState<'IMAGES' | 'SIZE_CHART' | 'VIDEO' | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlErrors, setUrlErrors] = useState<string[]>([]);
  /**
   * 🔴 Danh sách ảnh MỚI NHẤT. Tải ảnh là bất đồng bộ; người dùng vẫn kéo thả / xoá trong lúc chờ. Nối kết quả
   * vào `images` của lúc BẮT ĐẦU tải là âm thầm hoàn tác thao tác vừa làm — luôn nối vào bản mới nhất.
   */
  const latestImages = useRef(images);
  latestImages.current = images;
  /** URL gốc của ảnh đã thêm bằng URL trong lần mở form này — chống thêm trùng (ảnh lưu là URL Storage). */
  const sourceUrls = useRef(new Map<string, string>());
  // Bảng size áp từ Category Template chỉ mang `fileId` (template không lưu URL) — tra Storage
  // để xem trước. State/payload không đổi: thứ gửi đi vẫn là `fileId`, backend upload theo file.
  const chartAsset = usePodAsset(sizeChart && !sizeChart.imageUrl ? sizeChart.fileId : undefined);
  const sizeChartPreview = sizeChart?.imageUrl || chartAsset.data?.publicUrl || null;
  const sizeChartName = sizeChart?.fileName ?? chartAsset.data?.originalName ?? '';
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
      onImagesChange([...latestImages.current, ...uploadedFiles]);
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

  /**
   * Đổi vị trí một ảnh. Ảnh đầu tiên là ảnh CHÍNH — quy ước của TikTok, không phải cờ riêng. Nút ← → là cách
   * thao tác KHÔNG cần chuột (song song với kéo thả và phím Space/mũi tên trên tay cầm kéo).
   */
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    onImagesChange(moveImage(images, index, target));
  };

  const keys = imageKeys(images);
  // Kéo bằng chuột chỉ bắt đầu sau 6px ⇒ bấm (xem, nút) không bao giờ bị hiểu là kéo; cảm ứng giữ 200ms để
  // không cướp thao tác cuộn trang; bàn phím: Space nhấc, mũi tên di chuyển, Space thả, Esc huỷ.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onImagesChange(moveImage(images, from, to));
  };

  const removeImage = (index: number) => {
    const removed = images[index];
    if (removed?.fileId) sourceUrls.current.delete(removed.fileId);
    onImagesChange(images.filter((_, i) => i !== index));
  };

  /**
   * Thêm ảnh bằng URL (một hoặc nhiều link). Từng link được server kiểm + tải TUẦN TỰ; link lỗi báo riêng và
   * KHÔNG vào danh sách — link tốt vẫn được thêm.
   */
  const addFromUrls = async () => {
    if (busy !== null) return;
    const parsed = parseImageUrls(urlDraft);
    if (parsed.length === 0) return;
    const problems: string[] = [];
    const room = IMAGE_MAX - latestImages.current.length;
    if (room <= 0) {
      toast.error(t('listing.media.imageLimit', { max: IMAGE_MAX }));
      return;
    }
    const known = new Set([
      ...[...sourceUrls.current.values()].map(normalizeImageUrl),
      ...latestImages.current.map((image) => normalizeImageUrl(image.imageUrl)),
    ]);
    const queue: string[] = [];
    for (const { url, problem } of parsed) {
      const key = normalizeImageUrl(url);
      if (problem) problems.push(`${url} — ${t(`listing.media.url.problem.${problem}`)}`);
      else if (known.has(key)) problems.push(`${url} — ${t('listing.media.url.duplicate')}`);
      else if (queue.length >= room)
        problems.push(`${url} — ${t('listing.media.imageLimit', { max: IMAGE_MAX })}`);
      else {
        known.add(key);
        queue.push(url);
      }
    }

    setBusy('IMAGES');
    const added: SessionImageInput[] = [];
    try {
      for (const url of queue) {
        try {
          const asset = await podListingService.importAssetFromUrl(url);
          sourceUrls.current.set(asset.id, url);
          added.push({
            imageUrl: asset.publicUrl ?? '',
            fileId: asset.id,
            imageType: 'MAIN',
            fileName: asset.originalName,
          });
        } catch (error) {
          problems.push(`${url} — ${translateApiError(error)}`);
        }
      }
    } finally {
      setBusy(null);
    }
    if (added.length > 0) {
      onImagesChange([...latestImages.current, ...added].slice(0, IMAGE_MAX));
      toast.success(t('listing.media.uploaded', { count: added.length }));
    }
    setUrlErrors(problems);
    // Giữ lại đúng những link lỗi trong ô để sửa; link đã thêm thì xoá khỏi ô.
    const addedUrls = new Set(added.map((image) => sourceUrls.current.get(image.fileId ?? '')));
    setUrlDraft(
      parsed
        .map(({ url }) => url)
        .filter((url) => !addedUrls.has(url))
        .join(' '),
    );
  };
  const onUrlKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addFromUrls();
    }
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={keys} strategy={rectSortingStrategy}>
              <div className="flex flex-wrap gap-3">
                {images.map((image, index) => (
                  <SortableImage
                    key={keys[index]}
                    id={keys[index]}
                    label={t('listing.media.dragHandle', { index: index + 1 })}
                  >
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
                        onClick={() => removeImage(index)}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </SortableImage>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {allowUrlImages && (
          <div className="space-y-1">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={urlDraft}
                  onChange={(event) => setUrlDraft(event.target.value)}
                  onKeyDown={onUrlKeyDown}
                  onPaste={(event) => {
                    // Dán nhiều link (mỗi dòng một link) vào ô một dòng: giữ chúng cách nhau thay vì dính liền.
                    const text = event.clipboardData.getData('text');
                    if (/\n/.test(text)) {
                      event.preventDefault();
                      setUrlDraft((prev) =>
                        [prev, ...text.split(/\r?\n/)].filter(Boolean).join(' '),
                      );
                    }
                  }}
                  disabled={busy !== null || images.length >= IMAGE_MAX}
                  placeholder={t('listing.media.url.placeholder')}
                  aria-label={t('listing.media.url.label')}
                  className="pl-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy !== null || images.length >= IMAGE_MAX || urlDraft.trim() === ''}
                onClick={() => void addFromUrls()}
              >
                {busy === 'IMAGES' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t('listing.media.url.add')}
              </Button>
            </div>
            {urlErrors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive">
                {urlErrors.map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('listing.media.url.hint')}</p>
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
              {sizeChartPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sizeChartPreview} alt={sizeChartName} className="size-16 rounded border object-cover" />
              ) : (
                <span className="flex size-16 items-center justify-center rounded border bg-muted">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{sizeChartName}</span>
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

/**
 * Một ô ảnh kéo được. Tay cầm kéo là NÚT riêng (góc phải trên) — nút xoá / ← → không nằm trong vùng kéo nên bấm
 * chúng không bao giờ khởi động kéo; bàn phím: Tab tới tay cầm, Space nhấc, mũi tên di chuyển, Space thả.
 */
function SortableImage({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });
  return (
    <figure
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative w-[128px] space-y-1 rounded-md',
        isDragging && 'z-10 opacity-60 shadow-lg ring-2 ring-primary',
        isOver && !isDragging && 'ring-2 ring-primary/50 ring-offset-2',
      )}
    >
      {children}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={label}
        title={label}
        className="absolute right-1 top-1 cursor-grab touch-none rounded bg-background/80 p-0.5 text-muted-foreground shadow-sm hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
    </figure>
  );
}

/** Giới hạn ảnh của TikTok — form dùng lại để validate trước khi gửi, không chép lại số. */
export const MEDIA_LIMITS = {
  IMAGE_MAX,
  IMAGE_MIN_RECOMMENDED,
} as const;
