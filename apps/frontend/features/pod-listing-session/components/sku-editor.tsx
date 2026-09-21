'use client';

import { ImageOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { combinationKey } from '../manual-sku';
import type { ManualSku, ManualVariation } from '../types';

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
  variations,
}: {
  skus: ManualSku[];
  onChange: (next: ManualSku[]) => void;
  /** Tiền tệ của lượt đăng (theo thị trường) — chỉ để hiện trên tiêu đề cột giá. */
  currency?: string | null;
  /** Trục biến thể — để hiện ảnh của giá trị trục đầu cạnh tên tổ hợp (chỉ hiển thị). */
  variations?: ManualVariation[];
}) {
  const { t } = useTranslation('pod');
  // Ảnh dòng = ảnh giá trị trục ĐẦU; URL chỉ để xem, thứ gửi đi là `imageFileId` đã derive.
  const firstAxis = variations?.find((variation) => variation.name.trim() !== '');
  const imageUrlByValue = new Map(
    (firstAxis?.images ?? []).filter((image) => image.url).map((image) => [image.value, image.url as string]),
  );
  const showImages = imageUrlByValue.size > 0;

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
              // 🔴 Khoá theo TỔ HỢP, không theo Seller SKU: khoá đổi theo từng ký tự gõ vào ô SKU là
              // React dựng lại cả dòng và ô đang gõ mất focus.
              <tr key={combinationKey(sku.optionValues) || String(index)} className="border-b last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  <span className="flex items-center gap-2">
                    {showImages && <VariantThumb src={variantImageUrl(sku, firstAxis, imageUrlByValue)} />}
                    {sku.optionValues.map((option) => option.value).join(' / ')}
                  </span>
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

function variantImageUrl(
  sku: ManualSku,
  firstAxis: ManualVariation | undefined,
  urls: Map<string, string>,
): string | null {
  if (!firstAxis) return null;
  const option = sku.optionValues.find((entry) => entry.name.trim() === firstAxis.name.trim());
  return option ? (urls.get(option.value.trim()) ?? null) : null;
}

/** Ảnh nhỏ cạnh tên tổ hợp — không có ảnh thì ô trống, không phải thẻ img hỏng. */
function VariantThumb({ src }: { src: string | null }) {
  if (!src) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted">
        <ImageOff className="size-3 text-muted-foreground" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="size-7 shrink-0 rounded border object-cover" />;
}
