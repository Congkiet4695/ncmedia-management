'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useUpdateSessionProduct } from '../hooks';
import type { PodSessionProduct } from '../types';

/** Trần ảnh của một sản phẩm — đúng bằng số cột URL trong file import. */
const MAX_IMAGES = 10;

/**
 * Sửa MỘT Draft Product: **tiêu đề và danh sách ảnh gốc**. Hết.
 *
 * 🔴 Không có ô nào cho mô tả, biến thể, giá, tồn, danh mục hay shop — tất cả đến từ bộ
 * template của lượt đăng. Đây chính là điều làm file import chỉ cần 11 cột: người vận hành
 * cung cấp đúng thứ mà template không thể biết, phần còn lại hệ thống tự dựng.
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
  const [images, setImages] = useState<string[]>([]);
  const [newImage, setNewImage] = useState('');

  useEffect(() => {
    if (!product) return;
    setTitle(product.title);
    setImages(product.images.map((image) => image.imageUrl));
    setNewImage('');
  }, [product]);

  if (!product) return null;

  const readOnly = product.status === 'UPLOADED' || product.status === 'QUEUED';
  const full = images.length >= MAX_IMAGES;

  const addImage = (): void => {
    const url = newImage.trim();
    if (!url) return;
    if (full) {
      toast.error(t('listing.products.imageLimit', { max: MAX_IMAGES }));
      return;
    }
    if (images.includes(url)) {
      toast.error(t('listing.products.imageDuplicate'));
      return;
    }
    setImages((prev) => [...prev, url]);
    setNewImage('');
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
          images: images.map((imageUrl, index) => ({ imageUrl, sortOrder: index })),
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
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            {t('listing.products.readOnly')}
          </div>
        )}

        {product.issues && product.issues.length > 0 && (
          <ul className="space-y-1 rounded-md border p-3 text-sm">
            {product.issues.map((issue, index) => (
              <li
                key={index}
                className={issue.level === 'ERROR' ? 'text-destructive' : 'text-amber-600'}
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

        {/* --- Ảnh gốc (URL1 → URL10) --- */}
        <div className="space-y-2 rounded-md border p-3">
          <Label>{t('listing.products.images', { count: images.length })}</Label>
          <div className="flex flex-wrap gap-2">
            {images.map((url, index) => (
              <div key={`${url}-${index}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="size-16 rounded border object-cover" />
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
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            ))}
            {images.length === 0 && (
              <span className="flex size-16 items-center justify-center rounded border bg-muted">
                <ImageOff className="size-5 text-muted-foreground" />
              </span>
            )}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              <Input
                value={newImage}
                placeholder="https://cdn.example/front.jpg"
                disabled={full}
                onChange={(event) => setNewImage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addImage();
                }}
              />
              <Button variant="outline" disabled={full} onClick={addImage}>
                <Plus className="size-4" />
                {t('listing.products.addImage')}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('listing.products.imageHint', { max: MAX_IMAGES })}
          </p>
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
            <Button onClick={() => void handleSave()} disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('common:action.save')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
