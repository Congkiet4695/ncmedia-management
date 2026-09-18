'use client';

import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ManualSku } from '../types';

/**
 * Lưới SKU — mỗi dòng một tổ hợp.
 *
 * 🔴 Ô giá tô đỏ NGAY khi gõ sai, không đợi bấm Kiểm tra: một lưới 600 dòng mà phải submit
 * mới biết dòng nào sai là bắt người dùng đi tìm kim trong đống rơm. Backend vẫn kiểm lại
 * bằng đúng luật đó (`applyManualOverride`) — đây chỉ là báo sớm, không thay thế.
 */
export function SkuEditor({
  skus,
  onChange,
  currency,
}: {
  skus: ManualSku[];
  onChange: (next: ManualSku[]) => void;
  /** Tiền tệ của lượt đăng (theo thị trường) — chỉ để hiện trên tiêu đề cột giá. */
  currency?: string | null;
}) {
  const { t } = useTranslation('pod');

  if (skus.length === 0) {
    return (
      <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        {t('listing.manual.noSku')}
      </p>
    );
  }

  const patch = (index: number, next: Partial<ManualSku>) =>
    onChange(skus.map((item, i) => (i === index ? { ...item, ...next } : item)));

  /** Seller SKU trùng — TikTok từ chối cả lô, nên đánh dấu ngay trên lưới. */
  const duplicated = new Set(
    skus.map((sku) => sku.sellerSku).filter((value, index, all) => all.indexOf(value) !== index),
  );

  return (
    <div className="max-h-[420px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 border-b bg-muted text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t('listing.manual.variant')}</th>
            <th className="px-3 py-2 text-left">{t('listing.manual.sellerSku')}</th>
            <th className="px-3 py-2 text-left">
              {t('listing.manual.retailPrice')}
              {currency ? ` (${currency})` : ''}
            </th>
            <th className="px-3 py-2 text-left">
              {t('listing.manual.listPrice')}
              {currency ? ` (${currency})` : ''}
            </th>
            <th className="px-3 py-2 text-left">{t('listing.manual.quantity')}</th>
            <th className="w-[1%] px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {skus.map((sku, index) => {
            const priceInvalid = !(Number(sku.salePrice) > 0);
            return (
              <tr key={`${sku.sellerSku}-${index}`} className="border-b last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {sku.optionValues.map((option) => option.value).join(' / ')}
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={sku.sellerSku}
                    className={cn('h-8', duplicated.has(sku.sellerSku) && 'border-destructive')}
                    onChange={(event) => patch(index, { sellerSku: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={sku.salePrice ?? ''}
                    inputMode="decimal"
                    placeholder="19.99"
                    className={cn('h-8 w-[100px]', priceInvalid && 'border-destructive')}
                    onChange={(event) => patch(index, { salePrice: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={sku.retailPrice ?? ''}
                    inputMode="decimal"
                    placeholder="29.99"
                    className="h-8 w-[100px]"
                    onChange={(event) => patch(index, { retailPrice: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    value={sku.quantity ?? 0}
                    className="h-8 w-[90px]"
                    onChange={(event) => patch(index, { quantity: Number(event.target.value) })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('listing.manual.removeSku')}
                    onClick={() => onChange(skus.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
