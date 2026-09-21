'use client';

import { useState } from 'react';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  VariationImagesDialog,
  type VariationImageMap,
} from '@/features/pod-listing/components/variation-images-dialog';
import type { ManualVariation, ManualVariationImage } from '../types';

/**
 * Trục biến thể: tên trục + danh sách giá trị.
 *
 * 🔴 Tách ra thành component riêng vì CẢ HAI lối vào dùng nó: form Custom Listing (màn hình
 * riêng) và dialog nhập tay trong lượt đăng. Chép hai bản là hai hành vi sẽ lệch nhau ngay
 * lần sửa đầu tiên (§16: logic chung phải dùng chung).
 *
 * Trục ĐẦU TIÊN có nút **Ảnh biến thể** — ảnh theo giá trị (Black → black.jpg), cùng dialog với
 * SKU Template. Theo VỊ TRÍ chứ không theo tên: xoá trục đầu thì trục kế tiếp là trục có ảnh.
 */
export function VariationEditor({
  variations,
  onChange,
}: {
  variations: ManualVariation[];
  onChange: (next: ManualVariation[]) => void;
}) {
  const { t } = useTranslation('pod');
  const [imagesFor, setImagesFor] = useState<number | null>(null);

  const patch = (index: number, next: Partial<ManualVariation>) =>
    onChange(variations.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const editing = imagesFor !== null ? variations[imagesFor] : undefined;

  return (
    <div className="space-y-2">
      {variations.map((variation, index) => {
        const imageCount = (variation.images ?? []).filter((image) =>
          variation.values.map((value) => value.trim()).includes(image.value),
        ).length;
        return (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <div className="w-[180px] space-y-1">
              <Label>{t('listing.manual.variationName')}</Label>
              <Input
                value={variation.name}
                placeholder="Color"
                onChange={(event) => patch(index, { name: event.target.value })}
              />
            </div>
            <div className="min-w-[280px] flex-1 space-y-1">
              <Label>{t('listing.manual.variationValues')}</Label>
              {/* Nhập bằng dấu phẩy thay vì một ô tag: gõ "Black, White, Navy" nhanh hơn hẳn
                  bấm thêm từng thẻ, và đây là thao tác lặp lại cả ngày. */}
              <Input
                value={variation.values.join(', ')}
                placeholder="Black, White, Navy"
                onChange={(event) =>
                  patch(index, { values: event.target.value.split(',').map((value) => value.trim()) })
                }
              />
            </div>
            {index === 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={variation.values.filter((value) => value.trim()).length === 0}
                title={t('listing.variantImages.firstAxisHint')}
                onClick={() => setImagesFor(index)}
              >
                <ImageIcon className="size-4" />
                {t('listing.variantImages.action')}
                {imageCount > 0 && <span className="text-xs text-muted-foreground">({imageCount})</span>}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label={t('listing.manual.removeVariation')}
              onClick={() => onChange(variations.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...variations, { name: '', values: [] }])}
      >
        <Plus className="size-4" />
        {t('listing.manual.addVariation')}
      </Button>

      {editing && imagesFor !== null && (
        <VariationImagesDialog
          open
          axisName={editing.name.trim() || t('listing.manual.variationName')}
          values={editing.values.map((value) => value.trim()).filter(Boolean)}
          images={toImageMap(editing.images)}
          onChange={(next) => patch(imagesFor, { images: fromImageMap(next) })}
          onClose={() => setImagesFor(null)}
        />
      )}
    </div>
  );
}

/** `ManualVariationImage[]` (dạng lưu nháp) ⇄ map theo giá trị (dạng dialog dùng). */
function toImageMap(images: ManualVariationImage[] | undefined): VariationImageMap {
  return Object.fromEntries(
    (images ?? []).map((image) => [image.value, { fileId: image.fileId, url: image.url ?? null }]),
  );
}

function fromImageMap(map: VariationImageMap): ManualVariationImage[] {
  return Object.entries(map).map(([value, image]) => ({ value, fileId: image.fileId, url: image.url }));
}
