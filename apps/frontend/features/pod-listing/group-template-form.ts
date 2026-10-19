import type { PodGroupTemplate } from './types';

/**
 * Form **Group Template** ⇄ payload API. Hàm thuần — kiểm bằng `scripts/verify-group-template.ts`.
 *
 * 🔴 Payload luôn mang ĐỦ 4 mảnh: ô trống gửi `null` (= gỡ mảnh ra). Bỏ trường đi thì backend
 * hiểu là "giữ nguyên" và người dùng xoá một mảnh trên form mà group vẫn giữ nó.
 */

/** Giới hạn tên — cùng số với `@MaxLength(255)` của DTO backend. */
export const GROUP_TEMPLATE_NAME_MAX = 255;
export const GROUP_TEMPLATE_NOTE_MAX = 500;

export interface GroupTemplateFormValue {
  name: string;
  categoryTemplateId: string;
  skuTemplateId: string;
  descriptionTemplateId: string;
  imageTemplateId: string;
  isActive: boolean;
  note: string;
}

export type GroupTemplateFormError = 'NAME_REQUIRED' | 'NAME_TOO_LONG' | 'NOTE_TOO_LONG' | 'PART_REQUIRED';

export function groupTemplateFormFrom(template: PodGroupTemplate | null): GroupTemplateFormValue {
  return {
    name: template?.name ?? '',
    categoryTemplateId: template?.categoryTemplateId ?? '',
    skuTemplateId: template?.skuTemplateId ?? '',
    descriptionTemplateId: template?.descriptionTemplateId ?? '',
    imageTemplateId: template?.imageTemplateId ?? '',
    isActive: template?.isActive ?? true,
    note: template?.note ?? '',
  };
}

/** Lỗi theo thứ tự hiển thị. Mảng rỗng = hợp lệ. Backend kiểm lại toàn bộ. */
export function validateGroupTemplateForm(form: GroupTemplateFormValue): GroupTemplateFormError[] {
  const errors: GroupTemplateFormError[] = [];
  const name = form.name.trim();
  if (!name) errors.push('NAME_REQUIRED');
  else if (name.length > GROUP_TEMPLATE_NAME_MAX) errors.push('NAME_TOO_LONG');
  if (form.note.trim().length > GROUP_TEMPLATE_NOTE_MAX) errors.push('NOTE_TOO_LONG');
  if (
    !form.categoryTemplateId &&
    !form.skuTemplateId &&
    !form.descriptionTemplateId &&
    !form.imageTemplateId
  ) {
    errors.push('PART_REQUIRED');
  }
  return errors;
}

export function buildGroupTemplatePayload(
  form: GroupTemplateFormValue,
  editing: boolean,
): Record<string, unknown> {
  return {
    name: form.name.trim(),
    categoryTemplateId: form.categoryTemplateId || null,
    skuTemplateId: form.skuTemplateId || null,
    descriptionTemplateId: form.descriptionTemplateId || null,
    imageTemplateId: form.imageTemplateId || null,
    note: form.note.trim() || null,
    // Bật/tắt chỉ có ý nghĩa khi sửa — group mới luôn bật.
    ...(editing ? { isActive: form.isActive } : {}),
  };
}
