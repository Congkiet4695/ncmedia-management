'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { cn } from '@/lib/utils';
import {
  GROUP_TEMPLATE_NAME_MAX,
  GROUP_TEMPLATE_NOTE_MAX,
  buildGroupTemplatePayload,
  groupTemplateFormFrom,
  validateGroupTemplateForm,
  type GroupTemplateFormError,
  type GroupTemplateFormValue,
} from '../group-template-form';
import { usePodTemplates, useSavePodTemplate } from '../hooks/use-pod-listing';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodGroupTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '../types';

const ERROR_KEY: Record<GroupTemplateFormError, string> = {
  NAME_REQUIRED: 'listing.groupTemplates.nameRequired',
  NAME_TOO_LONG: 'listing.groupTemplates.nameTooLong',
  NOTE_TOO_LONG: 'listing.groupTemplates.noteTooLong',
  PART_REQUIRED: 'listing.groupTemplates.partRequired',
};

/**
 * Form **Group Template** — tạo / sửa / xem.
 *
 * ```
 *   Group Template Name *  [Tee Comfort Colors — US          ]
 *   Category    [Tee US — Womenswear > T-Shirts (US)       ▾]
 *   SKU         [Comfort Colors S–3XL · 18 SKU             ▾]
 *   Description [Mô tả áo thun chuẩn                       ▾]
 *   Image       [Comfort Colors mockup · 6 ảnh             ▾]
 * ```
 *
 * Mỗi ô chọn lấy từ template đã có (Category Template mang danh mục TikTok đã đồng bộ + thuộc
 * tính; SKU Template mang trục biến thể + bảng SKU; Image Template mang bộ ảnh có thứ tự).
 * Group chỉ lưu ID tham chiếu — muốn đổi nội dung thì sửa template con.
 *
 * `readOnly` = chế độ XEM cho người chỉ có quyền đọc: cùng form, mọi ô khoá.
 */
export function GroupTemplateDialog({
  open,
  template,
  readOnly,
  onClose,
}: {
  open: boolean;
  template: PodGroupTemplate | null;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const save = useSavePodTemplate<PodGroupTemplate>('groups');
  const [form, setForm] = useState<GroupTemplateFormValue>(() => groupTemplateFormFrom(null));
  const [submitted, setSubmitted] = useState(false);

  // Nạp danh sách chỉ khi dialog mở — bảng group render lại liên tục, không cần 4 request đó.
  const enabled = open;
  const categories = usePodTemplates<PodCategoryTemplate>('categories', { activeOnly: true, limit: 100 }, { enabled });
  const skus = usePodTemplates<PodSkuTemplate>('skus', { activeOnly: true, limit: 100 }, { enabled });
  const descriptions = usePodTemplates<PodDescriptionTemplate>('descriptions', { activeOnly: true, limit: 100 }, { enabled });
  const images = usePodTemplates<PodImageTemplate>('images', { activeOnly: true, limit: 100 }, { enabled });

  useEffect(() => {
    if (!open) return;
    setForm(groupTemplateFormFrom(template));
    setSubmitted(false);
  }, [open, template]);

  const errors = validateGroupTemplateForm(form);
  const showErrors = submitted ? errors : [];
  const patch = (part: Partial<GroupTemplateFormValue>) => setForm((prev) => ({ ...prev, ...part }));

  /**
   * Template đang được group dùng nhưng đã TẮT thì không còn trong danh sách `activeOnly` —
   * vẫn phải hiện tên của nó, không thì ô chọn trông như trống và lưu lại là mất mảnh đó.
   * Đã bị XOÁ ⇒ vẫn hiện (để người dùng thấy mảnh nào mất) kèm nhãn "đã xoá"; backend chặn lưu.
   */
  const withCurrent = (
    options: ComboboxOption[],
    current: { id: string; name: string; deletedAt?: string | null } | null | undefined,
  ): ComboboxOption[] =>
    current && !options.some((option) => option.value === current.id)
      ? [
          {
            value: current.id,
            label: current.deletedAt ? `${current.name} (${t('listing.groupTemplates.partDeleted')})` : current.name,
          },
          ...options,
        ]
      : options;

  /**
   * 🔴 Nguồn là **Category Template** của tổ chức (`GET /pod/templates/categories`), KHÔNG phải cây danh mục
   * TikTok. Nhãn chính = TÊN template; gợi ý bên phải chỉ là thị trường (ngắn). Trước đây gợi ý là đường dẫn
   * danh mục TikTok — Combobox giữ nguyên gợi ý (`shrink-0`) nên đường dẫn dài đẩy tên template bị cắt mất,
   * danh sách trông như danh mục TikTok.
   */
  const categoryOptions = useMemo(
    () =>
      withCurrent(
        (categories.data?.items ?? []).map((item) => ({
          value: item.id,
          label: item.name,
          hint: t('listing.groupTemplates.categoryTemplateMarket', { market: item.market }),
        })),
        template?.categoryTemplate,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `withCurrent` chỉ đọc `t`
    [categories.data, template, t],
  );
  /** Mảnh đang chọn trỏ tới template đã bị xoá ⇒ cảnh báo ngay dưới ô (lưu sẽ bị backend từ chối). */
  const deletedNote = (current: { id: string; deletedAt?: string | null } | null | undefined, value: string) =>
    current?.deletedAt && current.id === value ? t('listing.groupTemplates.partDeletedHint') : undefined;
  const skuOptions = useMemo(
    () =>
      withCurrent(
        (skus.data?.items ?? []).map((item) => ({
          value: item.id,
          label: item.name,
          hint: t('listing.groupTemplates.skuCount', { count: item._count?.items ?? 0 }),
        })),
        template?.skuTemplate,
      ),
    [skus.data, template, t],
  );
  const descriptionOptions = useMemo(
    () =>
      withCurrent(
        (descriptions.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
        template?.descriptionTemplate,
      ),
    [descriptions.data, template, t],
  );
  const imageOptions = useMemo(
    () =>
      withCurrent(
        (images.data?.items ?? []).map((item) => ({
          value: item.id,
          label: item.name,
          hint: t('listing.groupTemplates.imageCount', { count: item.items?.length ?? 0 }),
        })),
        template?.imageTemplate,
      ),
    [images.data, template, t],
  );

  const handleSubmit = async () => {
    setSubmitted(true);
    if (errors.length > 0) return;
    try {
      await save.mutateAsync({
        id: template?.id,
        payload: buildGroupTemplatePayload(form, Boolean(template)),
      });
      toast.success(t('listing.common.saved'));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  const title = readOnly
    ? t('listing.groupTemplates.view')
    : template
      ? t('listing.groupTemplates.edit')
      : t('listing.groupTemplates.create');
  const disabled = readOnly || save.isPending;
  const nameError = showErrors.find((error) => error === 'NAME_REQUIRED' || error === 'NAME_TOO_LONG');

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-2xl"
      title={title}
      description={t('listing.groupTemplates.dialogHint')}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="space-y-1">
          <Label htmlFor="groupTemplateName">
            {t('listing.groupTemplates.name')}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            id="groupTemplateName"
            value={form.name}
            maxLength={GROUP_TEMPLATE_NAME_MAX}
            disabled={disabled}
            aria-invalid={Boolean(nameError)}
            className={cn(nameError && 'border-destructive')}
            placeholder={t('listing.groupTemplates.namePlaceholder')}
            onChange={(event) => patch({ name: event.target.value })}
          />
          {nameError && <p className="text-xs text-destructive">{t(ERROR_KEY[nameError], { max: GROUP_TEMPLATE_NAME_MAX })}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <PartSelect
            label={t('listing.groupTemplates.slot.category')}
            hint={t('listing.groupTemplates.categoryHint')}
            value={form.categoryTemplateId}
            options={categoryOptions}
            loading={categories.isLoading}
            error={categories.isError}
            warning={deletedNote(template?.categoryTemplate, form.categoryTemplateId)}
            disabled={disabled}
            onChange={(id) => patch({ categoryTemplateId: id })}
          />
          <PartSelect
            label={t('listing.groupTemplates.slot.sku')}
            hint={t('listing.groupTemplates.skuHint')}
            value={form.skuTemplateId}
            options={skuOptions}
            loading={skus.isLoading}
            error={skus.isError}
            warning={deletedNote(template?.skuTemplate, form.skuTemplateId)}
            disabled={disabled}
            onChange={(id) => patch({ skuTemplateId: id })}
          />
          <PartSelect
            label={t('listing.groupTemplates.slot.description')}
            value={form.descriptionTemplateId}
            options={descriptionOptions}
            loading={descriptions.isLoading}
            error={descriptions.isError}
            warning={deletedNote(template?.descriptionTemplate, form.descriptionTemplateId)}
            disabled={disabled}
            onChange={(id) => patch({ descriptionTemplateId: id })}
          />
          <PartSelect
            label={t('listing.groupTemplates.slot.image')}
            hint={t('listing.groupTemplates.imageHint')}
            value={form.imageTemplateId}
            options={imageOptions}
            loading={images.isLoading}
            error={images.isError}
            warning={deletedNote(template?.imageTemplate, form.imageTemplateId)}
            disabled={disabled}
            onChange={(id) => patch({ imageTemplateId: id })}
          />
        </div>
        {showErrors.includes('PART_REQUIRED') && (
          <p className="text-xs text-destructive">{t(ERROR_KEY.PART_REQUIRED)}</p>
        )}

        <div className="space-y-1">
          <Label htmlFor="groupTemplateNote">{t('listing.common.note')}</Label>
          <Input
            id="groupTemplateNote"
            value={form.note}
            maxLength={GROUP_TEMPLATE_NOTE_MAX}
            disabled={disabled}
            onChange={(event) => patch({ note: event.target.value })}
          />
          {showErrors.includes('NOTE_TOO_LONG') && (
            <p className="text-xs text-destructive">{t(ERROR_KEY.NOTE_TOO_LONG, { max: GROUP_TEMPLATE_NOTE_MAX })}</p>
          )}
        </div>

        {template && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={disabled}
              onChange={(event) => patch({ isActive: event.target.checked })}
            />
            {t('listing.common.active')}
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {readOnly ? t('common:action.close') : t('common:action.cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void handleSubmit()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('common:action.save')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PartSelect({
  label,
  hint,
  value,
  options,
  loading,
  error,
  warning,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: ComboboxOption[];
  loading?: boolean;
  error?: boolean;
  warning?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation('pod');
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        loading={loading}
        disabled={disabled}
        clearable
        placeholder={t('listing.common.notSelected')}
      />
      {error ? (
        <p className="text-xs text-destructive">{t('listing.templatePicker.loadFailed')}</p>
      ) : warning ? (
        <p className="text-xs text-destructive">{warning}</p>
      ) : !loading && options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('listing.templatePicker.empty')}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
