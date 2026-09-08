import { Prisma } from '@prisma/client';

/**
 * Cách nhận diện một TikTok Shop trên giao diện.
 *
 * 🔴 Hệ thống có HAI cái tên cho cùng một gian hàng, và chúng phục vụ hai mục đích khác nhau:
 *
 *   - **Connection Name** (`pod_tiktok_accounts.account_name`) — tên do CHÍNH người vận hành
 *     đặt khi liên kết. Đây là thứ họ nhớ và dùng để phân biệt các kết nối của mình.
 *   - **Shop Name** (`pod_tiktok_shops.name`) — tên gian hàng do TikTok trả về. Không ai
 *     trong đội đặt nó, nó đổi theo Seller Center, và nhiều kết nối có thể trỏ tới những
 *     shop tên na ná nhau.
 *
 * Vì thế mọi chỗ **CHỌN** shop (dropdown, filter, picker) hiển thị Connection Name, còn
 * danh sách đơn hiển thị **cả hai** để đối chiếu với Seller Center.
 *
 * KHÔNG có cột `connection_name` nào được thêm vào database: quan hệ
 * `PodTiktokShop → PodTiktokAccount` đã có sẵn, nhân bản tên ra bảng shop chỉ tạo ra hai
 * nguồn sự thật rồi lệch nhau ở lần đổi tên kết nối đầu tiên.
 */

/**
 * Phần `select` bổ sung để lấy Connection Name kèm theo shop.
 *
 * Dùng chung để 12 chỗ đọc shop không mỗi nơi tự viết một kiểu — và để thêm shop mới vào
 * giao diện là một dòng, không phải một cuộc truy tìm.
 */
export const SHOP_CONNECTION_SELECT = {
  account: { select: { accountName: true } },
} as const satisfies Prisma.PodTiktokShopSelect;

/** Shop kèm đủ dữ liệu để dựng nhãn hiển thị. */
export interface ShopWithConnection {
  name: string;
  account?: { accountName: string } | null;
}

/**
 * Connection Name của một shop, có phương án dự phòng.
 *
 * 🔴 Rơi về Shop Name khi thiếu kết nối thay vì trả chuỗi rỗng: một dropdown có dòng trống
 * là một dòng người dùng không chọn được và không hiểu vì sao. Trên thực tế `account` luôn
 * có (khoá ngoại NOT NULL) — nhánh dự phòng chỉ để các đường đọc cũ chưa `include` account
 * không làm hỏng giao diện.
 */
export function connectionNameOf(shop: ShopWithConnection): string {
  return shop.account?.accountName?.trim() || shop.name;
}
