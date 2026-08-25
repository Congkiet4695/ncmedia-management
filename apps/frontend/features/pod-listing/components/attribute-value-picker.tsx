'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MultiCombobox, type ComboboxOption } from '@/components/ui/combobox';
import type { PodCategoryAttributeDef } from '../types';

/** Giá trị đã chọn của MỘT thuộc tính. */
export interface AttributeSelection {
  /** `value_id` của TikTok — giá trị chính thức. */
  valueIds: string[];
  /** Chuỗi người dùng tự gõ — không có id, TikTok nhận dưới dạng `{ name }`. */
  customValues: string[];
}

/**
 * Bộ chọn giá trị cho MỘT thuộc tính danh mục.
 *
 * ```
 *   [ 8"x12" ×] [ 24"x36" · tự nhập ×]                              ▾
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 🔍 gõ để lọc…                                                  │
 *   │ ✓ 8"x12"                                                       │
 *   │   12"x18"                                                      │
 *   │ ───────────────────────────────────────────────────────────── │
 *   │ Thêm "30x40"                     ← chỉ khi TikTok cho nhập tự do│
 *   └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * Bàn phím: ↓/↑ di chuyển · Enter chọn (hoặc thêm giá trị tự nhập) · Backspace ở ô rỗng xoá
 * tag cuối · Esc đóng. Thuộc tính nào cũng tìm kiếm được, kể cả những danh mục có hàng trăm
 * giá trị như Material hay Theme.
 *
 * 🔴 Nhập tự do chỉ mở khi `attribute.isCustomizable` — cờ này đến thẳng từ metadata TikTok
 * (`is_customizable`), không phải mặc định bật. Với thuộc tính TikTok bắt buộc chọn trong
 * danh sách, ô này không hiện và backend cũng từ chối nếu ai đó gọi thẳng API.
 *
 * 🔴 Hai nguồn giá trị được giữ TÁCH BẠCH khi lưu: giá trị TikTok có `id`, giá trị tự nhập
 * chỉ có tên. Trộn chung sẽ sinh ra `value_id` không tồn tại lúc dựng listing. Trên màn hình
 * chúng nằm chung một danh sách (người dùng không quan tâm sự khác biệt đó), còn `onChange`
 * tách lại bằng cách đối chiếu với tập id chính thức.
 */
export function AttributeValuePicker({
  attribute,
  selection,
  onChange,
}: {
  attribute: PodCategoryAttributeDef;
  selection: AttributeSelection;
  onChange: (next: AttributeSelection) => void;
}) {
  const { t } = useTranslation('pod');
  const multiple = attribute.isMultipleSelection;

  const options = useMemo<ComboboxOption[]>(
    () =>
      (attribute.values ?? [])
        .filter((option) => Boolean(option.id))
        .map((option) => ({ value: option.id as string, label: option.name ?? (option.id as string) })),
    [attribute.values],
  );

  const officialIds = useMemo(
    () => new Set(options.map((option) => option.value)),
    [options],
  );

  // Một danh sách duy nhất cho người dùng nhìn; thứ tự giữ nguyên như đã chọn.
  const values = [...selection.valueIds, ...selection.customValues];

  const handleChange = (next: string[]): void => {
    // Thuộc tính một-lựa-chọn: giữ lại đúng mục vừa chọn.
    const effective = multiple ? next : next.slice(-1);
    onChange({
      valueIds: effective.filter((value) => officialIds.has(value)),
      customValues: effective.filter((value) => !officialIds.has(value)),
    });
  };

  return (
    <MultiCombobox
      values={values}
      onChange={handleChange}
      options={options}
      allowCustomValue={attribute.isCustomizable}
      customLabel={(value) => `${value} · ${t('listing.categoryTemplates.customTag')}`}
      placeholder={
        options.length === 0 && !attribute.isCustomizable
          ? t('listing.categoryTemplates.noValueAvailable')
          : t('listing.categoryTemplates.selectValue')
      }
      searchPlaceholder={attribute.valueDataFormat ?? t('listing.categoryTemplates.searchValues')}
      emptyMessage={t('listing.categoryTemplates.noValueMatch')}
      disabled={options.length === 0 && !attribute.isCustomizable}
    />
  );
}
