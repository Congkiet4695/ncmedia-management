'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { useFlashSaleTemplates } from '../hooks';
import { listTimeZones } from '../timezone';
import { FLASH_SALE_MAX_NAME_LENGTH, type PodFlashSaleProductLevel } from '../types';

/** Giá trị của form — giờ ở dạng `datetime-local` (giờ treo tường của `timezone`). */
export interface FlashSaleFormValue {
  shopId: string;
  name: string;
  description: string;
  startLocal: string;
  endLocal: string;
  timezone: string;
  productLevel: PodFlashSaleProductLevel;
  templateId: string;
}

interface FlashSaleFormProps {
  value: FlashSaleFormValue;
  onChange: (patch: Partial<FlashSaleFormValue>) => void;
  /** Chế độ sửa: shop, mức áp dụng và template đã cố định theo dữ liệu đã có. */
  mode: 'create' | 'edit';
  disabled?: boolean;
}

/**
 * Phần **Thông tin** của một đợt Flash Sale: Shop · Tên · Bắt đầu · Kết thúc · Múi giờ ·
 * Product Type. Dùng chung cho màn hình tạo mới và màn hình sửa.
 *
 * 🔴 Đổi **Shop** chỉ cho phép ở bước TẠO. Sản phẩm đã thêm thuộc về shop cũ; đổi shop giữa
 * chừng sẽ để lại một danh sách trỏ sang shop khác — backend từ chối, nhưng chặn ngay ở giao
 * diện thì người dùng không phải đi tới chỗ bị từ chối mới biết.
 *
 * 🔴 Đổi **Product Type** sang PRODUCT sẽ gộp các dòng SKU — cảnh báo hiện ngay dưới ô chọn
 * chứ không đợi tới lúc bấm Lưu.
 */
export function FlashSaleForm({ value, onChange, mode, disabled }: FlashSaleFormProps) {
  const { t } = useTranslation(['pod', 'common']);

  const shops = usePodProductFilters().data?.shops ?? [];
  // Danh sách template chỉ cần ở bước tạo — bước sửa không có ô này nên không tải.
  const templates = useFlashSaleTemplates(
    { limit: 100, shopId: value.shopId || undefined },
    mode === 'create' && Boolean(value.shopId),
  );

  const timeZoneOptions = useMemo(
    () => listTimeZones().map((zone) => ({ value: zone, label: zone })),
    [],
  );

  const isEdit = mode === 'edit';

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-shop">{t('flashSale.form.shop')}</Label>
        <Combobox
          id="flash-sale-shop"
          value={value.shopId}
          onChange={(shopId) => onChange({ shopId, templateId: '' })}
          options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
          placeholder={
            shops.length === 0 ? t('flashSale.form.noShop') : t('flashSale.form.pickShop')
          }
          disabled={disabled || isEdit}
        />
        {isEdit && (
          <p className="text-xs text-muted-foreground">{t('flashSale.form.shopLocked')}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-name">{t('flashSale.form.name')}</Label>
        <Input
          id="flash-sale-name"
          value={value.name}
          maxLength={FLASH_SALE_MAX_NAME_LENGTH}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t('flashSale.form.namePlaceholder')}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {t('flashSale.form.nameHint', {
            used: value.name.length,
            max: FLASH_SALE_MAX_NAME_LENGTH,
          })}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-start">{t('flashSale.form.startAt')}</Label>
        <Input
          id="flash-sale-start"
          type="datetime-local"
          value={value.startLocal}
          onChange={(event) => onChange({ startLocal: event.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-end">{t('flashSale.form.endAt')}</Label>
        <Input
          id="flash-sale-end"
          type="datetime-local"
          value={value.endLocal}
          onChange={(event) => onChange({ endLocal: event.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-timezone">{t('flashSale.form.timezone')}</Label>
        <Combobox
          id="flash-sale-timezone"
          value={value.timezone}
          onChange={(timezone) => onChange({ timezone })}
          options={timeZoneOptions}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">{t('flashSale.form.timezoneHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flash-sale-level">{t('flashSale.form.productLevel')}</Label>
        <Combobox
          id="flash-sale-level"
          value={value.productLevel}
          onChange={(productLevel) =>
            onChange({ productLevel: productLevel as PodFlashSaleProductLevel })
          }
          options={[
            { value: 'VARIATION', label: t('flashSale.productLevel.VARIATION') },
            { value: 'PRODUCT', label: t('flashSale.productLevel.PRODUCT') },
          ]}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {t(`flashSale.form.productLevelHint.${value.productLevel}`)}
        </p>
      </div>

      {mode === 'create' && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="flash-sale-template">{t('flashSale.form.template')}</Label>
          <Combobox
            id="flash-sale-template"
            value={value.templateId}
            onChange={(templateId) => onChange({ templateId })}
            options={(templates.data?.items ?? []).map((template) => ({
              value: template.id,
              label: `${template.name} · ${t('flashSale.form.templateItems', { count: template.itemCount })}`,
            }))}
            placeholder={t('flashSale.form.templateNone')}
            emptyMessage={t('flashSale.form.templateEmpty')}
            loading={templates.isLoading}
            clearable
            disabled={disabled || !value.shopId}
          />
          <p className="text-xs text-muted-foreground">{t('flashSale.form.templateHint')}</p>
        </div>
      )}

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="flash-sale-description">{t('flashSale.form.description')}</Label>
        <Input
          id="flash-sale-description"
          value={value.description}
          maxLength={2000}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder={t('flashSale.form.descriptionPlaceholder')}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
