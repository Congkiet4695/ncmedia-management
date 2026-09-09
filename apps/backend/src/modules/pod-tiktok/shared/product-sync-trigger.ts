/**
 * Cổng kích hoạt đồng bộ sản phẩm — **trừu tượng do `pod-tiktok` sở hữu**.
 *
 * 🔴 Vì sao cần một trừu tượng thay vì gọi thẳng `PodProductSyncService`: chiều phụ thuộc
 * giữa hai module là MỘT CHIỀU và cố ý — `PodProductModule → PodTiktokModule` (sản phẩm mượn
 * vòng đời token, giải mã credential và khoá phân tán của pod-tiktok). Tiêm ngược
 * `PodProductSyncService` vào `PodTiktokAccountService` là tạo vòng phụ thuộc giữa hai
 * module, và cách chữa thông thường (`forwardRef` hai đầu) chỉ giấu vòng đó đi chứ không gỡ.
 *
 * Nên đảo ngược phụ thuộc: `pod-tiktok` khai báo thứ nó CẦN, `pod-product` cung cấp thứ nó
 * CÓ. Ràng buộc duy nhất còn lại là một interface bốn dòng, và `pod-tiktok` vẫn không biết
 * gì về module sản phẩm.
 */

/** Token DI — được `PodProductSyncBridgeModule` (@Global) gắn vào `PodProductSyncService`. */
export const PRODUCT_SYNC_TRIGGER = Symbol('PRODUCT_SYNC_TRIGGER');

/** Phạm vi một lượt đồng bộ: cả tổ chức, một kết nối, hoặc một shop. */
export interface ProductSyncScopeFilter {
  organizationId?: string;
  accountId?: string;
  shopId?: string;
}

/**
 * Kích hoạt đồng bộ sản phẩm.
 *
 * Cố ý chỉ có ĐÚNG một phương thức và không trả về gì: nơi gọi (luồng liên kết tài khoản)
 * không chờ kết quả và không được phép phụ thuộc vào hình dạng kết quả.
 */
export interface ProductSyncTrigger {
  syncShops(filter: ProductSyncScopeFilter, options: { trigger: 'MANUAL' }): Promise<unknown>;
}
