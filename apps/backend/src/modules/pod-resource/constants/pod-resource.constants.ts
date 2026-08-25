import { PodResourceType } from '@prisma/client';

/**
 * Hằng số module Resource Sync.
 *
 * 🔴 Không có dữ liệu nghiệp vụ nào ở đây — danh mục, thương hiệu, kho đều đến từ TikTok.
 * File này chỉ mô tả **bảng nào đếm cho tài nguyên nào** và các giới hạn kỹ thuật.
 */

/** Số dòng nhật ký trả về tối đa trong một lần đọc. */
export const POD_RESOURCE_LOG_MAX_ITEMS = 100;

/** Số danh mục tối đa được yêu cầu đồng bộ thuộc tính trong một lần bấm. */
export const POD_RESOURCE_ATTRIBUTE_MAX_CATEGORIES = 50;

/** Thứ tự hiển thị trên màn hình Resources — theo đúng thứ tự cần có để dựng Template. */
export const POD_RESOURCE_ORDER: PodResourceType[] = [
  PodResourceType.CATEGORY,
  PodResourceType.BRAND,
  PodResourceType.CATEGORY_ATTRIBUTE,
  PodResourceType.WAREHOUSE,
];

/** Tài nguyên nào phụ thuộc tài nguyên nào — hiển thị để người dùng biết thứ tự bấm Sync. */
export const POD_RESOURCE_DEPENDS_ON: Partial<Record<PodResourceType, PodResourceType>> = {
  [PodResourceType.CATEGORY_ATTRIBUTE]: PodResourceType.CATEGORY,
};
