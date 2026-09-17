'use client';

import { usePodTemplates } from '@/features/pod-listing/hooks/use-pod-listing';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '@/features/pod-listing/types';

/** Bốn bộ template mà màn hình Sửa sản phẩm dùng tới. */
export interface ProductTemplates {
  categories: ReturnType<typeof usePodTemplates<PodCategoryTemplate>>;
  descriptions: ReturnType<typeof usePodTemplates<PodDescriptionTemplate>>;
  skus: ReturnType<typeof usePodTemplates<PodSkuTemplate>>;
  images: ReturnType<typeof usePodTemplates<PodImageTemplate>>;
}

const TEMPLATE_QUERY = { limit: 100 };

/**
 * Nạp template của tổ chức — dùng LẠI đúng endpoint và kiểu của module Listing, không tạo
 * module template thứ hai.
 *
 * 🔴 `enabled` theo trạng thái mở modal: danh sách chỉ có nghĩa khi màn hình Sửa đang mở, mà
 * bảng sản phẩm thì render lại rất thường xuyên.
 *
 * 🔴 **Chỉ nạp, không tự áp.** Chọn một mẫu trong dropdown không đụng gì tới form — phải bấm
 * "Áp dụng" (xem `TemplatePicker`), và không có đường nào từ đây đi thẳng ra TikTok.
 */
export function usePodProductTemplates(open: boolean): ProductTemplates {
  return {
    categories: usePodTemplates<PodCategoryTemplate>('categories', TEMPLATE_QUERY, {
      enabled: open,
    }),
    descriptions: usePodTemplates<PodDescriptionTemplate>('descriptions', TEMPLATE_QUERY, {
      enabled: open,
    }),
    skus: usePodTemplates<PodSkuTemplate>('skus', TEMPLATE_QUERY, { enabled: open }),
    images: usePodTemplates<PodImageTemplate>('images', TEMPLATE_QUERY, { enabled: open }),
  };
}

/** Danh sách mẫu → lựa chọn của `TemplatePicker`. */
export function toOptions<T extends { id: string; name: string }>(
  items: T[] | undefined,
  hint: (item: T) => string | null,
): Array<{ id: string; name: string; hint: string | null }> {
  return (items ?? []).map((item) => ({ id: item.id, name: item.name, hint: hint(item) }));
}
