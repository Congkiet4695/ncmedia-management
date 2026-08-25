'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CurrencyInput, PercentInput, QuantityInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { useQueryClient } from '@tanstack/react-query';
import { useApiError } from '@/hooks/use-api-error';
import { usePodTemplate, useSavePodTemplate } from '../hooks/use-pod-listing';
import { podListingService } from '../services/pod-listing.service';
import { POD_MARKET_CURRENCIES } from '../types';
import type { PodSkuTemplate } from '../types';
import { SkuAxisEditor, type AxisDraft } from './sku-axis-editor';
import { SkuGrid } from './sku-grid';

interface SkuTemplateDialogProps {
  open: boolean;
  template: PodSkuTemplate | null;
  onClose: () => void;
}

/**
 * Form SKU Template — **SKU Generator**.
 *
 * ```
 *   Tên  →  Khai báo trục biến thể  →  [Tạo SKU]  →  Bảng SKU (sửa từng dòng / hàng loạt)
 * ```
 *
 * 🔴 Lưu template KHÔNG sinh SKU. Sửa trục chỉ đổi con số xem trước và bật cảnh báo "cần tạo
 * lại"; bảng SKU chỉ bị ghi lại khi người dùng bấm **Tạo SKU**. Tự sinh sau mỗi lần gõ là
 * cách chắc chắn nhất để xoá sạch giá/tồn vừa nhập tay cho hàng chục dòng.
 */
export function SkuTemplateDialog({ open, template, onClose }: SkuTemplateDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate<PodSkuTemplate>('skus');
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  // Id của template đang soạn: template có sẵn, hoặc bản vừa được lưu trong phiên này.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const detail = usePodTemplate<PodSkuTemplate>('skus', templateId ?? undefined);
  const current = templateId ? (detail.data ?? null) : null;

  const [name, setName] = useState('');
  const [axes, setAxes] = useState<AxisDraft[]>([{ name: '', values: [] }]);
  const [skuPrefix, setSkuPrefix] = useState('');
  const [skuSuffix, setSkuSuffix] = useState('');
  const [defaults, setDefaults] = useState({
    retail: '',
    sale: '',
    quantity: '0',
    discount: '',
    currency: 'USD',
  });
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setTemplateId(template?.id ?? null);
    setName(template?.name ?? '');
    setAxes(
      template?.variants?.length
        ? template.variants.map((variant) => ({
            name: variant.name,
            values: variant.values.map((value) => value.value),
          }))
        : [{ name: '', values: [] }],
    );
    setSkuPrefix(template?.skuPrefix ?? '');
    setSkuSuffix(template?.skuSuffix ?? '');
    setDefaults({
      retail: template?.defaultRetailPrice ?? '',
      sale: template?.defaultSalePrice ?? '',
      quantity: String(template?.defaultQuantity ?? 0),
      discount: template?.defaultDiscount ?? '',
      currency: template?.currency ?? 'USD',
    });
    setDisplayOrder(String(template?.displayOrder ?? 0));
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);
  }, [open, template]);

  /** Trục đã làm sạch — dùng cho cả xem trước lẫn payload gửi lên. */
  const cleanedAxes = useMemo(
    () =>
      axes
        .map((axis, index) => ({
          name: axis.name.trim(),
          sortOrder: index,
          values: axis.values.map((value, valueIndex) => ({ value, sortOrder: valueIndex })),
        }))
        .filter((axis) => axis.name && axis.values.length > 0),
    [axes],
  );

  /** "Color (3) × Size (6) = 18 SKU" — biết trước mình sắp tạo ra bao nhiêu dòng. */
  const preview = useMemo(() => {
    const total = cleanedAxes.reduce(
      (product, axis) => product * axis.values.length,
      cleanedAxes.length > 0 ? 1 : 0,
    );
    return {
      total,
      formula: cleanedAxes.map((axis) => `${axis.name} (${axis.values.length})`).join(' × '),
    };
  }, [cleanedAxes]);

  /** Lý do KHÔNG cho bấm Tạo SKU — hiển thị luôn cho người dùng biết phải sửa gì. */
  const blocker = useMemo(() => {
    if (!name.trim()) return t('listing.skuTemplates.missingName');
    if (cleanedAxes.length === 0) return t('listing.skuTemplates.missingVariant');

    const names = cleanedAxes.map((axis) => axis.name.toLowerCase());
    if (new Set(names).size !== names.length) return t('listing.skuTemplates.variantDuplicate');
    return null;
  }, [name, cleanedAxes, t]);

  /**
   * Trục trên màn hình đã khác trục đã lưu chưa.
   *
   * Khác ⇒ dù server nói gì thì bảng SKU đang xem cũng là của bộ trục CŨ, phải cảnh báo.
   */
  const axesDirty = useMemo(() => {
    if (!current) return cleanedAxes.length > 0;
    const shape = (list: Array<{ name: string; values: string[] }>): string =>
      list.map((axis) => `${axis.name.toLowerCase()}:${axis.values.join('|').toLowerCase()}`).join(';');

    return (
      shape(cleanedAxes.map((axis) => ({ name: axis.name, values: axis.values.map((v) => v.value) }))) !==
      shape(
        current.variants.map((variant) => ({
          name: variant.name,
          values: variant.values.map((value) => value.value),
        })),
      )
    );
  }, [cleanedAxes, current]);

  const needsRegenerate = Boolean(current && (current.isStale || axesDirty));

  const payload = (): Record<string, unknown> => ({
    name: name.trim(),
    variants: cleanedAxes,
    skuPrefix: skuPrefix || undefined,
    skuSuffix: skuSuffix || undefined,
    defaultRetailPrice: defaults.retail ? Number(defaults.retail) : undefined,
    defaultSalePrice: defaults.sale ? Number(defaults.sale) : undefined,
    defaultQuantity: Number(defaults.quantity || 0),
    defaultDiscount: defaults.discount ? Number(defaults.discount) : undefined,
    currency: defaults.currency,
    displayOrder: Number(displayOrder || 0),
    isDefault,
    ...(templateId ? { isActive } : {}),
  });

  /** Lưu trục + giá trị mặc định. KHÔNG sinh SKU. */
  const handleSave = async (silent = false): Promise<PodSkuTemplate | null> => {
    if (blocker) {
      toast.error(blocker);
      return null;
    }
    try {
      const saved = await save.mutateAsync({ id: templateId ?? undefined, payload: payload() });
      setTemplateId(saved.id);
      if (!silent) toast.success(t('listing.common.saved'));
      return saved;
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  /**
   * **Tạo SKU**: lưu trục trước rồi sinh tổ hợp — một cú bấm, không bắt người dùng nhớ thứ tự.
   *
   * Gọi thẳng service (không qua hook) vì template vừa tạo mới có id ngay trong hàm này;
   * hook thì phải đợi render kế tiếp mới biết id.
   */
  const handleGenerate = async (): Promise<void> => {
    const saved = await handleSave(true);
    if (!saved) return;

    setGenerating(true);
    try {
      const result = await podListingService.generateSkuItems(saved.id);
      await queryClient.invalidateQueries({ queryKey: ['pod-listing'] });
      toast.success(t('listing.skuTemplates.generated', { count: result.items.length }));
    } catch (error) {
      toast.error(t('listing.skuTemplates.generateFailed'), {
        description: translateApiError(error),
      });
    } finally {
      setGenerating(false);
    }
  };

  const items = current?.items ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-6xl"
      title={template ? t('listing.skuTemplates.edit') : t('listing.skuTemplates.create')}
      description={t('listing.skuTemplates.dialogHint')}
    >
      <div className="max-h-[74vh] space-y-4 overflow-y-auto pr-1">
        {/* --- Thông tin chung --- */}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label>
              {t('listing.common.name')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.skuTemplates.prefix')}</Label>
            <Input value={skuPrefix} onChange={(event) => setSkuPrefix(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.skuTemplates.suffix')}</Label>
            <Input value={skuSuffix} onChange={(event) => setSkuSuffix(event.target.value)} />
          </div>
        </div>

        {/* --- Trục biến thể --- */}
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('listing.skuTemplates.variants')}</p>
          <SkuAxisEditor axes={axes} onChange={setAxes} />
        </div>

        {/* --- Giá trị mặc định: mọi SKU sinh ra đều nhận --- */}
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t('listing.skuTemplates.defaultsTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('listing.skuTemplates.defaultsHint')}</p>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="space-y-1">
              <Label>{t('listing.common.currency')}</Label>
              <Combobox
                value={defaults.currency}
                onChange={(value) => setDefaults((prev) => ({ ...prev, currency: value }))}
                options={POD_MARKET_CURRENCIES.map((entry) => ({
                  value: entry.currency,
                  label: entry.currency,
                  hint: entry.markets.join('/'),
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.skuTemplates.defaultRetail')}</Label>
              <CurrencyInput
                currency={defaults.currency}
                value={defaults.retail}
                onChange={(event) => setDefaults((prev) => ({ ...prev, retail: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.skuTemplates.defaultSale')}</Label>
              <CurrencyInput
                currency={defaults.currency}
                value={defaults.sale}
                onChange={(event) => setDefaults((prev) => ({ ...prev, sale: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.skuTemplates.defaultQuantity')}</Label>
              <QuantityInput
                value={defaults.quantity}
                onChange={(event) =>
                  setDefaults((prev) => ({ ...prev, quantity: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.pricing.discount')}</Label>
              <PercentInput
                value={defaults.discount}
                onChange={(event) =>
                  setDefaults((prev) => ({ ...prev, discount: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t('listing.common.displayOrder')}</Label>
              <QuantityInput
                value={displayOrder}
                onChange={(event) => setDisplayOrder(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(event) => setIsDefault(event.target.checked)}
              />
              {t('listing.common.setDefault')}
            </label>
            {templateId && (
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

        {/* --- Tạo SKU: nút + thống kê + cảnh báo --- */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <Button
            onClick={() => void handleGenerate()}
            disabled={Boolean(blocker) || save.isPending || generating}
          >
            {save.isPending || generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            {t('listing.skuTemplates.generate')}
          </Button>

          <div className="text-sm">
            {preview.total > 0 ? (
              <>
                <span className="text-muted-foreground">{preview.formula} = </span>
                <span className="font-semibold">
                  {t('listing.skuTemplates.skuCount', { count: preview.total })}
                </span>
                {items.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t('listing.skuTemplates.currentCount', { count: items.length })}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{t('listing.skuTemplates.noPreview')}</span>
            )}
          </div>

          {blocker && <Badge variant="destructive">{blocker}</Badge>}
        </div>

        {needsRegenerate && items.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <span>{t('listing.skuTemplates.staleWarning')}</span>
          </div>
        )}

        {/* --- Bảng SKU --- */}
        {current && items.length > 0 ? (
          <SkuGrid template={current} />
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('listing.skuTemplates.emptyGrid')}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.close')}
          </Button>
          <Button variant="outline" onClick={() => void handleSave()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
