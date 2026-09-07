import { PodBrandMode } from '@prisma/client';
import { POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID } from '../../pod-product/constants/pod-product.constants';

/** Phần cấu hình thương hiệu của một template, ở dạng client gửi lên. */
export interface BrandSelectionInput {
  brandMode?: PodBrandMode;
  tiktokBrandId?: string | null;
  brandName?: string | null;
}

/** Kết quả đã chuẩn hoá, ghi thẳng xuống database được. */
export interface BrandSelection {
  brandMode: PodBrandMode;
  tiktokBrandId: string | null;
  brandName: string | null;
}

/**
 * Chuẩn hoá lựa chọn thương hiệu TRƯỚC KHI ghi database.
 *
 * 🔴 Đây là cửa duy nhất biến "những gì client gửi" thành "trạng thái hợp lệ trong database".
 * Ba việc nó làm, mỗi việc chặn một cách hỏng đã từng xảy ra:
 *
 * 1. **Tương thích ngược.** Client cũ không biết `brandMode`; có `tiktokBrandId` thì hiểu là
 *    `SPECIFIC`, không có thì `UNSET`. Không có bước này, mọi template sửa từ client cũ sẽ
 *    rơi về `UNSET` và bị chặn publish.
 *
 * 2. **`NONE` phải sạch.** Chọn "No brand" mà vẫn để lại `tiktok_brand_id` trong hàng là để
 *    dành một quả mìn: chỉ cần một chỗ nào đó đọc `tiktokBrandId` thay vì `brandMode` là
 *    thương hiệu cũ quay lại payload.
 *
 * 3. **Chặn id giả.** `7082427311584347905` từng được hệ thống tự bịa và gán tên "No brand".
 *    Nó KHÔNG phải "No brand" của TikTok — gửi lên là sản phẩm mang thương hiệu người dùng
 *    không hề chọn. Nhận được id này nghĩa là người dùng đang muốn "No brand", nên quy về
 *    `NONE` thay vì ghi tiếp cái sai xuống database.
 */
export function normalizeBrandSelection(input: BrandSelectionInput): BrandSelection {
  const rawId = input.tiktokBrandId?.trim() || null;

  if (rawId === POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID) {
    return { brandMode: PodBrandMode.NONE, tiktokBrandId: null, brandName: 'No brand' };
  }

  const mode = input.brandMode ?? (rawId ? PodBrandMode.SPECIFIC : PodBrandMode.UNSET);

  switch (mode) {
    case PodBrandMode.NONE:
      return { brandMode: PodBrandMode.NONE, tiktokBrandId: null, brandName: 'No brand' };

    case PodBrandMode.SPECIFIC:
      // `SPECIFIC` mà không kèm id là mâu thuẫn — hạ về `UNSET` để validator nói rõ
      // "chưa chọn thương hiệu" thay vì publish một payload thiếu brand một cách im lặng.
      return rawId
        ? {
            brandMode: PodBrandMode.SPECIFIC,
            tiktokBrandId: rawId,
            brandName: input.brandName?.trim() || null,
          }
        : { brandMode: PodBrandMode.UNSET, tiktokBrandId: null, brandName: null };

    default:
      return { brandMode: PodBrandMode.UNSET, tiktokBrandId: null, brandName: null };
  }
}

/**
 * Lựa chọn thương hiệu có được đụng tới trong request này không.
 *
 * Dùng cho PATCH: request chỉ đổi tên template thì KHÔNG được đụng tới brand. Không có phép
 * kiểm này, mọi lần sửa template đều vô tình reset brand về `UNSET`.
 */
export function hasBrandSelection(input: BrandSelectionInput): boolean {
  return (
    input.brandMode !== undefined ||
    input.tiktokBrandId !== undefined ||
    input.brandName !== undefined
  );
}
