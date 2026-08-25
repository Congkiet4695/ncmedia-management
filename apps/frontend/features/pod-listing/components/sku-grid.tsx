'use client';

import { useMemo, useState } from 'react';
import { Download, ImageOff, Loader2, Save, Trash2, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CurrencyInput, PercentInput, QuantityInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useBulkUpdateSkuItems,
  useExportSkuItems,
  useImportSkuItems,
  useRemoveSkuItem,
  useUpdateSkuItem,
} from '../hooks/use-pod-listing';
import { podListingService } from '../services/pod-listing.service';
import type { PodSkuTemplate, PodSkuTemplateItem } from '../types';

/** Ô đang sửa của một dòng SKU (chỉ những cột người dùng thực sự đổi). */
type ItemDraft = Partial<
  Record<'skuCode' | 'barcode' | 'retailPrice' | 'salePrice' | 'quantity' | 'discount', string>
>;

/**
 * Bảng SKU đã sinh — sửa từng dòng, cập nhật hàng loạt, xoá dòng, Import/Export.
 *
 * 🔴 Tiền luôn hiển thị theo **Currency của template** (US ⇒ USD ⇒ `$`), ký hiệu do `Intl`
 * dựng chứ không viết cứng — đổi sang thị trường khác chỉ cần đổi mã tiền tệ.
 */
export function SkuGrid({ template }: { template: PodSkuTemplate }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatCurrency } = useLocaleFormat();

  const bulkUpdate = useBulkUpdateSkuItems(template.id);
  const updateItem = useUpdateSkuItem(template.id);
  const removeItem = useRemoveSkuItem(template.id);
  const exportItems = useExportSkuItems();
  const importItems = useImportSkuItems();

  const [bulk, setBulk] = useState({
    retailPrice: '',
    salePrice: '',
    quantity: '',
    discount: '',
    skuPrefix: '',
    barcodePrefix: '',
  });
  /** Điều kiện lọc theo trục: `{ Color: 'Black' }`. Bỏ trống = áp cho tất cả. */
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, ItemDraft>>({});
  const [savingGrid, setSavingGrid] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const items = template.items;
  const currency = template.currency;
  const dirtyIds = Object.keys(edits);

  /** Dòng nào sẽ bị ảnh hưởng bởi Bulk Update — tính ngay ở client để hiện số lượng. */
  const affected = useMemo(() => {
    const active = Object.entries(filters).filter(([, value]) => value);
    if (active.length === 0) return items;

    return items.filter((item) =>
      active.every(([axis, value]) =>
        (item.values ?? []).some(
          (link) => link.variantValue.variant.name === axis && link.variantValue.value === value,
        ),
      ),
    );
  }, [items, filters]);

  const valueOf = (item: PodSkuTemplateItem, key: keyof ItemDraft): string => {
    const draft = edits[item.id]?.[key];
    if (draft !== undefined) return draft;
    const current = item[key as keyof PodSkuTemplateItem];
    return current === null || current === undefined ? '' : String(current);
  };

  const setDraft = (itemId: string, patch: ItemDraft): void =>
    setEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  /**
   * Ô giá trên lưới → giá trị gửi lên API.
   *
   * `undefined` = người dùng không đụng tới ô đó · `null` = đã xoá trắng ⇒ bỏ giá ·
   * số > 0 = giá mới. KHÔNG bao giờ gửi 0: xem chú thích ở `handleSaveGrid`.
   */
  const toPrice = (value: string | undefined): number | null | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const handleBulkUpdate = async (): Promise<void> => {
    const payload = {
      filters: Object.entries(filters)
        .filter(([, value]) => value)
        .map(([variantName, value]) => ({ variantName, value })),
      retailPrice: bulk.retailPrice ? Number(bulk.retailPrice) : undefined,
      salePrice: bulk.salePrice ? Number(bulk.salePrice) : undefined,
      quantity: bulk.quantity ? Number(bulk.quantity) : undefined,
      discount: bulk.discount ? Number(bulk.discount) : undefined,
      skuPrefix: bulk.skuPrefix.trim() || undefined,
      barcodePrefix: bulk.barcodePrefix.trim() || undefined,
    };

    const hasValue = [
      payload.retailPrice,
      payload.salePrice,
      payload.quantity,
      payload.discount,
      payload.skuPrefix,
      payload.barcodePrefix,
    ].some((value) => value !== undefined);
    if (!hasValue) {
      toast.error(t('listing.skuTemplates.bulkEmpty'));
      return;
    }

    try {
      await bulkUpdate.mutateAsync({
        ...payload,
        filters: payload.filters.length > 0 ? payload.filters : undefined,
      });
      toast.success(t('listing.skuTemplates.bulkUpdated'));
      setBulk({
        retailPrice: '',
        salePrice: '',
        quantity: '',
        discount: '',
        skuPrefix: '',
        barcodePrefix: '',
      });
      setEdits({});
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  /** Ghi các dòng ĐÃ ĐỔI. Dòng không đụng tới thì không gửi request — bảng có thể 500 dòng. */
  const handleSaveGrid = async (): Promise<void> => {
    if (dirtyIds.length === 0) return;
    setSavingGrid(true);
    try {
      for (const itemId of dirtyIds) {
        const draft = edits[itemId];
        await updateItem.mutateAsync({
          itemId,
          payload: {
            skuCode: draft.skuCode,
            barcode: draft.barcode,
            // 🔴 Ô để trống nghĩa là XOÁ GIÁ (null), KHÔNG phải "giá 0". `Number('')` ra 0, và
            // một tổ hợp mang giá 0 vừa che mất phương án dự phòng (giá gốc − % giảm, Pricing
            // Template) vừa bị cổng validate chặn vì TikTok không nhận SKU giá 0.
            retailPrice: toPrice(draft.retailPrice),
            salePrice: toPrice(draft.salePrice),
            quantity: draft.quantity === undefined ? undefined : Number(draft.quantity),
            discount: toPrice(draft.discount),
          },
        });
      }
      setEdits({});
      toast.success(t('listing.skuTemplates.gridSaved', { count: dirtyIds.length }));
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    } finally {
      setSavingGrid(false);
    }
  };

  const handleRemove = async (item: PodSkuTemplateItem): Promise<void> => {
    if (!window.confirm(t('listing.skuTemplates.deleteItemConfirm', { name: item.variantName })))
      return;
    try {
      await removeItem.mutateAsync(item.id);
      toast.success(t('listing.skuTemplates.itemDeleted'));
    } catch (error) {
      toast.error(t('listing.common.deleteFailed'), { description: translateApiError(error) });
    }
  };

  const handleUploadImage = async (itemId: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploadingFor(itemId);
    try {
      const uploaded = await podListingService.uploadAsset(file);
      await updateItem.mutateAsync({ itemId, payload: { imageFileId: uploaded.id } });
    } catch (error) {
      toast.error(t('listing.imageTemplates.uploadFailed'), {
        description: translateApiError(error),
      });
    } finally {
      setUploadingFor(null);
    }
  };

  const handleImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const result = await importItems.mutateAsync({ templateId: template.id, file });
      if (result.failed > 0) {
        toast.error(t('listing.skuTemplates.importFailedRows', { count: result.failed }), {
          description: result.errors
            .slice(0, 3)
            .map((error) => `${t('listing.skuTemplates.row')} ${error.row}: ${error.message}`)
            .join(' · '),
        });
      } else {
        toast.success(t('listing.skuTemplates.imported', { count: result.updated }));
        setEdits({});
      }
    } catch (error) {
      toast.error(t('listing.transfer.importFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t('listing.skuTemplates.itemsTitle', { count: items.length })}
        </p>
        <div className="flex flex-wrap gap-2">
          <FilePickerButton
            accept=".xlsx"
            busy={importItems.isPending}
            icon={<Upload className="size-4" />}
            label={t('listing.skuTemplates.importExcel')}
            onPick={(file) => void handleImport(file)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={exportItems.isPending}
            onClick={() =>
              void exportItems
                .mutateAsync({ templateId: template.id, name: template.name })
                .catch((error: unknown) =>
                  toast.error(t('listing.transfer.exportFailed'), {
                    description: translateApiError(error),
                  }),
                )
            }
          >
            {exportItems.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {t('listing.skuTemplates.exportExcel')}
          </Button>
          <Button size="sm" disabled={dirtyIds.length === 0 || savingGrid} onClick={() => void handleSaveGrid()}>
            {savingGrid ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('listing.skuTemplates.saveGrid', { count: dirtyIds.length })}
          </Button>
        </div>
      </div>

      {/* --- Cập nhật hàng loạt: lọc theo trục rồi áp giá / tồn / tiền tố --- */}
      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <p className="mb-2 w-full text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('listing.skuTemplates.bulkTitle')}
          </p>

          {template.variants.map((variant) => (
            <div key={variant.name} className="w-[150px] space-y-1">
              <Label>{variant.name}</Label>
              <Combobox
                value={filters[variant.name] ?? ''}
                onChange={(value) => setFilters((prev) => ({ ...prev, [variant.name]: value }))}
                options={[
                  { value: '', label: t('listing.skuTemplates.allValues') },
                  ...variant.values.map((value) => ({ value: value.value, label: value.value })),
                ]}
              />
            </div>
          ))}

          <div className="w-[130px] space-y-1">
            <Label>{t('listing.common.retailPrice')}</Label>
            <CurrencyInput
              currency={currency}
              value={bulk.retailPrice}
              onChange={(event) => setBulk((prev) => ({ ...prev, retailPrice: event.target.value }))}
            />
          </div>
          <div className="w-[130px] space-y-1">
            <Label>{t('listing.common.salePrice')}</Label>
            <CurrencyInput
              currency={currency}
              value={bulk.salePrice}
              onChange={(event) => setBulk((prev) => ({ ...prev, salePrice: event.target.value }))}
            />
          </div>
          <div className="w-[110px] space-y-1">
            <Label>{t('listing.common.quantity')}</Label>
            <QuantityInput
              value={bulk.quantity}
              onChange={(event) => setBulk((prev) => ({ ...prev, quantity: event.target.value }))}
            />
          </div>
          <div className="w-[110px] space-y-1">
            <Label>{t('listing.pricing.discount')}</Label>
            <PercentInput
              value={bulk.discount}
              onChange={(event) => setBulk((prev) => ({ ...prev, discount: event.target.value }))}
            />
          </div>
          <div className="w-[130px] space-y-1">
            <Label>{t('listing.skuTemplates.bulkSkuPrefix')}</Label>
            <Input
              value={bulk.skuPrefix}
              placeholder="POSTER"
              onChange={(event) => setBulk((prev) => ({ ...prev, skuPrefix: event.target.value }))}
            />
          </div>
          <div className="w-[130px] space-y-1">
            <Label>{t('listing.skuTemplates.bulkBarcodePrefix')}</Label>
            <Input
              value={bulk.barcodePrefix}
              placeholder="ABC"
              onChange={(event) =>
                setBulk((prev) => ({ ...prev, barcodePrefix: event.target.value }))
              }
            />
          </div>

          <Button
            variant="outline"
            disabled={bulkUpdate.isPending || affected.length === 0}
            onClick={() => void handleBulkUpdate()}
          >
            {bulkUpdate.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('listing.skuTemplates.applyTo', { count: affected.length })}
          </Button>
        </div>
      </div>

      <div className="max-h-[360px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.skuTemplates.item')}</TableHead>
              <TableHead className="text-right">{t('listing.common.retailPrice')}</TableHead>
              <TableHead className="text-right">{t('listing.common.salePrice')}</TableHead>
              <TableHead className="text-right">{t('listing.common.quantity')}</TableHead>
              <TableHead className="text-right">{t('listing.pricing.discount')}</TableHead>
              {/* Con số THẬT sẽ gửi lên TikTok — do server tính bằng đúng hàm mà bộ giải
                  listing dùng, không phải một phép tính riêng của màn hình. */}
              <TableHead className="text-right">
                {t('listing.skuTemplates.effectivePrice')}
              </TableHead>
              <TableHead>{t('listing.skuTemplates.barcode')}</TableHead>
              <TableHead>{t('listing.skuTemplates.skuCode')}</TableHead>
              <TableHead>{t('listing.skuTemplates.image')}</TableHead>
              <TableHead className="text-right">{t('listing.skuTemplates.action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className={item.isActive ? '' : 'opacity-50'}>
                <TableCell className="whitespace-nowrap">
                  <span className="text-sm font-medium">{item.variantName}</span>
                  {/* Số lượng tồn — giá nằm ở cột "giá bán hiệu lực" bên phải. */}
                  <p className="text-xs text-muted-foreground">
                    {t('listing.skuTemplates.stock', { count: item.quantity })}
                  </p>
                </TableCell>
                <TableCell>
                  <CurrencyInput
                    currency={currency}
                    className="h-8 w-[110px]"
                    value={valueOf(item, 'retailPrice')}
                    onChange={(event) => setDraft(item.id, { retailPrice: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <CurrencyInput
                    currency={currency}
                    className="h-8 w-[110px]"
                    value={valueOf(item, 'salePrice')}
                    onChange={(event) => setDraft(item.id, { salePrice: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <QuantityInput
                    className="h-8 w-[90px]"
                    value={valueOf(item, 'quantity')}
                    onChange={(event) => setDraft(item.id, { quantity: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <PercentInput
                    className="h-8 w-[90px]"
                    value={valueOf(item, 'discount')}
                    onChange={(event) => setDraft(item.id, { discount: event.target.value })}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm">
                  {item.effectiveSalePrice ? (
                    <span className="font-medium">
                      {formatCurrency(item.effectiveSalePrice, currency)}
                      {/* Giá gốc gạch ngang chỉ hiện khi thật sự cao hơn giá bán. */}
                      {item.effectiveRetailPrice && (
                        <span className="ml-1 text-xs text-muted-foreground line-through">
                          {formatCurrency(item.effectiveRetailPrice, currency)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('listing.skuTemplates.priceFromTemplate')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-[130px] font-mono text-xs"
                    value={valueOf(item, 'barcode')}
                    onChange={(event) => setDraft(item.id, { barcode: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-[150px] font-mono text-xs"
                    value={valueOf(item, 'skuCode')}
                    onChange={(event) => setDraft(item.id, { skuCode: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {item.image?.publicUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image.publicUrl}
                        alt={item.variantName}
                        className="size-8 rounded border object-cover"
                      />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded border bg-muted">
                        <ImageOff className="size-3 text-muted-foreground" />
                      </span>
                    )}
                    <FilePickerButton
                      accept="image/*"
                      busy={uploadingFor === item.id}
                      icon={<Upload className="size-3" />}
                      onPick={(file) => void handleUploadImage(item.id, file)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label={t('listing.skuTemplates.enabled')}
                        checked={item.isActive}
                        onChange={() =>
                          void updateItem.mutateAsync({
                            itemId: item.id,
                            payload: { isActive: !item.isActive },
                          })
                        }
                      />
                      {t('listing.skuTemplates.enabled')}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('common:action.delete')}
                      onClick={() => void handleRemove(item)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dirtyIds.length > 0 && (
        <Badge variant="warning">
          <Wand2 className="mr-1 size-3" />
          {t('listing.skuTemplates.unsavedRows', { count: dirtyIds.length })}
        </Badge>
      )}
    </div>
  );
}

/** Nút chọn file — mỗi nút một `<input type=file>` riêng, không dùng chung ref. */
function FilePickerButton({
  accept,
  busy,
  icon,
  label,
  onPick,
}: {
  accept: string;
  busy: boolean;
  icon: React.ReactNode;
  label?: string;
  onPick: (file: File | undefined) => void;
}) {
  const [key, setKey] = useState(0);
  const inputId = `file-${key}-${accept}`;

  return (
    <>
      <Button variant="outline" size="sm" className={label ? '' : 'h-8 px-2'} disabled={busy} asChild>
        <label htmlFor={inputId} className="cursor-pointer">
          {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
          {label}
        </label>
      </Button>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          // Đổi key ⇒ input mới ⇒ chọn lại đúng file vừa chọn vẫn kích hoạt onChange.
          setKey((prev) => prev + 1);
        }}
      />
    </>
  );
}
