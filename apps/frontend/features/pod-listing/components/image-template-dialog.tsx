'use client';

import { useEffect, useRef, useState } from 'react';
import {
  GripVertical,
  ImageOff,
  Loader2,
  Maximize2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useImageItemActions, useSavePodTemplate } from '../hooks/use-pod-listing';
import {
  POD_IMAGE_ASSET_TYPES,
  type PodImageAssetType,
  type PodImageTemplate,
  type PodImageTemplateItem,
} from '../types';

interface ImageTemplateDialogProps {
  open: boolean;
  template: PodImageTemplate | null;
  onClose: () => void;
}

/**
 * Form bộ ảnh mẫu — **gallery**, không phải trình dựng quy tắc.
 *
 * ```
 *   Comfort Colors                                    [ + Tải ảnh lên ]
 *   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 *   │ Front    │ │ Back     │ │Lifestyle │ │Size Chart│
 *   │ [ảnh]    │ │ [ảnh]    │ │ [ảnh]    │ │ [ảnh]    │
 *   │ ⤢ ⟳ 🗑   │ │ ⤢ ⟳ 🗑   │ │ ⤢ ⟳ 🗑   │ │ ⤢ ⟳ 🗑   │
 *   └──────────┘ └──────────┘ └──────────┘ └──────────┘
 * ```
 *
 * 🔴 Đây là ảnh CỐ ĐỊNH của phôi (mockup, lifestyle, bảng size), không phải ảnh sản phẩm.
 * Upload một lần rồi dùng cho hàng nghìn listing.
 *
 * Kéo thả đổi vị trí dùng HTML5 drag-and-drop có sẵn của trình duyệt — thêm một thư viện
 * kéo thả chỉ để sắp bốn tấm ảnh là không đáng.
 */
export function ImageTemplateDialog({ open, template, onClose }: ImageTemplateDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate<PodImageTemplate>('images');
  const actions = useImageItemActions(template?.id ?? '');

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [uploadAssetType, setUploadAssetType] = useState<PodImageAssetType>('LIFESTYLE');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<PodImageTemplateItem | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setDisplayOrder(String(template?.displayOrder ?? 0));
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);
    setPreview(null);
  }, [open, template]);

  const items = template?.items ?? [];

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t('listing.imageTemplates.missingRequired'));
      return;
    }
    try {
      await save.mutateAsync({
        id: template?.id,
        payload: {
          name: name.trim(),
          description: description.trim() || undefined,
          displayOrder: Number(displayOrder || 0),
          isDefault,
          ...(template ? { isActive } : {}),
        },
      });
      toast.success(t('listing.common.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !template) return;
    const list = Array.from(files);
    try {
      await actions.upload.mutateAsync({
        files: list,
        // Mọi ảnh trong lần tải này nhận cùng một loại; sửa lại từng tấm ngay trên thẻ.
        assetTypes: list.map(() => uploadAssetType),
      });
      toast.success(t('listing.imageTemplates.uploaded', { count: list.length }));
    } catch (error) {
      toast.error(t('listing.imageTemplates.uploadFailed'), {
        description: translateApiError(error),
      });
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleReplace = async (itemId: string, file: File | undefined) => {
    if (!file) return;
    try {
      await actions.replace.mutateAsync({ itemId, file });
      toast.success(t('listing.imageTemplates.replaced'));
    } catch (error) {
      toast.error(t('listing.imageTemplates.uploadFailed'), {
        description: translateApiError(error),
      });
    } finally {
      if (replaceInputRef.current) replaceInputRef.current.value = '';
    }
  };

  const handleRemove = async (item: PodImageTemplateItem) => {
    if (!window.confirm(t('listing.common.confirmDelete', { name: item.title }))) return;
    try {
      await actions.remove.mutateAsync(item.id);
      toast.success(t('listing.common.deleted'));
    } catch (error) {
      toast.error(t('listing.common.deleteFailed'), { description: translateApiError(error) });
    }
  };

  /** Thả xuống vị trí mới ⇒ gửi TRỌN thứ tự mới lên server. */
  const handleDrop = async (targetIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === targetIndex) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);

    try {
      await actions.sort.mutateAsync(next.map((item) => item.id));
    } catch (error) {
      toast.error(t('listing.imageTemplates.sortFailed'), {
        description: translateApiError(error),
      });
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        className="max-w-5xl"
        title={template ? t('listing.imageTemplates.edit') : t('listing.imageTemplates.create')}
        description={t('listing.imageTemplates.dialogHint')}
      >
        <div className="max-h-[74vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label>
                {t('listing.common.name')}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                value={name}
                placeholder="Comfort Colors"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.common.displayOrder')}</Label>
              <Input
                type="number"
                min="0"
                value={displayOrder}
                onChange={(event) => setDisplayOrder(event.target.value)}
              />
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(event) => setIsDefault(event.target.checked)}
                />
                {t('listing.common.setDefault')}
              </label>
              {template && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.target.checked)}
                  />
                  {t('listing.common.active')}
                </label>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('listing.imageTemplates.description')}</Label>
            <Input
              value={description}
              placeholder={t('listing.imageTemplates.descriptionHint')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {/* --- Gallery --- */}
          {template ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {t('listing.imageTemplates.gallery', { count: items.length })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('listing.imageTemplates.galleryHint')}
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-[170px] space-y-1">
                    <Label>{t('listing.imageTemplates.uploadAs')}</Label>
                    <Combobox
                      value={uploadAssetType}
                      onChange={(value) => setUploadAssetType(value as PodImageAssetType)}
                      options={POD_IMAGE_ASSET_TYPES.map((type) => ({
                        value: type,
                        label: t(`listing.imageTemplates.types.${type}`),
                      }))}
                    />
                  </div>
                  <Button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={actions.upload.isPending}
                  >
                    {actions.upload.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {t('listing.imageTemplates.upload')}
                  </Button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => void handleUpload(event.target.files)}
                  />
                </div>
              </div>

              {items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t('listing.imageTemplates.empty')}
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item, index) => (
                    <ImageCard
                      key={item.id}
                      item={item}
                      index={index}
                      isDragging={dragIndex === index}
                      isOver={overIndex === index && dragIndex !== index}
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={() => setOverIndex(index)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setOverIndex(null);
                      }}
                      onDrop={() => void handleDrop(index)}
                      onPreview={() => setPreview(item)}
                      onReplace={() => {
                        if (!replaceInputRef.current) return;
                        replaceInputRef.current.dataset.itemId = item.id;
                        replaceInputRef.current.click();
                      }}
                      onDelete={() => void handleRemove(item)}
                      onChange={(payload) =>
                        void actions.update.mutateAsync({ itemId: item.id, payload })
                      }
                      busy={
                        (actions.replace.isPending && actions.replace.variables?.itemId === item.id) ||
                        (actions.remove.isPending && actions.remove.variables === item.id)
                      }
                    />
                  ))}
                </ul>
              )}

              <input
                ref={replaceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const itemId = event.target.dataset.itemId;
                  if (itemId) void handleReplace(itemId, event.target.files?.[0]);
                }}
              />
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('listing.imageTemplates.saveFirst')}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={save.isPending}>
              {t('common:action.close')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('common:action.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Xem ảnh cỡ lớn */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        className="max-w-3xl"
        title={preview?.title}
        description={
          preview
            ? t('listing.imageTemplates.previewMeta', {
                width: preview.width ?? '?',
                height: preview.height ?? '?',
                size: Math.round(preview.fileSize / 1024),
              })
            : undefined
        }
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt={preview.title}
            className="max-h-[70vh] w-full rounded-md border object-contain"
          />
        )}
      </Modal>
    </>
  );
}

/** Một thẻ ảnh trong gallery: thumbnail + tiêu đề + loại + ba nút thao tác. */
function ImageCard({
  item,
  index,
  isDragging,
  isOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onPreview,
  onReplace,
  onDelete,
  onChange,
  busy,
}: {
  item: PodImageTemplateItem;
  index: number;
  isDragging: boolean;
  isOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onPreview: () => void;
  onReplace: () => void;
  onDelete: () => void;
  onChange: (payload: { title?: string; assetType?: string; isRequired?: boolean }) => void;
  busy: boolean;
}) {
  const { t } = useTranslation('pod');
  const [title, setTitle] = useState(item.title);
  const debouncedTitle = useDebouncedValue(title, 600);

  useEffect(() => setTitle(item.title), [item.title]);

  // Gõ xong mới lưu — mỗi ký tự một request là vô nghĩa với ô tiêu đề.
  useEffect(() => {
    if (debouncedTitle.trim() && debouncedTitle !== item.title) onChange({ title: debouncedTitle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle]);

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={[
        'space-y-2 rounded-md border p-2 transition-colors',
        isDragging ? 'opacity-40' : '',
        isOver ? 'border-primary bg-accent/40' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="size-4 cursor-grab text-muted-foreground" />
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
        {item.isRequired && (
          <Badge variant="warning">{t('listing.imageTemplates.required')}</Badge>
        )}
      </div>

      <button
        type="button"
        onClick={onPreview}
        className="relative block h-36 w-full overflow-hidden rounded border bg-muted"
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.title} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageOff className="size-6 text-muted-foreground" />
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="size-5 animate-spin" />
          </span>
        )}
      </button>

      <Input
        value={title}
        className="h-8 text-sm"
        onChange={(event) => setTitle(event.target.value)}
      />

      <Combobox
        value={item.assetType}
        className="h-8 text-xs"
        onChange={(value) => onChange({ assetType: value })}
        options={POD_IMAGE_ASSET_TYPES.map((type) => ({
          value: type,
          label: t(`listing.imageTemplates.types.${type}`),
        }))}
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={item.isRequired}
            onChange={(event) => onChange({ isRequired: event.target.checked })}
          />
          {t('listing.imageTemplates.required')}
        </label>

        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={onPreview}>
            <Maximize2 className="size-3" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={onReplace}>
            <RefreshCw className="size-3" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={onDelete}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      <p className="truncate text-[11px] text-muted-foreground">
        {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
        {Math.round(item.fileSize / 1024)} KB
      </p>
    </li>
  );
}
