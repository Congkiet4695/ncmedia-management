/**
 * Cách gọi tên một TikTok Shop trên giao diện.
 *
 * 🔴 Hệ thống có HAI cái tên cho cùng một gian hàng và chúng phục vụ hai việc khác nhau:
 *
 *   - **Connection Name** — tên do CHÍNH người vận hành đặt lúc liên kết. Đây là thứ họ nhớ.
 *   - **Shop Name** — tên gian hàng do TikTok trả về. Không ai trong đội đặt nó, nó đổi theo
 *     Seller Center, và nhiều kết nối có thể trỏ tới những shop tên na ná nhau.
 *
 * Vì thế mọi chỗ **CHỌN** shop hiển thị Connection Name; danh sách đơn hiển thị **cả hai**.
 *
 * `value` của mọi dropdown vẫn là `shop.id` — không có gì trong hợp đồng API đổi.
 */

/** Shop tối thiểu cần có để dựng nhãn. */
export interface ShopLabelSource {
  name: string;
  connectionName?: string | null;
}

/**
 * Nhãn cho một ô chọn shop.
 *
 * 🔴 Kèm Shop Name trong ngoặc **chỉ khi nó khác** Connection Name. Hai kết nối trùng tên là
 * chuyện có thật (người ta hay đặt "Main", "Backup"), và khi đó chỉ Shop Name mới phân biệt
 * được. Còn khi hai tên trùng nhau thì lặp lại nó chỉ làm dài dòng.
 */
export function shopOptionLabel(shop: ShopLabelSource): string {
  const connection = shop.connectionName?.trim();
  if (!connection) return shop.name;
  return connection === shop.name ? connection : `${connection} (${shop.name})`;
}

/** Chỉ Connection Name — dùng ở chỗ chật, có tooltip kèm tên đầy đủ. */
export function connectionLabel(shop: ShopLabelSource): string {
  return shop.connectionName?.trim() || shop.name;
}
