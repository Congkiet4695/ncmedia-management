/**
 * Giá vốn SẢN PHẨM của một lần gửi fulfillment — nguồn của "Base cost" (cột Fulfillment) và của
 * lợi nhuận (cột Giá).
 *
 * 🔴 Chỉ PRODUCT COST (quyết định PO): Σ giá vốn từng dòng. Phí ship / thuế / tổng của nhà cung cấp
 * (`fulfillment_orders.shipping_fee/tax/total`) hiển thị RIÊNG, không cộng vào đây — không cộng trùng.
 *
 * 🔴 Mỗi dòng TikTok gửi đi với `quantity = 1` (readiness), nên "đơn giá" hay "thành tiền dòng" của
 * `items[].base_cost` (Mango) / `item_cost` (Sellerwix — tài liệu không nói rõ) trùng nhau. Vẫn nhân
 * `quantity` để đúng nếu luật đó đổi mà nhà cung cấp trả đơn giá.
 *
 * 🔴 Không "làm giả" giá: chừng nào còn MỘT dòng chưa được nhà cung cấp xác nhận
 * (`baseCostConfirmedAt`), tổng vẫn được trả (để hiển thị tạm) nhưng `productCostConfirmed = false`
 * và `baseCostPending = true` ⇒ giao diện ghi "chờ báo giá", lợi nhuận KHÔNG được tính.
 */
export interface ProductCostSummary {
  /** Σ baseCost × quantity của mọi dòng; `null` khi có dòng không có giá nào (kể cả tạm). */
  productCost: number | null;
  /** Mọi dòng đều đã được NHÀ CUNG CẤP xác nhận giá. */
  productCostConfirmed: boolean;
  /** Đơn ĐÃ gửi mà còn dòng chưa được xác nhận giá ⇒ "đang chờ báo giá". */
  baseCostPending: boolean;
}

/**
 * Giá vốn HIỆU LỰC của lần fulfill đang giữ đơn: `pod_orders.base_cost` (Base Cost tổng nhập qua Import) nếu có, không thì
 * tổng các dòng. Bản SQL cùng luật: `pod-tiktok/shared/order-profit.sql.ts`.
 *
 * Giá nhập tay là con số có người chịu trách nhiệm ⇒ coi là đã xác nhận. Kiểm `null` chứ không kiểm truthy: 0 là giá hợp lệ.
 */
export function withOrderBaseCost(
  summary: ProductCostSummary,
  orderBaseCost: { toString(): string } | number | null | undefined,
): ProductCostSummary {
  if (orderBaseCost === null || orderBaseCost === undefined) return summary;
  return { productCost: Number(orderBaseCost), productCostConfirmed: true, baseCostPending: false };
}

export function productCostOf(
  submitted: boolean,
  items: ReadonlyArray<{
    baseCost: { toString(): string } | number | null;
    baseCostConfirmedAt?: Date | null;
    quantity: number;
  }>,
): ProductCostSummary {
  if (items.length === 0) {
    return { productCost: null, productCostConfirmed: false, baseCostPending: false };
  }
  const confirmed = items.every((item) => item.baseCostConfirmedAt != null);
  const priced = items.every((item) => item.baseCost !== null);
  const total = priced
    ? items.reduce((sum, item) => sum + Number(item.baseCost) * (item.quantity || 1), 0)
    : null;
  return {
    productCost: total === null ? null : Math.round(total * 10_000) / 10_000,
    productCostConfirmed: confirmed,
    baseCostPending: submitted && !confirmed,
  };
}
