'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
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
import { ImageOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { cn } from '@/lib/utils';
import { podListingService } from '@/features/pod-listing/services/pod-listing.service';
import {
  appendImages,
  clipboardImageFiles,
  hasImage,
  planImageUploads,
  toImagePayload,
  type DraftImage,
} from '../draft-product-images';
import { useUpdateSessionProduct } from '../hooks';
import {
  checkSingleImageUrl,
  imageKeys,
  moveImage,
  PRODUCT_IMAGE_UPLOAD_MAX_BYTES,
  PRODUCT_IMAGE_UPLOAD_TYPES,
} from '../media-image-order';
import type { PodSessionProduct } from '../types';

/**
 * Trần ảnh của một sản phẩm — đúng bằng số cột URL trong file import và `POD_SESSION_IMPORT_MAX_IMAGES`
 * của backend (DTO chặn lại đúng số này).
 */
const MAX_IMAGES = 10;

const UPLOAD_RULES = {
  types: PRODUCT_IMAGE_UPLOAD_TYPES,
  maxBytes: PRODUCT_IMAGE_UPLOAD_MAX_BYTES,
};
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Sửa MỘT Draft Product: **tiêu đề và danh sách ảnh gốc**. Hết.
 *
 * 🔴 Không có ô nào cho mô tả, biến thể, giá, tồn, danh mục hay shop — tất cả đến từ bộ
 * template của lượt đăng. Đây chính là điều làm file import chỉ cần 11 cột: người vận hành
 * cung cấp đúng thứ mà template không thể biết, phần còn lại hệ thống tự dựng.
 *
 * Ba cách nhập ảnh cùng tồn tại:
 *  1. **URL** — gõ / dán link vào ô URL rồi bấm Thêm (như trước).
 *  2. **Dán ảnh (Ctrl+V)** khi đang ở ô ảnh hoặc ô URL — ảnh đi qua ĐÚNG đường Storage của form Custom Listing
 *     (`POST /storage/upload`), lưu `publicUrl` + `fileId`; không bao giờ lưu `blob:` / `data:`.
 *  3. **Kéo thả** để đổi thứ tự — ảnh ĐẦU TIÊN là thumbnail (và ảnh đầu của listing), lưu bằng `sortOrder = index`.
 */
export function SessionProductDialog({
  sessionId,
  product,
  onClose,
}: {
  sessionId: string;
  product: PodSessionProduct | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const update = useUpdateSessionProduct();

  const [title, setTitle] = useState('');
  const [images, setImages] = useState<DraftImage[]>([]);
  const [newImage, setNewImage] = useState('');
  const [uploading, setUploading] = useState(false);
  /** Khoá đồng bộ chống dán chồng khi state `uploading` chưa kịp cập nhật. */
  const uploadingRef = useRef(false);

  useEffect(() => {
    if (!product) return;
    setTitle(product.title);
    // Giữ `fileId` / `imageType` của ảnh cũ: lưu lại chỉ để đổi thứ tự không được làm mất liên kết Storage.
    setImages(
      product.images.map((image) => ({
        imageUrl: image.imageUrl,
        ...(image.fileId ? { fileId: image.fileId } : {}),
        imageType: image.imageType,
      })),
    );
    setNewImage('');
  }, [product]);

  // Kéo bằng chuột chỉ bắt đầu sau 6px ⇒ bấm nút xoá không bao giờ bị hiểu là kéo; cảm ứng giữ 200ms để không
  // cướp thao tác cuộn; bàn phím: Space nhấc, mũi tên di chuyển, Space thả, Esc huỷ. Cùng cấu hình media-editor.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!product) return null;

  const readOnly = product.status === 'UPLOADED' || product.status === 'QUEUED';
  const full = images.length >= MAX_IMAGES;
  const keys = imageKeys(images);

  const addImage = (): void => {
    const checked = checkSingleImageUrl(newImage);
    if (checked.problem === 'EMPTY') return;
    if (checked.problem === 'MULTIPLE') {
      toast.error(t('listing.products.oneUrlAtATime'));
      return;
    }
    if (checked.problem) {
      toast.error(t(`listing.media.url.problem.${checked.problem}`));
      return;
    }
    if (full) {
      toast.error(t('listing.products.imageLimit', { max: MAX_IMAGES }));
      return;
    }
    if (hasImage(images, { imageUrl: checked.url })) {
      toast.error(t('listing.products.imageDuplicate'));
      return;
    }
    setImages((prev) => [...prev, { imageUrl: checked.url }]);
    setNewImage('');
  };

  /**
   * Tải ảnh dán từ clipboard qua Storage rồi nối vào CUỐI danh sách (không đổi thumbnail hiện tại).
   * Tải TUẦN TỰ: một lỗi giữa chừng vẫn giữ các ảnh đã lên, và luôn biết ảnh nào chưa lên.
   */
  const uploadImages = async (files: File[]): Promise<void> => {
    if (uploadingRef.current) {
      toast.warning(t('listing.products.pasteBusy'));
      return;
    }
    const plan = planImageUploads(files, images.length, MAX_IMAGES, UPLOAD_RULES);
    if (plan.full) {
      toast.error(t('listing.products.imageLimit', { max: MAX_IMAGES }));
      return;
    }
    for (const { file, reason } of plan.rejected) {
      toast.error(
        reason === 'TYPE'
          ? t('listing.media.badFormat', { name: file.name, type: file.type || '?' })
          : t('listing.media.tooLarge', {
              name: file.name,
              size: megabytes(file.size),
              max: megabytes(PRODUCT_IMAGE_UPLOAD_MAX_BYTES),
            }),
      );
    }
    if (plan.overflow > 0) {
      toast.warning(
        t('listing.media.imageTrimmed', {
          taken: plan.accepted.length,
          total: plan.accepted.length + plan.overflow,
        }),
      );
    }
    if (plan.accepted.length === 0) return;

    uploadingRef.current = true;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of plan.accepted) {
        const asset = await podListingService.uploadAsset(file);
        // Không có URL công khai thì ảnh không hiển thị / đăng được — báo lỗi thay vì lưu một ảnh hỏng.
        if (!asset.publicUrl) throw new Error(t('listing.products.pasteNoPublicUrl'));
        const image: DraftImage = { imageUrl: asset.publicUrl, fileId: asset.id };
        setImages((prev) => appendImages(prev, [image], MAX_IMAGES).images);
        uploaded += 1;
      }
      toast.success(t('listing.media.uploaded', { count: uploaded }));
    } catch (error) {
      toast.error(t('listing.media.uploadFailed'), { description: translateApiError(error) });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  /**
   * 🔴 Chỉ can thiệp khi clipboard THỰC SỰ có ảnh. Dán chữ (vào ô URL hay bất kỳ ô nào) thì KHÔNG gọi
   * `preventDefault` — trình duyệt dán như bình thường. Ô tiêu đề nằm ngoài vùng này nên không bị ảnh hưởng.
   */
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (readOnly) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadImages(files);
  };

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setImages((prev) => moveImage(prev, from, to));
  };

  const handleSave = async (): Promise<void> => {
    if (!title.trim()) {
      toast.error(t('listing.products.missingTitle'));
      return;
    }

    try {
      await update.mutateAsync({
        id: sessionId,
        productId: product.id,
        payload: {
          title: title.trim(),
          images: toImagePayload(images),
        },
      });
      toast.success(t('listing.products.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.products.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title={t('listing.products.editTitle')}
      description={t('listing.products.editHint')}
    >
      <div className="max-h-[74vh] space-y-4 overflow-y-auto pr-1">
        {readOnly && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            {t('listing.products.readOnly')}
          </div>
        )}

        {product.issues && product.issues.length > 0 && (
          <ul className="space-y-1 rounded-md border p-3 text-sm">
            {product.issues.map((issue, index) => (
              <li
                key={index}
                className={issue.level === 'ERROR' ? 'text-destructive' : 'text-warning'}
              >
                [{issue.level}] {issue.message}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1">
          <Label>
            {t('listing.products.title')}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            value={title}
            disabled={readOnly}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        {/* --- Ảnh gốc (URL1 → URL10) — vùng nhận Ctrl+V (kể cả khi đang ở ô URL bên dưới) --- */}
        <div
          className="space-y-2 rounded-md border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={readOnly ? -1 : 0}
          aria-label={t('listing.products.imagesAreaLabel')}
          onPaste={handlePaste}
        >
          <Label>{t('listing.products.images', { count: images.length })}</Label>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={keys} strategy={rectSortingStrategy}>
              <div className="flex flex-wrap gap-2">
                {images.map((image, index) => (
                  <SortableThumb
                    key={keys[index]}
                    id={keys[index]}
                    disabled={readOnly || uploading}
                    label={t('listing.products.dragImage', { index: index + 1 })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.imageUrl}
                      alt=""
                      draggable={false}
                      className="size-16 rounded border object-cover"
                    />
                    {/* Ảnh đầu tiên là thumbnail và cũng là ảnh đầu của listing — nói rõ ra để
                        người dùng biết thứ tự có ý nghĩa. */}
                    {index === 0 && (
                      <span className="absolute -top-2 left-0 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                        {t('listing.products.thumbnail')}
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={t('listing.media.removeImage')}
                        disabled={uploading}
                        // Nhấn nút xoá không bao giờ khởi động kéo thả.
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                        className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </SortableThumb>
                ))}
                {uploading && (
                  <span className="flex size-16 items-center justify-center rounded border bg-muted">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </span>
                )}
                {images.length === 0 && !uploading && (
                  <span className="flex size-16 items-center justify-center rounded border bg-muted">
                    <ImageOff className="size-5 text-muted-foreground" />
                  </span>
                )}
              </div>
            </SortableContext>
          </DndContext>
          {!readOnly && (
            <div className="flex gap-2">
              <Input
                value={newImage}
                placeholder="https://cdn.example/front.jpg"
                disabled={full || uploading}
                onChange={(event) => setNewImage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addImage();
                }}
              />
              <Button variant="outline" disabled={full || uploading} onClick={addImage}>
                <Plus className="size-4" />
                {t('listing.products.addImage')}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('listing.products.imageHint', { max: MAX_IMAGES })}
          </p>
          {!readOnly && (
            <p className="text-xs text-muted-foreground">{t('listing.products.pasteHint')}</p>
          )}
        </div>

        {(product.results ?? []).some((result) => result.remoteProductId) && (
          <div className="flex flex-wrap gap-2">
            {(product.results ?? [])
              .filter((result) => result.remoteProductId)
              .map((result) => (
                <Badge key={result.shopId} variant="success">
                  {result.shop?.name ?? result.shopId}: {result.remoteProductId}
                </Badge>
              ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t('common:action.close')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void handleSave()} disabled={update.isPending || uploading}>
              {update.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('common:action.save')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Một ô ảnh kéo thả được — cả ô là tay cầm (ảnh 64px quá nhỏ cho một tay cầm riêng). */
function SortableThumb({
  id,
  disabled,
  label,
  children,
}: {
  id: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id,
      disabled,
    });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={disabled ? undefined : label}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative rounded',
        !disabled && 'cursor-grab active:cursor-grabbing',
        isDragging && 'z-10 opacity-60 shadow-lg ring-2 ring-primary',
        isOver && !isDragging && 'ring-2 ring-primary/50 ring-offset-2',
      )}
    >
      {children}
    </div>
  );
}
