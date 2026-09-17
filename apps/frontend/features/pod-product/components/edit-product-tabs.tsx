'use client';

import { useState } from 'react';
import { AlertTriangle, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { cn } from '@/lib/utils';
import { MediaEditor } from '@/features/pod-listing-session/components/media-editor';
import { TemplatePicker } from '@/features/pod-listing-session/components/template-picker';
import type { PodSkuTemplate } from '@/features/pod-listing/types';
import type { PodProductDetail } from '../types';
import { BulkSkuBar, type BulkSkuPatch } from './bulk-sku-bar';
import {
  applyCategoryTemplateToProduct,
  imagesFromTemplate,
  sizeChartFromTemplate,
  type EditProductForm,
  type SkuDraft,
} from './edit-product-state';
import { toOptions, type ProductTemplates } from './edit-product-templates';

/** Trần của TikTok (Create/Edit Product). Chặn ngay tại chỗ gõ. */
export const TITLE_MAX = 255;
export const DESCRIPTION_MAX = 10_000;
export const SEARCH_TERMS_MAX = 15;

/**
 * Tab 1 — Nội dung sản phẩm.
 *
 * Hai mẫu áp được ở đây: **Category Template** (thương hiệu · bảng size · video — KHÔNG phải
 * danh mục) và **Description Template** (đổ HTML vào trình soạn thảo).
 */
export function ContentTab({
  product,
  form,
  onPatch,
  templates,
}: {
  product: PodProductDetail;
  form: EditProductForm;
  onPatch: (next: Partial<EditProductForm>) => void;
  templates: ProductTemplates;
}) {
  const { t } = useTranslation('pod');
  const [pickedCategory, setPickedCategory] = useState('');
  const [pickedDescription, setPickedDescription] = useState('');

  /**
   * Áp Category Template.
   *
   * 🔴 Danh mục KHÔNG đổi — `partial_edit` không nhận `category_id`. Mẫu khai danh mục khác
   * thì nói thẳng phần đó bị bỏ, thay vì để người dùng tin là đã đổi xong.
   */
  const applyCategory = (id: string) => {
    const template = templates.categories.data?.items.find((item) => item.id === id);
    if (!template) return;
    const effect = applyCategoryTemplateToProduct(template, product);

    const next: Partial<EditProductForm> = {};
    if (effect.brandId) next.brandId = effect.brandId;
    if (effect.sizeChartFileId) {
      next.sizeChart = {
        imageUrl: '',
        fileId: effect.sizeChartFileId,
        imageType: 'SIZE_CHART',
        fileName: template.name,
      };
    }
    if (effect.videoFileId) next.video = { fileId: effect.videoFileId, fileName: template.name };

    if (Object.keys(next).length === 0) {
      toast.warning(t('products.edit.categoryTemplateBlocked'));
      return;
    }
    onPatch(next);
    toast.success(t('products.edit.templateApplied', { name: template.name }));
    if (effect.categoryBlocked) toast.warning(t('products.edit.categoryTemplateBlocked'));
  };

  /** Áp Description Template — đổ HTML vào đúng trình soạn thảo đang dùng, giữ nguyên định dạng. */
  const applyDescription = (id: string) => {
    const template = templates.descriptions.data?.items.find((item) => item.id === id);
    if (!template) return;
    onPatch({ description: template.contentHtml ?? '' });
    toast.success(t('products.edit.templateApplied', { name: template.name }));
  };

  return (
    <div className="space-y-4">
      <TemplatePicker
        label={t('products.edit.categoryTemplate')}
        options={toOptions(templates.categories.data?.items, (item) => item.categoryPath)}
        loading={templates.categories.isLoading}
        error={templates.categories.isError}
        value={pickedCategory}
        onChange={setPickedCategory}
        onApply={applyCategory}
        onRefresh={() => void templates.categories.refetch()}
        refreshing={templates.categories.isRefetching}
        confirmMessage={t('products.edit.confirmApply')}
      />
      {/* 🔴 Nói TRƯỚC khi người dùng bấm Áp dụng, không chỉ cảnh báo sau. */}
      <p className="text-xs text-muted-foreground">{t('products.edit.categoryTemplateHint')}</p>

      <div className="space-y-1">
        <Label>
          {t('products.edit.productTitle')}
          <span className="ml-1 text-destructive">*</span>
        </Label>
        <textarea
          value={form.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          rows={2}
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        <p
          className={cn(
            'text-right text-xs',
            form.title.length > TITLE_MAX
              ? 'font-medium text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {form.title.length} / {TITLE_MAX}
        </p>
      </div>

      <div className="space-y-1">
        <Label>{t('products.edit.searchTerms')}</Label>
        <Input
          value={form.searchTerms}
          onChange={(event) => onPatch({ searchTerms: event.target.value })}
          placeholder={t('products.edit.searchTermsPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">
          {t('products.edit.searchTermsHint', { max: SEARCH_TERMS_MAX })}
        </p>
      </div>

      <div className="space-y-1">
        <Label>{t('products.edit.highlights')}</Label>
        <textarea
          value={form.highlights}
          onChange={(event) => onPatch({ highlights: event.target.value })}
          rows={4}
          placeholder={t('products.edit.highlightsPlaceholder')}
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">{t('products.edit.highlightsHint')}</p>
      </div>

      <TemplatePicker
        label={t('products.edit.descriptionTemplate')}
        options={toOptions(templates.descriptions.data?.items, (item) => item.note)}
        loading={templates.descriptions.isLoading}
        error={templates.descriptions.isError}
        value={pickedDescription}
        onChange={setPickedDescription}
        onApply={applyDescription}
        onRefresh={() => void templates.descriptions.refetch()}
        refreshing={templates.descriptions.isRefetching}
        confirmMessage={t('products.edit.confirmReplaceDescription')}
      />

      <div className="space-y-1">
        <Label>{t('products.edit.description')}</Label>
        {/* 🔴 ĐÚNG trình soạn thảo của Template Description — áp mẫu xong vẫn sửa tay được, và
            mọi định dạng (đậm, nghiêng, danh sách, link) giữ nguyên vì cùng một HTML. */}
        <RichTextEditor
          value={form.description}
          onChange={(description) => onPatch({ description })}
          minHeight="220px"
        />
        <p
          className={cn(
            'text-right text-xs',
            form.description.length > DESCRIPTION_MAX
              ? 'font-medium text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {form.description.length} / {DESCRIPTION_MAX}
        </p>
      </div>

      <ReadonlyNote
        label={t('products.edit.category')}
        value={product.categoryPath ?? product.categoryName ?? '—'}
        reason={t('products.edit.categoryLocked')}
      />
      <ReadonlyNote
        label={t('products.edit.brand')}
        value={
          form.brandId && form.brandId !== product.tiktokBrandId
            ? t('products.edit.brandFromTemplate', { id: form.brandId })
            : (product.brandName ?? t('products.edit.noBrand'))
        }
        reason={t('products.edit.brandNote')}
      />
    </div>
  );
}

/**
 * Tab 2 — Ảnh sản phẩm, bảng size và video.
 *
 * 🔴 Dùng LẠI `MediaEditor` của luồng Custom Listing: thêm, xoá, đổi thứ tự, kiểm định dạng
 * và dung lượng, tải lên qua Storage Module — tất cả đã có và đã chạy thật. Viết bộ thứ hai
 * chỉ để giao diện hơi khác là nhân đôi chỗ để sai.
 *
 * 🔴 Ảnh ĐẦU TIÊN là ảnh đại diện. TikTok không có trường riêng cho ảnh chính — thứ tự trong
 * `main_images` quyết định. Nên "đặt làm ảnh chính" = kéo tấm đó lên đầu, chứ không phải một
 * cờ `isPrimary` tự bịa rồi không biết gửi đi đâu.
 */
export function ImagesTab({
  form,
  onPatch,
  templates,
}: {
  form: EditProductForm;
  onPatch: (next: Partial<EditProductForm>) => void;
  templates: ProductTemplates;
}) {
  const { t } = useTranslation('pod');
  const [picked, setPicked] = useState('');

  /**
   * Áp bộ ảnh mẫu.
   *
   * 🔴 THAY cả bộ ảnh chứ không nối thêm — đó là ý nghĩa của "bộ ảnh mẫu", và `TemplatePicker`
   * đã hỏi xác nhận trước. Ảnh bảng size trong mẫu tách riêng, KHÔNG để lẫn vào ảnh sản phẩm:
   * cùng một tấm ảnh nhưng TikTok cấp `uri` khác nhau theo `use_case`.
   */
  const applyImages = (id: string) => {
    const template = templates.images.data?.items.find((item) => item.id === id);
    if (!template) return;

    const images = imagesFromTemplate(template);
    const sizeChart = sizeChartFromTemplate(template);
    if (images.length === 0 && !sizeChart) {
      toast.warning(t('products.edit.imageTemplateEmpty'));
      return;
    }

    onPatch({
      ...(images.length > 0 ? { images } : {}),
      ...(sizeChart ? { sizeChart } : {}),
    });
    toast.success(t('products.edit.imageTemplateApplied', { count: images.length }));
  };

  return (
    <div className="space-y-4">
      <TemplatePicker
        label={t('products.edit.imageTemplate')}
        options={toOptions(templates.images.data?.items, (item) =>
          t('products.edit.imageTemplateHint', { count: item.items?.length ?? 0 }),
        )}
        loading={templates.images.isLoading}
        error={templates.images.isError}
        value={picked}
        onChange={setPicked}
        onApply={applyImages}
        onRefresh={() => void templates.images.refetch()}
        refreshing={templates.images.isRefetching}
        confirmMessage={t('products.edit.confirmReplaceImages')}
      />

      <MediaEditor
        images={form.images}
        onImagesChange={(images) => onPatch({ images })}
        sizeChart={form.sizeChart}
        onSizeChartChange={(sizeChart) => onPatch({ sizeChart })}
        video={form.video}
        onVideoChange={(video) => onPatch({ video })}
        // 🔴 Thay được nhưng GỠ thì không — xem `products.edit.mediaRemoveLocked`.
        removable={{ sizeChart: false, video: false }}
      />

      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{t('products.edit.mediaRemoveLocked')}</span>
      </div>
    </div>
  );
}

/** Tab 3 — SKU sản phẩm. */
export function SkusTab({
  product,
  form,
  templates,
  onChange,
  onBulk,
  onApplySkuTemplate,
}: {
  product: PodProductDetail;
  form: EditProductForm;
  templates: ProductTemplates;
  onChange: (tiktokSkuId: string, patch: Partial<SkuDraft>) => void;
  onBulk: (patch: BulkSkuPatch, matchedSkuIds: string[]) => void;
  onApplySkuTemplate: (template: PodSkuTemplate) => void;
}) {
  const { t } = useTranslation('pod');
  const [picked, setPicked] = useState('');

  return (
    <div className="space-y-4">
      <TemplatePicker
        label={t('products.edit.skuTemplate')}
        options={toOptions(templates.skus.data?.items, (item) =>
          t('products.edit.skuTemplateHint', { count: item.items?.length ?? 0 }),
        )}
        loading={templates.skus.isLoading}
        error={templates.skus.isError}
        value={picked}
        onChange={setPicked}
        onApply={(id) => {
          const template = templates.skus.data?.items.find((item) => item.id === id);
          if (template) onApplySkuTemplate(template);
        }}
        onRefresh={() => void templates.skus.refetch()}
        refreshing={templates.skus.isRefetching}
        confirmMessage={t('products.edit.confirmApplySkuTemplate')}
      />

      {/* 🔴 Hai nút này TẮT, và lý do nằm ngay cạnh. TikTok không có cách thêm biến thể hay
          thêm SKU cho sản phẩm đã tạo qua `partial_edit` — dựng form rồi báo "đã lưu" là nói
          dối. Để nút ở trạng thái tắt còn hơn giấu đi: người dùng đang đi tìm đúng nó. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
        <Button variant="outline" size="sm" disabled title={t('products.edit.variantsLocked')}>
          <Plus className="size-3.5" />
          {t('products.edit.addVariation')}
        </Button>
        <Button variant="outline" size="sm" disabled title={t('products.edit.variantsLocked')}>
          <Plus className="size-3.5" />
          {t('products.edit.addSku')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('products.edit.variantsLocked')}</span>
      </div>

      <BulkSkuBar variants={product.variants} onApply={onBulk} />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t('products.edit.variant')}</th>
              <th className="px-3 py-2 text-left">{t('products.edit.sellerSku')}</th>
              <th className="px-3 py-2 text-left">{t('products.edit.retailPrice')}</th>
              <th className="px-3 py-2 text-left">{t('products.edit.listPrice')}</th>
              <th className="px-3 py-2 text-left">{t('products.edit.quantity')}</th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant) => {
              const draft = form.skus[variant.tiktokSkuId];
              if (!draft) return null;
              const priceInvalid = draft.salePrice.trim() !== '' && !(Number(draft.salePrice) > 0);
              return (
                <tr key={variant.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {variant.variantName ?? variant.tiktokSkuId}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={draft.sellerSku}
                      className="h-8 w-[180px]"
                      onChange={(event) =>
                        onChange(variant.tiktokSkuId, { sellerSku: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={draft.salePrice}
                      inputMode="decimal"
                      className={cn('h-8 w-[100px]', priceInvalid && 'border-destructive')}
                      onChange={(event) =>
                        onChange(variant.tiktokSkuId, { salePrice: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={draft.listPrice}
                      inputMode="decimal"
                      className="h-8 w-[100px]"
                      onChange={(event) =>
                        onChange(variant.tiktokSkuId, { listPrice: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={draft.quantity}
                      type="number"
                      min="0"
                      className="h-8 w-[100px]"
                      onChange={(event) =>
                        onChange(variant.tiktokSkuId, { quantity: event.target.value })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{t('products.edit.inventoryNote')}</span>
      </div>
    </div>
  );
}

/** Một trường CHỈ ĐỌC kèm lý do — thà nói rõ còn hơn dựng ô nhập rồi bỏ qua giá trị. */
function ReadonlyNote({ label, value, reason }: { label: string; value: string; reason: string }) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5">
        <Lock className="size-3.5 text-muted-foreground" />
        {label}
      </Label>
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{value}</p>
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}
