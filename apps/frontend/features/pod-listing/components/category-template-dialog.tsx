'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ResourceSyncButton } from '@/features/pod-resource/components/resource-sync-button';
import { AttributeValuePicker, type AttributeSelection } from './attribute-value-picker';
import {
  useCategoryAttributes,
  usePodAsset,
  useSavePodTemplate,
  useSyncedBrands,
  useSyncedCategories,
  useWarehouses,
} from '../hooks/use-pod-listing';
import { podListingService } from '../services/pod-listing.service';
import {
  POD_LISTING_MARKETS,
  type PodCategoryAttributeDef,
  type PodCategoryTemplate,
  type PodListingMarket,
} from '../types';

interface CategoryTemplateDialogProps {
  open: boolean;
  template: PodCategoryTemplate | null;
  onClose: () => void;
}

/** Giá trị người dùng nhập, khoá theo `tiktokAttributeId`. */
type AttributeValues = Record<string, AttributeSelection>;

/** Thuộc tính bán hàng (Color/Size) — TikTok đánh dấu bằng `type = SALES_PROPERTY`. */
const SALES_PROPERTY = 'SALES_PROPERTY';

/** Đơn vị TikTok chấp nhận cho kiện hàng — gửi nguyên mã, không dịch. */
const WEIGHT_UNITS: ComboboxOption[] = [
  { value: 'KILOGRAM', label: 'KILOGRAM' },
  { value: 'POUND', label: 'POUND' },
];
const DIMENSION_UNITS: ComboboxOption[] = [
  { value: 'CENTIMETER', label: 'CENTIMETER' },
  { value: 'INCH', label: 'INCH' },
];

/**
 * Form Category Template.
 *
 * 🔴 Điểm cốt lõi: **thuộc tính được render ĐỘNG**. Chọn danh mục ⇒ gọi API lấy thuộc
 * tính của danh mục đó (dữ liệu đã đồng bộ từ TikTok) ⇒ dựng form. Không có bất kỳ
 * thuộc tính, brand, kho hay danh mục nào viết cứng trong mã; đổi danh mục là form đổi theo.
 *
 * Thuộc tính được tách thành **Sale Attributes** và **Product Attributes** đúng theo cờ
 * `type` mà TikTok trả về, trong mỗi nhóm thì bắt buộc lên trước — người nhập biết ngay
 * còn thiếu gì.
 */
export function CategoryTemplateDialog({ open, template, onClose }: CategoryTemplateDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.product.sync');
  const save = useSavePodTemplate('categories');
  const sizeChartInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [market, setMarket] = useState<PodListingMarket>('US');
  // 🔴 Khoá theo `tiktokCategoryId` — ĐÚNG thứ database lưu.
  //
  // Trước đây ô này khoá theo UUID nội bộ của `pod_product_categories` rồi tra ngược từ
  // danh sách đang tải. Cây danh mục có ~10.000 nút lá mà API trả tối đa 500, nên danh mục
  // đã lưu gần như không bao giờ nằm trong danh sách đó ⇒ mở ra sửa là MẤT danh mục.
  // Giữ luôn nhãn để hiển thị được mà không phải tìm lại.
  const [category, setCategory] = useState<{ id: string; name: string; path: string }>({
    id: '',
    name: '',
    path: '',
  });
  // Giữ cả TÊN brand: danh sách brand tải theo trang, brand đang chọn có thể không nằm
  // trong trang hiện tại — bám vào danh sách để tra tên là mất tên ngay khi người dùng gõ tìm.
  const [brand, setBrand] = useState<{ id: string; name: string }>({ id: '', name: '' });
  const [warehouseId, setWarehouseId] = useState('');
  const [packageWeight, setPackageWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState('KILOGRAM');
  const [dimensions, setDimensions] = useState({
    length: '',
    width: '',
    height: '',
    unit: 'CENTIMETER',
  });
  const [sizeChart, setSizeChart] = useState<{ fileId: string; name: string } | null>(null);
  const [video, setVideo] = useState<{ fileId: string; name: string } | null>(null);
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [attributeValues, setAttributeValues] = useState<AttributeValues>({});
  const [uploading, setUploading] = useState<'sizeChart' | 'video' | null>(null);

  // Chỉ lấy danh mục LÁ: TikTok chỉ cho đăng bán ở danh mục lá.
  //
  // 🔴 Tìm kiếm chạy Ở SERVER: cây danh mục TikTok có hàng chục nghìn nút, API trả tối đa
  // 500 mỗi lần. Lọc phía client trên 500 dòng đầu bảng chữ cái nghĩa là phần lớn danh mục
  // KHÔNG BAO GIỜ chọn được — gõ từ khoá rồi hỏi lại server mới ra đúng cái cần.
  const [categorySearch, setCategorySearch] = useState('');
  const debouncedCategorySearch = useDebouncedValue(categorySearch, 300);
  const categoriesQuery = useSyncedCategories({
    leafOnly: true,
    search: debouncedCategorySearch || undefined,
  });
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  // 🔴 Brand tìm Ở SERVER: một shop có thể có hàng chục nghìn thương hiệu. "No brand" luôn
  // được server xếp đầu danh sách nên nó nằm ngay trên cùng khi vừa mở.
  const [brandSearch, setBrandSearch] = useState('');
  const debouncedBrandSearch = useDebouncedValue(brandSearch, 300);
  const brandsQuery = useSyncedBrands({
    keyword: debouncedBrandSearch || undefined,
    pageSize: 50,
  });
  const warehousesQuery = useWarehouses();

  const categoryOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [];
    // Danh mục ĐANG CHỌN luôn đứng trong danh sách, kể cả khi kết quả tìm hiện tại không
    // chứa nó — nếu không, mở form ra là ô danh mục trống trơn.
    if (category.id) {
      seen.add(category.id);
      options.push({
        value: category.id,
        label: category.path || category.name || category.id,
        hint: category.id,
      });
    }
    for (const item of categories) {
      if (seen.has(item.tiktokCategoryId)) continue;
      seen.add(item.tiktokCategoryId);
      options.push({
        value: item.tiktokCategoryId,
        label: item.path ?? item.localName ?? item.tiktokCategoryId,
        hint: item.tiktokCategoryId,
      });
    }
    return options;
  }, [categories, category]);

  // Nhiều shop cùng một thương hiệu ⇒ trùng `tiktok_brand_id`. Gộp lại để danh sách không
  // hiện ba dòng "No brand" giống hệt nhau.
  const brandOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [];
    // Brand đang chọn luôn có mặt, kể cả khi nó không nằm trong kết quả tìm hiện tại.
    if (brand.id) {
      seen.add(brand.id);
      options.push({ value: brand.id, label: brand.name || brand.id });
    }
    for (const item of brandsQuery.data?.items ?? []) {
      if (seen.has(item.tiktokBrandId)) continue;
      seen.add(item.tiktokBrandId);
      options.push({
        value: item.tiktokBrandId,
        label: item.name ?? item.tiktokBrandId,
        hint: item.isNoBrand ? t('listing.categoryTemplates.noBrandHint') : undefined,
      });
    }
    return options;
  }, [brand, brandsQuery.data, t]);

  const warehouseOptions = useMemo<ComboboxOption[]>(() => {
    const options = (warehousesQuery.data ?? []).map((warehouse) => ({
      value: warehouse.id,
      label: warehouse.name ?? warehouse.tiktokWarehouseId,
      hint: warehouse.shop?.name,
    }));
    // Kho đã lưu có thể không còn trong cache (chưa đồng bộ lại, hoặc shop bị gỡ) — vẫn phải
    // hiện ra, nếu không người dùng tưởng template chưa chọn kho và lưu đè mất.
    if (template?.warehouseId && !options.some((option) => option.value === template.warehouseId)) {
      options.unshift({
        value: template.warehouseId,
        label: template.warehouse?.name ?? template.warehouseId,
        hint: undefined,
      });
    }
    return options;
  }, [warehousesQuery.data, template]);

  const attributesQuery = useCategoryAttributes(category.id || undefined);
  // Nút "đồng bộ thuộc tính" cần UUID nội bộ của danh mục ⇒ tra đúng một dòng, không tải cả
  // cây. Chỉ chạy khi đã chọn danh mục.
  const selectedCategoryRows = useSyncedCategories({
    tiktokCategoryId: category.id || undefined,
  });
  const attributes = useMemo(() => attributesQuery.data ?? [], [attributesQuery.data]);

  // Đã nạp xong danh sách định nghĩa thuộc tính của danh mục đang chọn hay chưa.
  const attributesLoaded = Boolean(category.id) && attributesQuery.isSuccess;

  const saleAttributes = attributes.filter((attribute) => attribute.type === SALES_PROPERTY);
  const productAttributes = attributes.filter((attribute) => attribute.type !== SALES_PROPERTY);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setMarket(template?.market ?? 'US');
    setBrand({ id: template?.tiktokBrandId ?? '', name: template?.brandName ?? '' });
    setWarehouseId(template?.warehouseId ?? '');
    setPackageWeight(template?.packageWeight ?? '');
    setWeightUnit(template?.weightUnit ?? 'KILOGRAM');
    setDimensions({
      length: template?.packageLength ?? '',
      width: template?.packageWidth ?? '',
      height: template?.packageHeight ?? '',
      unit: template?.dimensionUnit ?? 'CENTIMETER',
    });
    // Database chỉ lưu `fileId`; tên và ảnh xem trước do `FileField` hỏi Storage Module.
    setSizeChart(template?.sizeChartFileId ? { fileId: template.sizeChartFileId, name: '' } : null);
    setVideo(template?.videoFileId ? { fileId: template.videoFileId, name: '' } : null);
    setDisplayOrder(String(template?.displayOrder ?? 0));
    setIsDefault(template?.isDefault ?? false);
    setIsActive(template?.isActive ?? true);

    // Danh mục khôi phục từ CHÍNH template (id + tên + đường dẫn đã lưu kèm), không tra
    // ngược danh sách nào cả — nên không phụ thuộc việc danh mục đó có nằm trong trang dữ
    // liệu đang tải hay không.
    setCategory({
      id: template?.tiktokCategoryId ?? '',
      name: template?.categoryName ?? '',
      path: template?.categoryPath ?? '',
    });
    setCategorySearch('');

    setAttributeValues(
      Object.fromEntries(
        (template?.attributes ?? []).map((attribute) => [
          attribute.tiktokAttributeId,
          {
            valueIds: (attribute.values ?? []).map((value) => value.tiktokValueId),
            customValues: (attribute.customValues ?? []).map((custom) => custom.value),
          },
        ]),
      ),
    );
    // 🔴 Danh sách phụ thuộc (`categories`) KHÔNG được nằm trong deps: nó đổi mỗi lần
    // người dùng gõ vào ô tìm danh mục, và effect này sẽ nạp lại toàn bộ form — xoá sạch
    // những gì họ vừa nhập.
  }, [open, template]);

  const entryOf = (attribute: PodCategoryAttributeDef): AttributeSelection =>
    attributeValues[attribute.tiktokAttributeId] ?? { valueIds: [], customValues: [] };

  const setEntry = (attribute: PodCategoryAttributeDef, next: AttributeSelection) =>
    setAttributeValues((prev) => ({ ...prev, [attribute.tiktokAttributeId]: next }));

  const handleUpload = async (kind: 'sizeChart' | 'video', file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    try {
      const uploaded = await podListingService.uploadAsset(file);
      const value = { fileId: uploaded.id, name: uploaded.originalName };
      if (kind === 'sizeChart') setSizeChart(value);
      else setVideo(value);
    } catch (error) {
      toast.error(t('listing.imageTemplates.uploadFailed'), {
        description: translateApiError(error),
      });
    } finally {
      setUploading(null);
      if (kind === 'sizeChart' && sizeChartInputRef.current) sizeChartInputRef.current.value = '';
      if (kind === 'video' && videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !category.id) {
      toast.error(t('listing.categoryTemplates.missingRequired'));
      return;
    }

    const payload = {
      name: name.trim(),
      market,
      // Lưu đủ mã + ảnh chụp tên/đường dẫn: mở lại là hiển thị được ngay, không phụ thuộc
      // cache danh mục của shop.
      tiktokCategoryId: category.id,
      categoryName: category.name || undefined,
      categoryPath: category.path || undefined,
      // 🔴 "No brand" là một brand THẬT của TikTok: gửi đúng id của nó, không convert
      // thành null và không bỏ field.
      tiktokBrandId: brand.id || undefined,
      brandName: brand.name || undefined,
      warehouseId: warehouseId || undefined,
      packageWeight: packageWeight || undefined,
      weightUnit: packageWeight ? weightUnit : undefined,
      packageLength: dimensions.length || undefined,
      packageWidth: dimensions.width || undefined,
      packageHeight: dimensions.height || undefined,
      dimensionUnit: dimensions.length ? dimensions.unit : undefined,
      sizeChartFileId: sizeChart?.fileId,
      videoFileId: video?.fileId,
      displayOrder: Number(displayOrder || 0),
      isDefault,
      ...(template ? { isActive } : {}),
      // 🔴 Chỉ gửi phần thuộc tính khi ĐÃ NẠP ĐƯỢC định nghĩa của danh mục.
      //
      // Backend coi `attributes` là "ghi đè trọn bộ". Nếu form chưa nạp xong (hoặc danh mục
      // chưa đồng bộ thuộc tính) mà vẫn gửi một mảng rỗng, thì bấm Save = xoá sạch giá trị
      // đã chọn. Không gửi trường này thì backend giữ nguyên phần cũ.
      attributes: !attributesLoaded
        ? undefined
        : attributes
            .map((attribute, index) => {
              const entry = entryOf(attribute);
              if (entry.valueIds.length === 0 && entry.customValues.length === 0) return null;
              return {
                tiktokAttributeId: attribute.tiktokAttributeId,
                attributeName: attribute.name ?? undefined,
                attributeType: attribute.type ?? undefined,
                isRequired: attribute.isRequired,
                isMultipleSelection: attribute.isMultipleSelection,
                isCustomizable: attribute.isCustomizable,
                sortOrder: index,
                values: entry.valueIds.map((id) => ({
                  tiktokValueId: id,
                  valueName: attribute.values?.find((value) => value.id === id)?.name,
                })),
                // Giá trị tự nhập gửi kèm; backend còn đối chiếu lại với metadata TikTok trước
                // khi lưu, nên gửi nhầm cũng không lọt vào database.
                customValues: entry.customValues,
              };
            })
            .filter(Boolean),
    };

    try {
      await save.mutateAsync({ id: template?.id, payload });
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
      className="max-w-4xl"
      title={template ? t('listing.categoryTemplates.edit') : t('listing.categoryTemplates.create')}
      description={t('listing.categoryTemplates.dialogHint')}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('listing.common.name')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('listing.common.market')} required>
            <Combobox
              value={market}
              onChange={(value) => setMarket(value as PodListingMarket)}
              options={POD_LISTING_MARKETS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label={t('listing.common.displayOrder')}>
            <Input
              type="number"
              min="0"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(event.target.value)}
            />
          </Field>
        </div>

        <Field label={t('listing.categoryTemplates.category')} required>
          <div className="space-y-1">
            {/* Gõ tên hoặc mã danh mục — không bắt ai mở cây để tìm. */}
            <Combobox
              value={category.id}
              onChange={(value) => {
                const picked = categories.find((item) => item.tiktokCategoryId === value);
                setCategory({
                  id: value,
                  name: picked?.localName ?? (value === category.id ? category.name : ''),
                  path: picked?.path ?? (value === category.id ? category.path : ''),
                });
              }}
              options={categoryOptions}
              onSearchChange={setCategorySearch}
              loading={categoriesQuery.isFetching}
              placeholder={t('listing.categoryTemplates.selectCategory')}
              searchPlaceholder={t('listing.categoryTemplates.searchCategory')}
            />
            <p className="text-xs text-muted-foreground">
              {categoriesQuery.isFetching
                ? t('listing.common.loading')
                : t('listing.categoryTemplates.categoryCount', { count: categories.length })}
            </p>
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('listing.categoryTemplates.brand')}>
            <Combobox
              value={brand.id}
              onChange={(value) =>
                setBrand({
                  id: value,
                  name: brandOptions.find((option) => option.value === value)?.label ?? '',
                })
              }
              options={brandOptions}
              onSearchChange={setBrandSearch}
              loading={brandsQuery.isFetching}
              clearable
              placeholder={t('listing.common.notSelected')}
              searchPlaceholder={t('listing.categoryTemplates.searchBrand')}
            />
          </Field>
          <Field label={t('listing.categoryTemplates.warehouse')}>
            {/* 🔴 KHÔNG bắt buộc. Kho thuộc về shop; đây chỉ là gợi ý mặc định và chỉ được
                dùng khi kho đó thuộc chính shop đang đăng. */}
            <Combobox
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouseOptions}
              clearable
              placeholder={t('listing.common.notSelected')}
            />
            <p className="text-xs text-muted-foreground">
              {t('listing.categoryTemplates.warehouseHint')}
            </p>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('listing.categoryTemplates.weight')}>
            <div className="flex gap-2">
              <Input
                value={packageWeight}
                onChange={(event) => setPackageWeight(event.target.value)}
                placeholder="0.3"
              />
              <Combobox
                value={weightUnit}
                onChange={setWeightUnit}
                options={WEIGHT_UNITS}
                className="w-[150px]"
              />
            </div>
          </Field>
          <Field label={t('listing.categoryTemplates.dimensions')}>
            <div className="flex gap-2">
              {(['length', 'width', 'height'] as const).map((key) => (
                <Input
                  key={key}
                  value={dimensions[key]}
                  onChange={(event) =>
                    setDimensions((prev) => ({ ...prev, [key]: event.target.value }))
                  }
                  placeholder={t(`listing.categoryTemplates.${key}`)}
                />
              ))}
              <Combobox
                value={dimensions.unit}
                onChange={(value) => setDimensions((prev) => ({ ...prev, unit: value }))}
                options={DIMENSION_UNITS}
                className="w-[140px]"
              />
            </div>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FileField
            label={t('listing.categoryTemplates.sizeChart')}
            value={sizeChart}
            busy={uploading === 'sizeChart'}
            accept="image/*"
            inputRef={sizeChartInputRef}
            onPick={(file) => void handleUpload('sizeChart', file)}
            onClear={() => setSizeChart(null)}
            uploadLabel={t('listing.imageTemplates.upload')}
          />
          <FileField
            label={t('listing.categoryTemplates.productVideo')}
            value={video}
            busy={uploading === 'video'}
            accept="video/*"
            inputRef={videoInputRef}
            onPick={(file) => void handleUpload('video', file)}
            onClear={() => setVideo(null)}
            uploadLabel={t('listing.imageTemplates.upload')}
          />
        </div>

        {/* --- Thuộc tính RENDER ĐỘNG theo danh mục đã chọn --- */}
        <div className="space-y-4 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{t('listing.categoryTemplates.attributes')}</p>
            {attributesQuery.isFetching && <Loader2 className="size-4 animate-spin" />}
          </div>

          {!category.id ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.categoryTemplates.selectCategoryFirst')}
            </p>
          ) : attributes.length === 0 ? (
            // Cache thuộc tính chỉ chứa các danh mục đã được kéo về. Chọn một danh mục
            // chưa có thì đây là chỗ kéo nó — vẫn đi qua Resource Sync (ghi vào DB, có
            // nhật ký), KHÔNG gọi thẳng TikTok từ form.
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t('listing.categoryTemplates.noAttributes')}
              </p>
              {canSync && (
                <ResourceSyncButton
                  resource="CATEGORY_ATTRIBUTE"
                  size="sm"
                  label={t('listing.categoryTemplates.syncAttributes')}
                  categoryIds={(selectedCategoryRows.data ?? []).map((row) => row.id)}
                  onDone={() => void attributesQuery.refetch()}
                />
              )}
            </div>
          ) : (
            <>
              <AttributeGroup
                title={t('listing.categoryTemplates.saleAttributes')}
                attributes={saleAttributes}
                entryOf={entryOf}
                setEntry={setEntry}
              />
              <AttributeGroup
                title={t('listing.categoryTemplates.productAttributes')}
                attributes={productAttributes}
                entryOf={entryOf}
                setEntry={setEntry}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            {t('listing.common.setDefault')}
          </label>
          {template && (
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
 * Một nhóm thuộc tính (Sale hoặc Product).
 *
 * Thuộc tính bắt buộc xếp lên trước. Mỗi thuộc tính dùng chung một bộ chọn duy nhất
 * (`AttributeValuePicker`) — nó tự quyết định checkbox hay radio, có ô tìm kiếm hay không,
 * và có cho nhập giá trị tự do hay không, **hoàn toàn dựa vào metadata TikTok trả về**.
 */
function AttributeGroup({
  title,
  attributes,
  entryOf,
  setEntry,
}: {
  title: string;
  attributes: PodCategoryAttributeDef[];
  entryOf: (attribute: PodCategoryAttributeDef) => AttributeSelection;
  setEntry: (attribute: PodCategoryAttributeDef, next: AttributeSelection) => void;
}) {
  const { t } = useTranslation('pod');
  if (attributes.length === 0) return null;

  const sorted = [...attributes].sort(
    (a, b) =>
      Number(b.isRequired) - Number(a.isRequired) || (a.name ?? '').localeCompare(b.name ?? ''),
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((attribute) => (
          <div key={attribute.id} className="space-y-1">
            <Label className="flex flex-wrap items-center gap-2">
              <span>
                {attribute.name ?? attribute.tiktokAttributeId}
                {attribute.isRequired && <span className="ml-1 text-destructive">*</span>}
              </span>
              {attribute.isMultipleSelection && (
                <Badge variant="muted">{t('listing.categoryTemplates.multiSelect')}</Badge>
              )}
              {attribute.isCustomizable && (
                <Badge variant="muted">{t('listing.categoryTemplates.customAllowed')}</Badge>
              )}
            </Label>

            <AttributeValuePicker
              attribute={attribute}
              selection={entryOf(attribute)}
              onChange={(next) => setEntry(attribute, next)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ô file (size chart / video).
 *
 * 🔴 Mở lại template thì chỉ có `fileId` trong tay — tên file và link xem trước phải hỏi
 * Storage Module. Không hỏi thì ô hiện một cái nhãn chung chung và người dùng không biết
 * mình đã tải lên đúng file nào.
 */
function FileField({
  label,
  value,
  busy,
  accept,
  inputRef,
  onPick,
  onClear,
  uploadLabel,
}: {
  label: string;
  value: { fileId: string; name: string } | null;
  busy: boolean;
  accept: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
  uploadLabel: string;
}) {
  const asset = usePodAsset(value && !value.name ? value.fileId : undefined);
  const fileName = value?.name || asset.data?.originalName || value?.fileId;
  const previewUrl = asset.data?.publicUrl;

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploadLabel}
        </Button>
        {value && (
          <>
            {previewUrl && accept.startsWith('image') && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="size-10 rounded border object-cover" />
            )}
            <span className="max-w-[160px] truncate text-xs text-muted-foreground">
              {asset.isFetching ? '…' : fileName}
            </span>
            <Button variant="outline" size="sm" onClick={onClear}>
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onPick(event.target.files?.[0])}
      />
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
