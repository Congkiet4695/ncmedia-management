'use client';

import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { PodProductVariant } from '../types';
import {
  cleanPatch,
  hasPatch,
  listVariationValues,
  matchSkus,
  type BulkSkuPatch,
  type VariationValue,
} from './bulk-sku';

export type { BulkSkuPatch } from './bulk-sku';

/**
 * Thanh **cập nhật SKU hàng loạt**.
 *
 * ```
 *   Lọc theo biến thể:  [Đen ×12] [Trắng ×12] [S ×8] [M ×8] …
 *   Giá bán [____]  Giá gạch [____]  Tồn kho [____]   → Áp dụng cho 12 SKU
 * ```
 *
 * 🔴 **Luôn hiện số SKU sẽ bị ảnh hưởng, ngay trên nút bấm.** Đây là thao tác sửa giá hàng
 * loạt trên một sản phẩm đang bán; người dùng phải thấy "12 SKU" trước khi bấm chứ không
 * phải sau khi bấm. Không chọn gì = tất cả SKU, và con số vẫn nói đúng điều đó.
 *
 * 🔴 Áp dụng chỉ ghi vào form, **chưa gửi đi đâu cả**. Người dùng còn xem lại bảng bên dưới
 * rồi mới bấm Lưu — và lúc đó backend còn diff thêm một lần nữa.
 */
export function BulkSkuBar({
  variants,
  onApply,
}: {
  variants: PodProductVariant[];
  onApply: (patch: BulkSkuPatch, matchedSkuIds: string[]) => void;
}) {
  const { t } = useTranslation('pod');
  const [selected, setSelected] = useState<VariationValue[]>([]);
  const [patch, setPatch] = useState<BulkSkuPatch>({});

  const values = useMemo(() => listVariationValues(variants), [variants]);
  const matched = useMemo(() => matchSkus(variants, selected), [variants, selected]);

  const toggle = (value: VariationValue) => {
    setSelected((prev) => {
      const exists = prev.some((item) => item.axis === value.axis && item.value === value.value);
      return exists
        ? prev.filter((item) => !(item.axis === value.axis && item.value === value.value))
        : [...prev, value];
    });
  };

  const apply = () => {
    const clean = cleanPatch(patch);
    if (!hasPatch(clean) || matched.length === 0) return;
    onApply(clean, matched);
    setPatch({});
  };

  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Layers className="size-4" />
        {t('products.edit.bulkTitle')}
      </h4>

      {values.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">{t('products.edit.bulkFilter')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {values.map((value) => {
              const active = selected.some(
                (item) => item.axis === value.axis && item.value === value.value,
              );
              return (
                <button
                  key={`${value.axis}-${value.value}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-accent',
                  )}
                >
                  {value.value}
                  <span className={cn('ml-1', active ? 'opacity-80' : 'text-muted-foreground')}>
                    {value.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <BulkField
          label={t('products.edit.retailPrice')}
          value={patch.salePrice ?? ''}
          onChange={(salePrice) => setPatch((prev) => ({ ...prev, salePrice }))}
        />
        <BulkField
          label={t('products.edit.listPrice')}
          value={patch.listPrice ?? ''}
          onChange={(listPrice) => setPatch((prev) => ({ ...prev, listPrice }))}
        />
        <BulkField
          label={t('products.edit.quantity')}
          value={patch.quantity ?? ''}
          onChange={(quantity) => setPatch((prev) => ({ ...prev, quantity }))}
        />

        {/* 🔴 Số SKU nằm TRÊN nút, không nằm trong toast sau khi bấm. */}
        <Button
          type="button"
          variant="outline"
          onClick={apply}
          disabled={!hasPatch(patch) || matched.length === 0}
        >
          {t('products.edit.bulkApply', { count: matched.length })}
        </Button>

        {selected.length > 0 && (
          <Badge variant="muted">{t('products.edit.bulkSelected', { count: selected.length })}</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t('products.edit.bulkHint')}</p>
    </section>
  );
}

function BulkField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        inputMode="decimal"
        className="h-8 w-[110px]"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
