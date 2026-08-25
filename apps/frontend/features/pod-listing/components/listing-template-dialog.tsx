'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PlayCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  usePodTemplates,
  useSavePodTemplate,
  useScopedProductCount,
  useSyncedBrands,
  useSyncedCategories,
  useTemplateDryRun,
  useWarehouses,
} from '../hooks/use-pod-listing';
import {
  POD_LISTING_MARKETS,
  POD_LISTING_SCOPE_MATCHES,
  type PodCategoryTemplate,
  type PodDescriptionTemplate,
  type PodDryRunResult,
  type PodImageTemplate,
  type PodListingMarket,
  type PodListingScopeMatch,
  type PodListingTemplate,
  type PodListingTemplateScope,
  type PodPricingStrategy,
  type PodSkuTemplate,
} from '../types';

interface ListingTemplateDialogProps {
  open: boolean;
  template: PodListingTemplate | null;
  onClose: () => void;
}

/**
 * Form Listing Template — ghép các mảnh lại.
 *
 * ```
 *  MEN TSHIRT → US → Category(US Men T-shirt) → Brand → Warehouse
 *             → Description → SKU → Images → Pricing → Save
 * ```
 *
 * Danh sách Category Template được **lọc theo thị trường đang chọn**: backend từ chối
 * ghép danh mục khác thị trường, nên đừng để người dùng chọn rồi mới báo lỗi.
 */
export function ListingTemplateDialog({ open, template, onClose }: ListingTemplateDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate('listings');

  const [form, setForm] = useState({
    name: '',
    market: 'US' as PodListingMarket,
    categoryTemplateId: '',
    skuTemplateId: '',
    descriptionTemplateId: '',
    imageTemplateId: '',
    pricingStrategyId: '',
    warehouseId: '',
    tiktokBrandId: '',
    brandName: '',
    shippingTemplateId: '',
    handlingDays: '',
    packageWeight: '',
    weightUnit: 'KILOGRAM',
    packageLength: '',
    packageWidth: '',
    packageHeight: '',
    dimensionUnit: 'CENTIMETER',
    displayOrder: '0',
    isDefault: false,
    isActive: true,
    note: '',
  });
  const [scopes, setScopes] = useState<PodListingTemplateScope[]>([]);

  const categoryTemplates = usePodTemplates<PodCategoryTemplate>('categories', {
    activeOnly: true,
    limit: 100,
    market: form.market,
  });
  const skuTemplates = usePodTemplates<PodSkuTemplate>('skus', { activeOnly: true, limit: 100 });
  const descriptionTemplates = usePodTemplates<PodDescriptionTemplate>('descriptions', {
    activeOnly: true,
    limit: 100,
  });
  const imageTemplates = usePodTemplates<PodImageTemplate>('images', {
    activeOnly: true,
    limit: 100,
  });
  const pricingStrategies = usePodTemplates<PodPricingStrategy>('pricing', {
    activeOnly: true,
    limit: 100,
  });
  const warehousesQuery = useWarehouses();
  // 🔴 Brand tìm Ở SERVER (hàng chục nghìn dòng); "No brand" luôn được xếp đầu.
  const [brandSearch, setBrandSearch] = useState('');
  const debouncedBrandSearch = useDebouncedValue(brandSearch, 300);
  const brandsQuery = useSyncedBrands({
    keyword: debouncedBrandSearch || undefined,
    pageSize: 50,
  });

  const brandOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [];
    // Brand đang chọn luôn có mặt dù kết quả tìm hiện tại không chứa nó.
    if (form.tiktokBrandId) {
      seen.add(form.tiktokBrandId);
      options.push({ value: form.tiktokBrandId, label: form.brandName || form.tiktokBrandId });
    }
    for (const item of brandsQuery.data?.items ?? []) {
      if (seen.has(item.tiktokBrandId)) continue;
      seen.add(item.tiktokBrandId);
      options.push({ value: item.tiktokBrandId, label: item.name ?? item.tiktokBrandId });
    }
    return options;
  }, [brandsQuery.data, form.tiktokBrandId, form.brandName]);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: template?.name ?? '',
      market: template?.market ?? 'US',
      categoryTemplateId: template?.categoryTemplateId ?? '',
      skuTemplateId: template?.skuTemplateId ?? '',
      descriptionTemplateId: template?.descriptionTemplateId ?? '',
      imageTemplateId: template?.imageTemplateId ?? '',
      pricingStrategyId: template?.pricingStrategyId ?? '',
      warehouseId: template?.warehouseId ?? '',
      tiktokBrandId: template?.tiktokBrandId ?? '',
      brandName: template?.brandName ?? '',
      shippingTemplateId: template?.shippingTemplateId ?? '',
      handlingDays: template?.handlingDays != null ? String(template.handlingDays) : '',
      packageWeight: template?.packageWeight ?? '',
      weightUnit: template?.weightUnit ?? 'KILOGRAM',
      packageLength: template?.packageLength ?? '',
      packageWidth: template?.packageWidth ?? '',
      packageHeight: template?.packageHeight ?? '',
      dimensionUnit: template?.dimensionUnit ?? 'CENTIMETER',
      displayOrder: String(template?.displayOrder ?? 0),
      isDefault: template?.isDefault ?? false,
      isActive: template?.isActive ?? true,
      note: template?.note ?? '',
    });
    setScopes(template?.scopes ?? []);
  }, [open, template]);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('listing.listingTemplates.missingRequired'));
      return;
    }

    try {
      await save.mutateAsync({
        id: template?.id,
        payload: {
          name: form.name.trim(),
          market: form.market,
          categoryTemplateId: form.categoryTemplateId || undefined,
          skuTemplateId: form.skuTemplateId || undefined,
          descriptionTemplateId: form.descriptionTemplateId || undefined,
          imageTemplateId: form.imageTemplateId || undefined,
          pricingStrategyId: form.pricingStrategyId || undefined,
          warehouseId: form.warehouseId || undefined,
          tiktokBrandId: form.tiktokBrandId || undefined,
          // 🔴 "No brand" là brand THẬT của TikTok: gửi đúng id + tên, không bỏ field.
          brandName: form.brandName || undefined,
          shippingTemplateId: form.shippingTemplateId || undefined,
          handlingDays: form.handlingDays ? Number(form.handlingDays) : undefined,
          packageWeight: form.packageWeight || undefined,
          weightUnit: form.packageWeight ? form.weightUnit : undefined,
          packageLength: form.packageLength || undefined,
          packageWidth: form.packageWidth || undefined,
          packageHeight: form.packageHeight || undefined,
          dimensionUnit: form.packageLength ? form.dimensionUnit : undefined,
          displayOrder: Number(form.displayOrder || 0),
          isDefault: form.isDefault,
          ...(template ? { isActive: form.isActive } : {}),
          note: form.note || undefined,
          // Bỏ dòng thiếu giá trị — trừ ALL vốn không cần giá trị.
          scopes: scopes
            .filter((scope) => scope.matchType === 'ALL' || Boolean(scope.value?.trim()))
            .map((scope) => ({
              matchType: scope.matchType,
              value: scope.value?.trim() || undefined,
              valueLabel: scope.valueLabel || undefined,
              isExclude: scope.isExclude,
            })),
        },
      });
      toast.success(t('listing.common.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-3xl"
      title={template ? t('listing.listingTemplates.edit') : t('listing.listingTemplates.create')}
      description={t('listing.listingTemplates.dialogHint')}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>
              {t('listing.common.name')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              value={form.name}
              placeholder="MEN TSHIRT — US"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.common.market')}</Label>
            <Combobox
              value={form.market}
              onChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  market: value as PodListingMarket,
                  // Đổi thị trường ⇒ bỏ chọn danh mục cũ (danh mục gắn với thị trường).
                  categoryTemplateId: '',
                }))
              }
              options={POD_LISTING_MARKETS.map((market) => ({ value: market, label: market }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.common.displayOrder')}</Label>
            <Input
              type="number"
              min="0"
              value={form.displayOrder}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, displayOrder: event.target.value }))
              }
            />
          </div>
        </div>

        <SelectField
          label={t('listing.listingTemplates.categoryTemplate')}
          value={form.categoryTemplateId}
          onChange={(value) => setForm((prev) => ({ ...prev, categoryTemplateId: value }))}
          options={(categoryTemplates.data?.items ?? []).map((item) => ({
            value: item.id,
            label: `${item.name}${item.categoryName ? ` · ${item.categoryName}` : ''}`,
          }))}
          placeholder={t('listing.listingTemplates.selectCategoryTemplate')}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('listing.listingTemplates.skuTemplate')}
            value={form.skuTemplateId}
            onChange={(value) => setForm((prev) => ({ ...prev, skuTemplateId: value }))}
            options={(skuTemplates.data?.items ?? []).map((item) => ({
              value: item.id,
              label: `${item.name} (${item._count?.items ?? 0})`,
            }))}
          />
          <SelectField
            label={t('listing.listingTemplates.descriptionTemplate')}
            value={form.descriptionTemplateId}
            onChange={(value) => setForm((prev) => ({ ...prev, descriptionTemplateId: value }))}
            options={(descriptionTemplates.data?.items ?? []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <SelectField
            label={t('listing.listingTemplates.imageTemplate')}
            value={form.imageTemplateId}
            onChange={(value) => setForm((prev) => ({ ...prev, imageTemplateId: value }))}
            options={(imageTemplates.data?.items ?? []).map((item) => ({
              value: item.id,
              label: `${item.name} (${item.items?.length ?? 0} ${t('listing.imageTemplates.imageUnit')})`,
            }))}
          />
          <SelectField
            label={t('listing.listingTemplates.pricingStrategy')}
            value={form.pricingStrategyId}
            onChange={(value) => setForm((prev) => ({ ...prev, pricingStrategyId: value }))}
            options={(pricingStrategies.data?.items ?? []).map((item) => ({
              value: item.id,
              label: `${item.name} (${item.currency})`,
            }))}
          />
          <SelectField
            label={t('listing.categoryTemplates.brand')}
            value={form.tiktokBrandId}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                tiktokBrandId: value,
                brandName: brandOptions.find((option) => option.value === value)?.label ?? '',
              }))
            }
            options={brandOptions}
            onSearchChange={setBrandSearch}
            loading={brandsQuery.isFetching}
          />
          <SelectField
            label={t('listing.listingTemplates.warehouse')}
            value={form.warehouseId}
            onChange={(value) => setForm((prev) => ({ ...prev, warehouseId: value }))}
            options={(warehousesQuery.data ?? []).map((item) => ({
              value: item.id,
              label: `${item.name ?? item.tiktokWarehouseId}${item.shop ? ` · ${item.shop.name}` : ''}`,
            }))}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{t('listing.listingTemplates.shippingTemplateId')}</Label>
            <Input
              value={form.shippingTemplateId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, shippingTemplateId: event.target.value }))
              }
              placeholder={t('listing.listingTemplates.shippingHint')}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('listing.listingTemplates.handlingDays')}</Label>
            <Input
              type="number"
              min="0"
              value={form.handlingDays}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, handlingDays: event.target.value }))
              }
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>{t('listing.listingTemplates.package')}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-[110px]"
              value={form.packageWeight}
              placeholder={t('listing.categoryTemplates.weight')}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, packageWeight: event.target.value }))
              }
            />
            <Combobox
              className="w-[150px]"
              value={form.weightUnit}
              onChange={(value) => setForm((prev) => ({ ...prev, weightUnit: value }))}
              options={WEIGHT_UNITS}
            />
            {(['packageLength', 'packageWidth', 'packageHeight'] as const).map((key) => (
              <Input
                key={key}
                className="w-[90px]"
                value={form[key]}
                placeholder={t(`listing.categoryTemplates.${key.replace('package', '').toLowerCase()}`)}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            ))}
            <Combobox
              className="w-[150px]"
              value={form.dimensionUnit}
              onChange={(value) => setForm((prev) => ({ ...prev, dimensionUnit: value }))}
              options={DIMENSION_UNITS}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('listing.listingTemplates.packageHint')}
          </p>
        </div>

        {/* --- Phạm vi áp dụng: Template → nhiều Product --- */}
        <ScopeEditor scopes={scopes} onChange={setScopes} templateId={template?.id} />

        <div className="space-y-1">
          <Label>{t('listing.common.note')}</Label>
          <Input
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => setForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
            />
            {t('listing.common.setDefault')}
          </label>
          {template && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                }
              />
              {t('listing.common.active')}
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Trình dựng **phạm vi áp dụng** — trái tim của Bulk Listing.
 *
 * Người dùng mô tả "template này áp cho những sản phẩm nào" bằng vài dòng quy tắc, thay vì
 * gán template vào từng sản phẩm. Panel bên dưới hiện **số sản phẩm đang khớp** và cho
 * **chạy thử** trên vài sản phẩm thật — nhìn thấy ngay template có dùng được cho cả tập hay
 * không, trước khi sinh listing hàng loạt.
 *
 * Số khớp và chạy thử chỉ có khi template ĐÃ LƯU: chúng đọc quy tắc từ database, nên phải
 * lưu rồi mới phản ánh đúng.
 */
function ScopeEditor({
  scopes,
  onChange,
  templateId,
}: {
  scopes: PodListingTemplateScope[];
  onChange: (scopes: PodListingTemplateScope[]) => void;
  templateId?: string;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const count = useScopedProductCount(templateId);
  const dryRun = useTemplateDryRun();
  const [result, setResult] = useState<PodDryRunResult | null>(null);

  // Cả hai danh sách đều tìm Ở SERVER: cây danh mục hàng chục nghìn nút, brand còn nhiều hơn.
  const [categorySearch, setCategorySearch] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const categories = useSyncedCategories({
    leafOnly: true,
    search: useDebouncedValue(categorySearch, 300) || undefined,
  });
  const brands = useSyncedBrands({
    keyword: useDebouncedValue(brandSearch, 300) || undefined,
    pageSize: 50,
  });

  const patch = (index: number, next: Partial<PodListingTemplateScope>) =>
    onChange(scopes.map((scope, i) => (i === index ? { ...scope, ...next } : scope)));

  /** Gợi ý giá trị theo loại quy tắc — đỡ phải đi tra id danh mục/brand bằng tay. */
  const optionsFor = (matchType: PodListingScopeMatch): Array<{ value: string; label: string }> => {
    if (matchType === 'CATEGORY') {
      return (categories.data ?? []).map((category) => ({
        value: category.tiktokCategoryId,
        label: category.path ?? category.localName ?? category.tiktokCategoryId,
      }));
    }
    if (matchType === 'BRAND') {
      return (brands.data?.items ?? []).map((brand) => ({
        value: brand.tiktokBrandId,
        label: brand.name ?? brand.tiktokBrandId,
      }));
    }
    return [];
  };

  const handleDryRun = async () => {
    if (!templateId) return;
    try {
      setResult(await dryRun.mutateAsync({ templateId, limit: 5 }));
    } catch (error) {
      toast.error(t('listing.scope.dryRunFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t('listing.scope.title')}</p>
          <p className="text-xs text-muted-foreground">{t('listing.scope.hint')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...scopes, { matchType: 'CATEGORY', value: '', isExclude: false }])
          }
        >
          <Plus className="size-4" />
          {t('listing.scope.addRule')}
        </Button>
      </div>

      {scopes.map((scope, index) => {
        const options = optionsFor(scope.matchType);
        return (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <div className="w-[190px] space-y-1">
              <Label>{t('listing.scope.matchType')}</Label>
              <Combobox
                value={scope.matchType}
                onChange={(value) =>
                  patch(index, {
                    matchType: value as PodListingScopeMatch,
                    value: '',
                    valueLabel: null,
                  })
                }
                options={POD_LISTING_SCOPE_MATCHES.map((match) => ({
                  value: match,
                  label: t(`listing.scope.match.${match}`),
                }))}
              />
            </div>

            {scope.matchType !== 'ALL' && (
              <div className="min-w-[240px] flex-1 space-y-1">
                <Label>{t('listing.scope.value')}</Label>
                {scope.matchType === 'CATEGORY' || scope.matchType === 'BRAND' ? (
                  <Combobox
                    value={scope.value ?? ''}
                    onChange={(value) =>
                      patch(index, {
                        value,
                        valueLabel: options.find((option) => option.value === value)?.label ?? null,
                      })
                    }
                    options={options}
                    onSearchChange={
                      scope.matchType === 'CATEGORY' ? setCategorySearch : setBrandSearch
                    }
                    loading={scope.matchType === 'CATEGORY' ? categories.isFetching : brands.isFetching}
                    clearable
                    placeholder={t('listing.common.notSelected')}
                  />
                ) : (
                  <Input
                    value={scope.value ?? ''}
                    placeholder={t('listing.scope.valuePlaceholder')}
                    onChange={(event) => patch(index, { value: event.target.value })}
                  />
                )}
              </div>
            )}

            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={scope.isExclude}
                onChange={(event) => patch(index, { isExclude: event.target.checked })}
              />
              {t('listing.scope.exclude')}
            </label>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange(scopes.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}

      {scopes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('listing.scope.empty')}</p>
      )}

      {templateId && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {count.isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trans2 count={count.data ?? 0} />
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDryRun()}
              disabled={dryRun.isPending}
            >
              {dryRun.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlayCircle className="size-4" />
              )}
              {t('listing.scope.dryRun')}
            </Button>
          </div>

          {result && (
            <div className="space-y-1 text-xs">
              <p className="font-medium">
                {t('listing.scope.dryRunSummary', {
                  tested: result.testedProducts,
                  ready: result.readyProducts,
                  matched: result.matchedProducts,
                })}
              </p>
              <ul className="space-y-1">
                {result.products.map((product) => (
                  <li key={product.productId} className="flex flex-wrap items-center gap-2">
                    <Badge variant={product.ready ? 'success' : 'warning'}>
                      {product.ready ? t('listing.scope.ready') : `${product.errorCount} ✕`}
                    </Badge>
                    <span className="max-w-[280px] truncate">{product.resolvedTitle}</span>
                    <span className="text-muted-foreground">
                      {t('listing.scope.productSummary', {
                        variants: product.variantCount,
                        images: product.imageCount,
                        price: product.salePrice ?? '—',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Dòng "áp dụng cho N sản phẩm" — tách ra cho gọn phần JSX ở trên. */
function Trans2({ count }: { count: number }) {
  const { t } = useTranslation('pod');
  return (
    <span className={count === 0 ? 'text-muted-foreground' : 'font-medium'}>
      {t('listing.scope.matchedCount', { count })}
    </span>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  onSearchChange,
  loading,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Có mặt ⇒ danh sách tìm phía server (brand, danh mục). */
  onSearchChange?: (keyword: string) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation('pod');
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        onSearchChange={onSearchChange}
        loading={loading}
        clearable
        placeholder={placeholder ?? t('listing.common.notSelected')}
      />
    </div>
  );
}

/** Đơn vị TikTok chấp nhận cho kiện hàng — gửi nguyên mã, không dịch. */
const WEIGHT_UNITS: ComboboxOption[] = [
  { value: 'KILOGRAM', label: 'KILOGRAM' },
  { value: 'POUND', label: 'POUND' },
];
const DIMENSION_UNITS: ComboboxOption[] = [
  { value: 'CENTIMETER', label: 'CENTIMETER' },
  { value: 'INCH', label: 'INCH' },
];
