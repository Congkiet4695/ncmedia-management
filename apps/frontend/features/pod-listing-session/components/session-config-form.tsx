'use client';

import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, MultiCombobox } from '@/components/ui/combobox';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { usePodTemplates } from '@/features/pod-listing/hooks/use-pod-listing';
import { POD_LISTING_MARKETS } from '@/features/pod-listing/types';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodImageTemplate,
  PodListingMarket,
  PodPricingStrategy,
  PodSkuTemplate,
} from '@/features/pod-listing/types';
import type { PodSessionTemplateSelection } from '../types';

/** Toàn bộ cấu hình của một lượt đăng, ở dạng đang soạn trên màn hình. */
export interface SessionConfigValue {
  name: string;
  market: PodListingMarket;
  shopIds: string[];
  templates: PodSessionTemplateSelection;
  note: string;
}

export function emptyConfig(): SessionConfigValue {
  return { name: '', market: 'US', shopIds: [], templates: {}, note: '' };
}

/**
 * Cấu hình lượt đăng: **Market → Shops → 5 Template**.
 *
 * 🔴 Một form duy nhất cho cả "New Listing" lẫn "sửa cấu hình" ở màn chi tiết. Hai bản sao
 * của cùng một form là cách chắc chắn để một bên quên mất một ô mà bên kia có.
 *
 * 🔴 Category Template lọc theo THỊ TRƯỜNG đang chọn: danh mục US không dùng được cho listing
 * UK, và backend cũng từ chối — chặn ngay ở dropdown thì người dùng không phải đoán.
 */
export function SessionConfigForm({
  value,
  onChange,
  disabled,
}: {
  value: SessionConfigValue;
  onChange: (value: SessionConfigValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('pod');

  const shops = usePodProductFilters().data?.shops ?? [];
  const categoryTemplates = usePodTemplates<PodCategoryTemplate>('categories', {
    activeOnly: true,
    limit: 100,
    market: value.market,
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

  const patch = (part: Partial<SessionConfigValue>): void => onChange({ ...value, ...part });
  const setTemplate = (key: keyof PodSessionTemplateSelection, id: string): void =>
    patch({ templates: { ...value.templates, [key]: id || null } });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-3">
          <Label>
            {t('listing.sessions.name')}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            value={value.name}
            disabled={disabled}
            placeholder={t('listing.sessions.namePlaceholder')}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>{t('listing.sessions.market')}</Label>
          <Combobox
            value={value.market}
            disabled={disabled}
            onChange={(next) =>
              // Đổi thị trường ⇒ bỏ Category Template đang chọn: nó thuộc thị trường cũ và
              // sẽ bị backend từ chối. Im lặng giữ lại chỉ làm lỗi lộ ra muộn hơn.
              patch({
                market: next as PodListingMarket,
                templates: { ...value.templates, categoryTemplateId: null },
              })
            }
            options={POD_LISTING_MARKETS.map((market) => ({ value: market, label: market }))}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>{t('listing.sessions.shops')}</Label>
        {/* Chọn nhiều shop: tìm được, gắn tag, Backspace xoá tag cuối. */}
        <MultiCombobox
          values={value.shopIds}
          onChange={(shopIds) => patch({ shopIds })}
          options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
          disabled={disabled}
          placeholder={
            shops.length === 0 ? t('listing.sessions.noShop') : t('listing.sessions.pickShops')
          }
        />
      </div>

      <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
        <TemplateSelect
          label={t('listing.sessions.categoryTemplate')}
          required
          value={value.templates.categoryTemplateId}
          disabled={disabled}
          options={categoryTemplates.data?.items ?? []}
          onChange={(id) => setTemplate('categoryTemplateId', id)}
        />
        <TemplateSelect
          label={t('listing.sessions.skuTemplate')}
          value={value.templates.skuTemplateId}
          disabled={disabled}
          options={skuTemplates.data?.items ?? []}
          onChange={(id) => setTemplate('skuTemplateId', id)}
        />
        <TemplateSelect
          label={t('listing.sessions.descriptionTemplate')}
          value={value.templates.descriptionTemplateId}
          disabled={disabled}
          options={descriptionTemplates.data?.items ?? []}
          onChange={(id) => setTemplate('descriptionTemplateId', id)}
        />
        <TemplateSelect
          label={t('listing.sessions.imageTemplate')}
          value={value.templates.imageTemplateId}
          disabled={disabled}
          options={imageTemplates.data?.items ?? []}
          onChange={(id) => setTemplate('imageTemplateId', id)}
        />
        <TemplateSelect
          label={t('listing.sessions.pricingTemplate')}
          value={value.templates.pricingStrategyId}
          disabled={disabled}
          options={pricingStrategies.data?.items ?? []}
          onChange={(id) => setTemplate('pricingStrategyId', id)}
        />
      </div>

      <div className="space-y-1">
        <Label>{t('listing.sessions.note')}</Label>
        <Input
          value={value.note}
          disabled={disabled}
          onChange={(event) => patch({ note: event.target.value })}
        />
      </div>
    </div>
  );
}

function TemplateSelect({
  label,
  value,
  options,
  disabled,
  required,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('pod');
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Combobox
        value={value ?? ''}
        disabled={disabled}
        onChange={onChange}
        options={options.map((option) => ({ value: option.id, label: option.name }))}
        clearable
        placeholder={t('listing.common.notSelected')}
      />
    </div>
  );
}
