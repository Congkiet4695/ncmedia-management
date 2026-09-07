/**
 * Kiểu dữ liệu nhóm **Promotion (Activity)** của TikTok Shop.
 *
 * 🔴 Đây là ranh giới kiểu: module nghiệp vụ (`pod-flash-sale`) CHỈ thấy các interface ở
 * file này, không bao giờ thấy lớp `Promotion202309*` do SDK sinh. Đổi version SDK ⇒ sửa
 * `TiktokPromotionApiService`, không lan ra tầng nghiệp vụ.
 *
 * Đặt tên theo camelCase vì SDK đã dịch `snake_case` của TikTok sang camelCase khi
 * deserialize — giữ nguyên để không phải ánh xạ thêm một lớp nữa.
 */

import type { TiktokActivityProductLevel, TiktokActivityType } from '../tiktok-sdk.constants';

/** Một SKU trong payload Update Activity Products. */
export interface TiktokActivitySkuInput {
  /** `sku_id` phía TikTok. */
  id: string;
  /** Giá deal — CHUỖI, đúng như TikTok yêu cầu (tránh sai số dấu phẩy động). */
  activityPriceAmount?: string;
  /** % giảm dạng chuỗi (`"10"` = giảm 10%). Chỉ dùng cho `DIRECT_DISCOUNT`. */
  discount?: string;
  /** `[1, 99]` hoặc `-1` = không giới hạn. */
  quantityLimit?: number;
  quantityPerUser?: number;
}

/** Một sản phẩm trong payload Update Activity Products. */
export interface TiktokActivityProductInput {
  /** `product_id` phía TikTok. */
  id: string;
  activityPriceAmount?: string;
  discount?: string;
  quantityLimit?: number;
  quantityPerUser?: number;
  /**
   * 🔴 Bắt buộc là `[]` khi `product_level = PRODUCT` — TikTok từ chối request nếu thiếu,
   * chứ không mặc định thành mảng rỗng.
   */
  skus: TiktokActivitySkuInput[];
}

/** Tham số tạo một hoạt động khuyến mãi. */
export interface TiktokCreateActivityRequest {
  /** Tên hoạt động — tối đa 50 ký tự, DUY NHẤT trong shop. */
  title: string;
  activityType: TiktokActivityType;
  productLevel: TiktokActivityProductLevel;
  /** Unix seconds. Phải LỚN HƠN thời điểm hiện tại. */
  beginTime: number;
  endTime: number;
}

/** Tham số sửa một hoạt động đã tạo (tên + khung giờ). */
export interface TiktokUpdateActivityRequest {
  title?: string;
  productLevel?: TiktokActivityProductLevel;
  beginTime?: number;
  endTime?: number;
}

/** Kết quả Create Activity. */
export interface TiktokCreateActivityResult {
  activityId: string;
  status?: string;
}

/** Một SKU trong hoạt động, theo mô tả TikTok trả về. */
export interface TiktokActivitySkuResult {
  id?: string;
  activityPrice?: { amount?: string; currency?: string };
  quantityLimit?: number;
  quantityPerUser?: number;
}

/** Một sản phẩm trong hoạt động, theo mô tả TikTok trả về. */
export interface TiktokActivityProductResult {
  id?: string;
  activityPrice?: { amount?: string; currency?: string };
  discount?: string;
  quantityLimit?: number;
  quantityPerUser?: number;
  skus?: TiktokActivitySkuResult[];
}

/** Bản đầy đủ của một hoạt động (Get Activity). */
export interface TiktokActivityDetail {
  activityId?: string;
  activityType?: string;
  productLevel?: string;
  title?: string;
  /**
   * 🔴 `string` chứ không phải union đóng: TikTok bổ sung trạng thái mới bất cứ lúc nào, và
   * khoá cứng kiểu ở đây sẽ khiến một giá trị lạ làm hỏng cả lượt đồng bộ thay vì chỉ rơi
   * vào nhánh "không rõ". Bảng ánh xạ (`TIKTOK_TO_FLASH_SALE_STATUS`) xử lý phần thu hẹp.
   */
  status?: string;
  beginTime?: number;
  endTime?: number;
  createTime?: number;
  updateTime?: number;
  /** Chứa `IMMUTABLE` ⇒ hoạt động KHÔNG còn sửa/huỷ được. */
  activityCommands?: string[];
  products?: TiktokActivityProductResult[];
}

/** Kết quả Update Activity Products — TikTok trả lại danh sách đã nhận. */
export interface TiktokUpdateActivityProductsResult {
  activityId?: string;
  products?: TiktokActivityProductResult[];
}

/** Bộ lọc của Search Activities. */
export interface TiktokActivitySearchFilter {
  activityType?: TiktokActivityType;
  activityTitle?: string;
  /** Xem chú thích ở `TiktokActivityDetail.status` — cố ý để mở. */
  status?: string;
}

/** Bản tóm tắt trong Search Activities. */
export interface TiktokActivitySummary {
  activityId?: string;
  activityType?: string;
  title?: string;
  status?: string;
  beginTime?: number;
  endTime?: number;
  productLevel?: string;
}
