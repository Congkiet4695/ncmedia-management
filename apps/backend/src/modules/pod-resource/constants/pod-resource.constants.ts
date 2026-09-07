import { PodResourceType } from '@prisma/client';

/**
 * Hằng số module Resource Sync — tài nguyên **thuộc về một tổ chức**.
 *
 * 🔴 Không có dữ liệu nghiệp vụ nào ở đây — kho hàng đến từ TikTok. File này chỉ mô tả
 * bảng nào đếm cho tài nguyên nào và các giới hạn kỹ thuật.
 */

/** Số dòng nhật ký trả về tối đa trong một lần đọc. */
export const POD_RESOURCE_LOG_MAX_ITEMS = 100;

/**
 * Tài nguyên do TỔ CHỨC tự đồng bộ.
 *
 * 🔴 CATEGORY / BRAND / CATEGORY_ATTRIBUTE đã RỜI khỏi danh sách này: chúng là dữ liệu
 * master toàn cục, chỉ Super Admin đồng bộ, và mọi tổ chức đọc chung — xem
 * `PodMasterDataModule`. Còn lại đúng WAREHOUSE, thứ thật sự khác nhau giữa các shop
 * (mỗi seller khai kho riêng của mình).
 */
export const POD_RESOURCE_ORDER: PodResourceType[] = [PodResourceType.WAREHOUSE];
