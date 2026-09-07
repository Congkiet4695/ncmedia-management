'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput, PercentInput, QuantityInput } from '@/components/ui/currency-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import {
  dealPriceFromDiscount,
  dealPriceIssue,
  discountFromDealPrice,
  formatAmount,
  formatQuantityLimit,
  isValidQuantityLimit,
  parseAmount,
  parseQuantityLimit,
} from '../price-math';
import type { PodFlashSaleItem, UpdateFlashSaleItemPayload } from '../types';

interface FlashSaleItemTableProps {
  items: PodFlashSaleItem[];
  /** Đợt sale còn sửa được không — trạng thái RUNNING/ENDED khoá toàn bộ thao tác ghi. */
  editable: boolean;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onSaveItem: (itemId: string, payload: UpdateFlashSaleItemPayload) => void;
  onDeleteItem: (itemId: string) => void;
  savingItemId?: string | null;
}

/** Bản nháp đang sửa của MỘT dòng — chỉ tồn tại trong lúc dòng đó ở chế độ sửa. */
interface RowDraft {
  dealPrice: string;
  discount: string;
  totalLimit: string;
  customerLimit: string;
}

/**
 * Bảng sản phẩm của một đợt Flash Sale — nơi người vận hành dành phần lớn thời gian.
 *
 * ```
 *   ☑ │ ảnh │ Sản phẩm / SKU │ Retail │ Deal │ % │ Tổng │ /Khách │ Trạng thái │ ⋯
 * ```
 *
 * 🔴 **Hai ô giá là hai mặt của một con số.** Gõ Deal Price thì % tự tính, gõ % thì Deal
 * Price tự tính — theo đúng giá gốc của CHÍNH dòng đó. Đây là chỗ dễ sai nhất của cả màn
 * hình: để hai ô rời nhau là người dùng thấy "giảm 30%" bên cạnh một con số không phải 30%
 * của giá gốc.
 *
 * 🔴 Phép tính ở đây chỉ để **xem trước tại chỗ**. Giá thật do server tính lại khi lưu, và
 * bảng luôn vẽ lại theo response — xem `price-math.ts`.
 */
export function FlashSaleItemTable({
  items,
  editable,
  selectedIds,
  onSelectionChange,
  onSaveItem,
  onDeleteItem,
  savingItemId,
}: FlashSaleItemTableProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatCurrency } = useLocaleFormat();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);

  // Đợt sale chuyển sang trạng thái không sửa được (vừa publish xong) trong lúc một dòng
  // đang mở ⇒ đóng nó lại, đừng để người dùng gõ vào một form sẽ bị từ chối.
  useEffect(() => {
    if (!editable) {
      setEditingId(null);
      setDraft(null);
    }
  }, [editable]);

  const selected = new Set(selectedIds);
  const selectableIds = items.map((item) => item.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleAll = (): void => {
    onSelectionChange(allSelected ? [] : selectableIds);
  };

  const toggleOne = (itemId: string): void => {
    onSelectionChange(
      selected.has(itemId) ? selectedIds.filter((id) => id !== itemId) : [...selectedIds, itemId],
    );
  };

  const startEdit = (item: PodFlashSaleItem): void => {
    setEditingId(item.id);
    setDraft({
      dealPrice: formatAmount(parseAmount(item.flashSalePrice)),
      discount: item.discountPercent,
      totalLimit: formatQuantityLimit(item.totalPurchaseLimit),
      customerLimit: formatQuantityLimit(item.customerPurchaseLimit),
    });
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setDraft(null);
  };

  /** Gõ Deal Price ⇒ tính lại %. */
  const onDealPriceChange = (item: PodFlashSaleItem, raw: string): void => {
    const original = parseAmount(item.originalPrice);
    const deal = parseAmount(raw);
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            dealPrice: raw,
            discount:
              original !== null && deal !== null
                ? String(discountFromDealPrice(original, deal))
                : '',
          },
    );
  };

  /** Gõ % ⇒ tính lại Deal Price trên giá gốc của chính dòng này. */
  const onDiscountChange = (item: PodFlashSaleItem, raw: string): void => {
    const original = parseAmount(item.originalPrice);
    const percent = parseAmount(raw);
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            discount: raw,
            dealPrice:
              original !== null && percent !== null
                ? formatAmount(dealPriceFromDiscount(original, percent))
                : '',
          },
    );
  };

  const saveRow = (item: PodFlashSaleItem): void => {
    if (!draft) return;
    onSaveItem(item.id, {
      // Gửi GIÁ (không phải %): giá là con số người dùng nhìn thấy và xác nhận. Gửi % thì
      // server tính lại và có thể ra một con số lệch một xu so với thứ họ vừa đọc.
      flashSalePrice: parseAmount(draft.dealPrice) ?? undefined,
      totalPurchaseLimit: parseQuantityLimit(draft.totalLimit),
      customerPurchaseLimit: parseQuantityLimit(draft.customerLimit),
    });
    cancelEdit();
  };

  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t('flashSale.items.empty')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-9 pr-0">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedIds.length > 0 && !allSelected}
                onChange={toggleAll}
                aria-label={t('flashSale.items.selectAll')}
              />
            </TableHead>
            <TableHead className="w-14" />
            <TableHead>{t('flashSale.items.product')}</TableHead>
            <TableHead>{t('flashSale.items.sku')}</TableHead>
            <TableHead className="text-right">{t('flashSale.items.retailPrice')}</TableHead>
            <TableHead className="w-32 text-right">{t('flashSale.items.dealPrice')}</TableHead>
            <TableHead className="w-28 text-right">{t('flashSale.items.discount')}</TableHead>
            <TableHead className="w-24 text-right">{t('flashSale.items.totalLimit')}</TableHead>
            <TableHead className="w-24 text-right">{t('flashSale.items.customerLimit')}</TableHead>
            <TableHead>{t('flashSale.items.status')}</TableHead>
            <TableHead className="w-24 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const issue = isEditing
              ? dealPriceIssue(parseAmount(item.originalPrice), parseAmount(draft?.dealPrice ?? ''))
              : null;
            const limitsValid =
              !isEditing ||
              (isValidQuantityLimit(parseQuantityLimit(draft?.totalLimit ?? '')) &&
                isValidQuantityLimit(parseQuantityLimit(draft?.customerLimit ?? '')));

            return (
              <TableRow key={item.id}>
                <TableCell className="pr-0">
                  <Checkbox
                    checked={selected.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    aria-label={item.productTitle ?? item.id}
                  />
                </TableCell>

                <TableCell>
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      width={40}
                      height={40}
                      unoptimized
                      className="size-10 rounded object-cover"
                    />
                  ) : (
                    <div className="size-10 rounded bg-muted" />
                  )}
                </TableCell>

                <TableCell className="max-w-[260px]">
                  <p className="truncate text-sm font-medium">{item.productTitle ?? '—'}</p>
                  {item.variantName && (
                    <p className="truncate text-xs text-muted-foreground">{item.variantName}</p>
                  )}
                  {item.error && <p className="text-xs text-destructive">{item.error}</p>}
                </TableCell>

                <TableCell className="font-mono text-xs">{item.skuId ?? '—'}</TableCell>

                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCurrency(item.originalPrice, item.currency)}
                </TableCell>

                <TableCell className="text-right">
                  {isEditing ? (
                    <CurrencyInput
                      currency={item.currency}
                      value={draft?.dealPrice ?? ''}
                      onChange={(event) => onDealPriceChange(item, event.target.value)}
                      aria-invalid={issue !== null}
                      className="h-9"
                    />
                  ) : (
                    <span className="font-medium tabular-nums">
                      {formatCurrency(item.flashSalePrice, item.currency)}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {isEditing ? (
                    <PercentInput
                      value={draft?.discount ?? ''}
                      onChange={(event) => onDiscountChange(item, event.target.value)}
                      className="h-9"
                    />
                  ) : (
                    <span className="tabular-nums">{Number(item.discountPercent).toFixed(2)}%</span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {isEditing ? (
                    <QuantityInput
                      min={-1}
                      max={99}
                      value={draft?.totalLimit ?? ''}
                      onChange={(event) =>
                        setDraft((current) =>
                          current === null
                            ? current
                            : { ...current, totalLimit: event.target.value },
                        )
                      }
                      className="h-9"
                      placeholder={t('flashSale.items.unlimitedShort')}
                    />
                  ) : (
                    <span className="tabular-nums">
                      {item.totalPurchaseLimit === -1
                        ? t('flashSale.items.unlimitedShort')
                        : item.totalPurchaseLimit}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {isEditing ? (
                    <QuantityInput
                      min={-1}
                      max={99}
                      value={draft?.customerLimit ?? ''}
                      onChange={(event) =>
                        setDraft((current) =>
                          current === null
                            ? current
                            : { ...current, customerLimit: event.target.value },
                        )
                      }
                      className="h-9"
                      placeholder={t('flashSale.items.unlimitedShort')}
                    />
                  ) : (
                    <span className="tabular-nums">
                      {item.customerPurchaseLimit === -1
                        ? t('flashSale.items.unlimitedShort')
                        : item.customerPurchaseLimit}
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <ListingStatusBadge
                    status={item.status}
                    label={t(`flashSale.itemStatus.${item.status}`)}
                  />
                </TableCell>

                <TableCell className="text-right">
                  {!editable ? null : isEditing ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => saveRow(item)}
                        disabled={issue !== null || !limitsValid || savingItemId === item.id}
                        aria-label={t('common:action.save')}
                        title={issue ? t(`flashSale.priceIssue.${issue}`) : t('common:action.save')}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={cancelEdit}
                        aria-label={t('common:action.cancel')}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startEdit(item)}
                        aria-label={t('common:action.edit')}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onDeleteItem(item.id)}
                        aria-label={t('common:action.delete')}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
