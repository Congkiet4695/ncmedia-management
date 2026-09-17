'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ManualVariation } from '../types';

/**
 * Trục biến thể: tên trục + danh sách giá trị.
 *
 * 🔴 Tách ra thành component riêng vì CẢ HAI lối vào dùng nó: form Custom Listing (màn hình
 * riêng) và dialog nhập tay trong lượt đăng. Chép hai bản là hai hành vi sẽ lệch nhau ngay
 * lần sửa đầu tiên (§16: logic chung phải dùng chung).
 */
export function VariationEditor({
  variations,
  onChange,
}: {
  variations: ManualVariation[];
  onChange: (next: ManualVariation[]) => void;
}) {
  const { t } = useTranslation('pod');

  const patch = (index: number, next: Partial<ManualVariation>) =>
    onChange(variations.map((item, i) => (i === index ? { ...item, ...next } : item)));

  return (
    <div className="space-y-2">
      {variations.map((variation, index) => (
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
          <Button
            variant="outline"
            size="sm"
            aria-label={t('listing.manual.removeVariation')}
            onClick={() => onChange(variations.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...variations, { name: '', values: [] }])}
      >
        <Plus className="size-4" />
        {t('listing.manual.addVariation')}
      </Button>
    </div>
  );
}
