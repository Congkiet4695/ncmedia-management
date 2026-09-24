/**
 * Kiểu dữ liệu nhóm **Fulfillment / Logistics** của TikTok Shop — chỉ những trường hệ thống
 * thực sự dùng, khai lại đúng như SDK sinh ra (`vendor/tiktok-shop-sdk/model/fulfillment/…`).
 *
 * Cố ý KHÔNG re-export type của SDK: đây là ranh giới giữ cho module nghiệp vụ không phải
 * biết tên lớp `Fulfillment202309…` của SDK, đúng nguyên tắc đã áp dụng cho nhóm Product.
 */

/** Một dịch vụ vận chuyển TikTok đề xuất cho đơn (`shipping_services[]`). */
export interface TiktokShippingService {
  id?: string;
  name?: string;
  /** TikTok đánh dấu lựa chọn mặc định — hệ thống ưu tiên đúng lựa chọn này. */
  isDefault?: boolean;
  price?: string;
  currency?: string;
  shippingFee?: string;
  shippingProviderId?: string;
  shippingProviderName?: string;
  earliestDeliveryDays?: number;
  latestDeliveryDays?: number;
}

/** Kết quả **Get Eligible Shipping Service**. */
export interface TiktokEligibleShippingServices {
  orderId?: string;
  orderLineId?: string[];
  shippingServices?: TiktokShippingService[];
}

/** Thân request **Create Packages** — chỉ những trường hệ thống gửi. */
export interface TiktokCreatePackageRequest {
  orderId?: string;
  /**
   * Dòng hàng đưa vào gói. Bỏ trống ⇒ TikTok gói TOÀN BỘ dòng hàng đủ điều kiện của đơn —
   * đúng nhu cầu của hệ thống (một đơn POD = một gói).
   */
  orderLineItemIds?: string[];
  /** Id dịch vụ vận chuyển lấy từ Get Eligible Shipping Service. KHÔNG bao giờ viết cứng. */
  shippingServiceId?: string;
}

/** Kết quả **Create Packages**. */
export interface TiktokCreatedPackage {
  packageId?: string;
  orderId?: string;
  orderLineItemIds?: string[];
  createTime?: number;
  shippingServiceInfo?: {
    id?: string;
    name?: string;
    shippingProviderId?: string;
    shippingProviderName?: string;
  };
}

/** Kết quả **Get Package Shipping Document**. */
export interface TiktokShippingDocument {
  /** URL tài liệu (PDF/PNG) do TikTok ký — **CÓ HẠN**, không coi là URL vĩnh viễn. */
  docUrl?: string;
  trackingNumber?: string;
}

/** Kết quả **Get Package Detail** — dùng để biết gói còn dùng được hay không. */
export interface TiktokPackageDetail {
  packageId?: string;
  /** `package_status` — gói đã huỷ/đã giao thì không lấy nhãn mới được nữa. */
  packageStatus?: string;
  packageSubStatus?: string;
  trackingNumber?: string;
  shippingProviderId?: string;
  shippingProviderName?: string;
  orderLineItemIds?: string[];
}
