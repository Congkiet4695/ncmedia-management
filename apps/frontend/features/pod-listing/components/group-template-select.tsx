'use client';

import Link from 'next/link';
import { Layers, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { GROUP_SLOTS, type GroupApplyPlan, type GroupSlot } from '../group-template-apply';
import type { PodGroupTemplate } from '../types';

/** Đường dẫn tab Group Template — nơi người dùng tạo group khi danh sách còn trống. */
export const GROUP_TEMPLATES_PATH = '/dashboard/pod/templates/groups';

/**
 * Bộ chọn **Group Template** — dùng chung cho Auto Listing và Custom Listing.
 *
 * ```
 *   Group Template  [Tee Comfort Colors — US · Womenswear/T-Shirts · 18 SKU · 6 ảnh ▾] [×]
 * ```
 *
 * Component chỉ hiển thị + báo id được chọn ra ngoài. Việc ÁP (hỏi xác nhận nếu sẽ đè dữ
 * liệu nhập tay, gọi API, ghi vào form) là của màn hình — mỗi màn hình lưu dữ liệu theo cách
 * riêng, nhưng cùng một quy tắc (`group-template-apply.ts`).
 *
 * Bỏ chọn (×) KHÔNG xoá dữ liệu đã áp — chỉ gỡ nhãn "đã áp từ group nào".
 */
export function GroupTemplateSelect({
  value,
  groups,
  loading,
  error,
  applying,
  disabled,
  fallbackName,
  fallbackDeleted,
  hint,
  onChange,
}: {
  value: string;
  groups: PodGroupTemplate[];
  loading?: boolean;
  error?: boolean;
  /** Đang tải bản đầy đủ của group để áp. */
  applying?: boolean;
  disabled?: boolean;
  /** Tên đã lưu của group đang chọn — để vẫn hiện được khi group không còn trong danh sách. */
  fallbackName?: string | null;
  /** Group đang chọn đã bị xoá. */
  fallbackDeleted?: boolean;
  /** Dòng gợi ý thay cho câu mặc định (vd quy tắc riêng khi mở lại nháp). */
  hint?: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation('pod');

  const options: ComboboxOption[] = groups.map((group) => ({
    value: group.id,
    label: group.name,
    hint: groupHint(group, t),
  }));
  // Group đã chọn trước đó nhưng không còn trong danh sách (đã xoá / tắt): vẫn hiện tên đã lưu.
  if (value && !groups.some((group) => group.id === value)) {
    options.unshift({
      value,
      label: fallbackDeleted || !fallbackName
        ? t('listing.groupTemplates.deletedOption', { name: fallbackName ?? value })
        : fallbackName,
      disabled: true,
    });
  }

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5">
        <Layers className="size-4 text-muted-foreground" />
        {t('listing.groupTemplates.field')}
        {applying && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </Label>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        loading={loading}
        disabled={disabled || applying}
        clearable
        placeholder={t('listing.groupTemplates.pick')}
        searchPlaceholder={t('listing.groupTemplates.search')}
        emptyMessage={t('listing.groupTemplates.noMatch')}
      />
      {error ? (
        <p className="text-xs text-destructive">{t('listing.groupTemplates.loadFailed')}</p>
      ) : !loading && groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('listing.groupTemplates.emptyPicker')}{' '}
          <Link href={GROUP_TEMPLATES_PATH} className="font-medium text-primary underline-offset-2 hover:underline">
            {t('listing.groupTemplates.goCreate')}
          </Link>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint ?? t('listing.groupTemplates.pickerHint')}</p>
      )}
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const slotLabels = (slots: GroupSlot[], t: Translate) =>
  slots.map((slot) => t(`listing.groupTemplates.slot.${slot}`)).join(', ');

/**
 * Câu hỏi xác nhận trước khi áp — CHỈ khi sẽ thay dữ liệu người dùng tự nhập. `null` = không
 * cần hỏi (khu vực trống, hoặc dữ liệu vẫn y như group trước điền).
 */
export function groupOverwriteConfirm(plan: GroupApplyPlan, groupName: string, t: Translate): string | null {
  if (plan.overwritesManual.length === 0) return null;
  return t('listing.groupTemplates.confirmOverwrite', {
    name: groupName,
    slots: slotLabels(plan.overwritesManual, t),
  });
}

/** Thông báo sau khi áp: đã điền gì, dọn gì của group cũ, giữ gì của người dùng. */
export function groupApplySummary(plan: GroupApplyPlan, t: Translate): string {
  const set = GROUP_SLOTS.filter((slot) => plan.actions[slot] === 'set');
  const lines = [t('listing.groupTemplates.summarySet', { slots: slotLabels(set, t) })];
  if (plan.cleared.length > 0) {
    lines.push(t('listing.groupTemplates.summaryCleared', { slots: slotLabels(plan.cleared, t) }));
  }
  if (plan.keptManual.length > 0) {
    lines.push(t('listing.groupTemplates.summaryKept', { slots: slotLabels(plan.keptManual, t) }));
  }
  return lines.join(' ');
}

/** Dòng phụ của một group: thị trường · danh mục · số SKU · số ảnh — chỉ phần group có. */
export function groupHint(group: PodGroupTemplate, t: Translate): string {
  const parts: string[] = [];
  if (group.categoryTemplate) {
    parts.push(group.categoryTemplate.market);
    parts.push(group.categoryTemplate.categoryName ?? group.categoryTemplate.name);
  }
  if (group.skuTemplate) {
    parts.push(t('listing.groupTemplates.skuCount', { count: group.skuTemplate._count.items }));
  }
  if (group.descriptionTemplate) parts.push(t('listing.groupTemplates.hasDescription'));
  if (group.imageTemplate) {
    parts.push(t('listing.groupTemplates.imageCount', { count: group.imageTemplate._count.items }));
  }
  return parts.join(' · ');
}
