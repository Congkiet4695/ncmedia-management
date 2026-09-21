'use client';

import { useState } from 'react';
import { ImageIcon, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { VariationImagesDialog, type VariationImageMap } from './variation-images-dialog';

/** Một trục biến thể đang soạn: tên + danh sách giá trị dạng thẻ (+ ảnh theo giá trị ở trục đầu). */
export interface AxisDraft {
  name: string;
  values: string[];
  /**
   * Ảnh mặc định theo giá trị — chỉ trục ĐẦU TIÊN dùng (TikTok gắn `sku_img` vào sales attribute
   * đầu). Khoá là chính giá trị; xoá giá trị thì ảnh của nó cũng bị gỡ.
   */
  images?: VariationImageMap;
}

/** Tên trục gợi ý khi tạo mới — chỉ là MẶC ĐỊNH điền sẵn, người dùng đổi/xoá tuỳ ý. */
export const DEFAULT_FIRST_AXIS_NAME = 'Color';

/**
 * Bộ khai báo **trục biến thể** (Color: Black/White/Red · Size: S/M/L/XL).
 *
 * 🔴 Giá trị nhập dạng **thẻ**, không phải chuỗi ngăn cách bởi dấu phẩy: gõ xong Enter là
 * thành một thẻ, nên trùng và rỗng bị chặn NGAY tại chỗ gõ. Với chuỗi "Black, , Black" thì
 * người dùng chỉ biết mình sai sau khi bấm Tạo SKU và thấy thiếu mất một nửa số dòng.
 *
 * Sửa ở đây **không** sinh lại SKU — chỉ đổi con số xem trước và bật cảnh báo "cần tạo lại".
 */
export function SkuAxisEditor({
  axes,
  onChange,
  disabled,
}: {
  axes: AxisDraft[];
  onChange: (next: AxisDraft[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('pod');

  const patch = (index: number, next: Partial<AxisDraft>): void =>
    onChange(axes.map((axis, i) => (i === index ? { ...axis, ...next } : axis)));

  return (
    <div className="space-y-3">
      {axes.map((axis, index) => (
        <AxisRow
          key={index}
          axis={axis}
          index={index}
          disabled={disabled}
          duplicateName={axes.some(
            (other, i) =>
              i !== index &&
              other.name.trim().toLowerCase() === axis.name.trim().toLowerCase() &&
              axis.name.trim() !== '',
          )}
          onChange={(next) => patch(index, next)}
          onRemove={() => onChange(axes.filter((_, i) => i !== index))}
          canRemove={axes.length > 1}
          // 🔴 Chỉ trục ĐẦU được gắn ảnh — theo VỊ TRÍ, không theo tên: xoá Color thì Size lên
          // đầu và Size mới là trục có ảnh (ảnh của Color không theo sang).
          allowImages={index === 0}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...axes, { name: '', values: [] }])}
      >
        <Plus className="size-4" />
        {t('listing.skuTemplates.addVariant')}
      </Button>
    </div>
  );
}

function AxisRow({
  axis,
  index,
  disabled,
  duplicateName,
  onChange,
  onRemove,
  canRemove,
  allowImages,
}: {
  axis: AxisDraft;
  index: number;
  disabled?: boolean;
  duplicateName: boolean;
  onChange: (next: Partial<AxisDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
  allowImages: boolean;
}) {
  const { t } = useTranslation('pod');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const images = axis.images ?? {};
  const imageCount = axis.values.filter((value) => images[value]).length;

  /** Gỡ giá trị ⇒ gỡ luôn ảnh của nó, không để ảnh mồ côi đi theo template. */
  const removeValue = (value: string): void => {
    const nextImages = { ...images };
    delete nextImages[value];
    onChange({ values: axis.values.filter((item) => item !== value), images: nextImages });
  };

  /** Thêm một giá trị: trim · không rỗng · không trùng (không phân biệt hoa thường). */
  const addValue = (raw: string): void => {
    // Dán "Black, White, Red" từ Excel là chuyện thường ⇒ tách luôn theo dấu phẩy.
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setError(t('listing.skuTemplates.valueEmpty'));
      return;
    }

    const existing = new Set(axis.values.map((value) => value.toLowerCase()));
    const added: string[] = [];
    for (const part of parts) {
      if (existing.has(part.toLowerCase())) continue;
      existing.add(part.toLowerCase());
      added.push(part);
    }

    if (added.length === 0) {
      setError(t('listing.skuTemplates.valueDuplicate'));
      return;
    }
    onChange({ values: [...axis.values, ...added] });
    setDraft('');
    setError(null);
  };

  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[180px] space-y-1">
          <Label>{t('listing.skuTemplates.variantName')}</Label>
          <Input
            value={axis.name}
            disabled={disabled}
            placeholder={index === 0 ? 'Color' : 'Size'}
            aria-invalid={duplicateName}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>

        <div className="min-w-[280px] flex-1 space-y-1">
          <Label>
            {t('listing.skuTemplates.variantValues')}
            <span className="ml-2 text-xs text-muted-foreground">({axis.values.length})</span>
          </Label>
          <div
            className={cn(
              'flex min-h-10 flex-wrap items-center gap-1 rounded-md border p-1.5',
              error && 'border-destructive',
            )}
          >
            {axis.values.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
              >
                {value}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeValue(value)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              disabled={disabled}
              placeholder={
                axis.values.length === 0 ? t('listing.skuTemplates.valuePlaceholder') : ''
              }
              className="min-w-[120px] flex-1 bg-transparent px-1 text-sm outline-none"
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  // Enter ở đây nghĩa là "thêm giá trị", không phải submit cả dialog.
                  event.preventDefault();
                  addValue(draft);
                  return;
                }
                if (event.key === 'Backspace' && !draft && axis.values.length > 0) {
                  removeValue(axis.values[axis.values.length - 1]);
                }
              }}
              onBlur={() => draft.trim() && addValue(draft)}
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !canRemove}
          title={t('listing.skuTemplates.removeVariant')}
          onClick={onRemove}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      {duplicateName && (
        <p className="text-xs text-destructive">{t('listing.skuTemplates.variantDuplicate')}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {allowImages && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || axis.values.length === 0}
            onClick={() => setImagesOpen(true)}
          >
            <ImageIcon className="size-4" />
            {t('listing.variantImages.action')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {imageCount > 0
              ? t('listing.variantImages.count', { count: imageCount, total: axis.values.length })
              : t('listing.variantImages.firstAxisHint')}
          </span>
          {imagesOpen && (
            <VariationImagesDialog
              open
              axisName={axis.name.trim() || t('listing.skuTemplates.variantName')}
              values={axis.values}
              images={images}
              onChange={(next) => onChange({ images: next })}
              onClose={() => setImagesOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
