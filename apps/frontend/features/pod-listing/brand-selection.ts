/**
 * Lựa chọn thương hiệu trên giao diện — khớp `PodBrandMode` của backend.
 *
 * 🔴 "No brand" **không phải một dòng trong bảng thương hiệu**. Trước đây nó là một bản ghi
 * do hệ thống tự tạo quanh một `brand_id` viết cứng; chọn nó nghĩa là template lưu id đó và
 * TikTok phân giải ra một thương hiệu người dùng không hề chọn. Nay nó là một TRẠNG THÁI.
 */
export type PodBrandMode = 'UNSET' | 'NONE' | 'SPECIFIC';

/**
 * Giá trị của ô "No brand" trong Combobox.
 *
 * 🔴 Dấu `__` hai đầu để không thể trùng với `tiktok_brand_id` thật (TikTok dùng id toàn số).
 * Giá trị này CHỈ sống trong component — trước khi gửi API nó được dịch sang
 * `brandMode: 'NONE'` bởi `toBrandPayload`.
 */
export const NO_BRAND_OPTION = '__NO_BRAND__';

/** Lựa chọn thương hiệu ở dạng form đang giữ. */
export interface BrandChoice {
  /** `''` = chưa chọn · `NO_BRAND_OPTION` = No brand · còn lại = `tiktok_brand_id` thật. */
  id: string;
  name: string;
}

/** Đọc trạng thái brand của một template đã lưu về dạng form. */
export function toBrandChoice(template?: {
  brandMode?: PodBrandMode | null;
  tiktokBrandId?: string | null;
  brandName?: string | null;
}): BrandChoice {
  if (!template) return { id: '', name: '' };
  if (template.brandMode === 'NONE') {
    return { id: NO_BRAND_OPTION, name: template.brandName ?? 'No brand' };
  }
  return { id: template.tiktokBrandId ?? '', name: template.brandName ?? '' };
}

/**
 * Dịch lựa chọn của form sang đúng ba trường mà API nhận.
 *
 * 🔴 `brandMode` luôn được gửi, kể cả `UNSET`. Bỏ trống nó thì backend phải đoán ý định từ
 * `tiktokBrandId` (đường tương thích ngược dành cho client cũ) — và "đoán" chính là thứ đã
 * tạo ra lỗi này ngay từ đầu.
 */
export function toBrandPayload(choice: BrandChoice): {
  brandMode: PodBrandMode;
  tiktokBrandId?: string;
  brandName?: string;
} {
  if (choice.id === NO_BRAND_OPTION) {
    return { brandMode: 'NONE', tiktokBrandId: undefined, brandName: 'No brand' };
  }
  if (choice.id) {
    return {
      brandMode: 'SPECIFIC',
      tiktokBrandId: choice.id,
      brandName: choice.name || undefined,
    };
  }
  return { brandMode: 'UNSET', tiktokBrandId: undefined, brandName: undefined };
}
