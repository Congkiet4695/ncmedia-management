/**
 * Giá vốn (Base Cost) của một lần gửi fulfillment — nguồn của "Base cost" (cột Fulfillment) và của lợi nhuận (cột Giá).
 *
 * 🔴 Luật (quyết định PO 2026-11-17, thay luật "chỉ Σ giá vốn từng dòng" trước đó) — theo thứ tự ưu tiên:
 *   1. `pod_orders.base_cost` — Base Cost nhập tay qua Import (có người chịu trách nhiệm) ⇒ `IMPORT`.
 *   2. **Provider Total** — `fulfillment_orders.total`: số TỔNG nhà cung cấp THỰC SỰ tính cho đơn, đọc từ response tạo đơn /
 *      chi tiết đơn của nhà cung cấp (Mango `total` = Σ `line_total` + `shipping_fee` + `tax`; Sellerwix `total_cost`;
 *      Pressify `total_cost`). Không tự cộng lại các thành phần ⇒ `PROVIDER_TOTAL`.
 *   3. Σ `base_cost × quantity` của các dòng — chỉ khi nhà cung cấp chưa trả tổng ⇒ `ITEMS` (như trước: chỉ vào lợi nhuận
 *      khi MỌI dòng đã được nhà cung cấp xác nhận giá).
 *
 *   Giá tham chiếu từ danh mục (Reference Base Cost) KHÔNG BAO GIỜ là giá vốn cuối cùng của đơn đã gửi; đồng bộ danh mục
 *   không ghi vào bất kỳ nguồn nào ở trên.
 *
 * 🔴 Vì sao không còn "Σ dòng": đơn 577685712591753317 (Mango) — mỗi dòng `base_cost` 5.45 (giá phôi) nhưng `line_total`
 * 9.45 (phôi + phí in thêm vị trí), `subtotal` 18.90, `shipping_fee` 0.50, `total` 19.40. Σ dòng = 10.90 bỏ sót phí in và
 * phí ship mà nhà cung cấp thật sự tính.
 *
 * 🔴 Label: tổng của Mango / Sellerwix ĐÃ gồm khoản 0.50 / đơn (Mango `shipping_fee`, Sellerwix phần chênh của
 * `total_cost`) — đúng khoản mà `ORDER_LABEL_COST` ước lượng. Giá vốn `PROVIDER_TOTAL` ⇒ `includesLabel = true` ⇒ lợi nhuận
 * KHÔNG trừ label lần nữa (quyết định PO 2026-11-17). `IMPORT` / `ITEMS` ⇒ trừ label như trước.
 *
 * 🔴 Không "làm giả" giá: chừng nào chưa có tổng của nhà cung cấp và còn MỘT dòng chưa được xác nhận (`baseCostConfirmedAt`),
 * tổng dòng vẫn được trả (để hiển thị tạm) nhưng `productCostConfirmed = false` và `baseCostPending = true` ⇒ giao diện ghi
 * "chờ báo giá", lợi nhuận KHÔNG được tính.
 */
export type ProductCostSource = 'IMPORT' | 'PROVIDER_TOTAL' | 'ITEMS';

export interface ProductCostSummary {
  /** Giá vốn hiệu lực của đơn; `null` khi chưa có giá nào (kể cả tạm). */
  productCost: number | null;
  /** Giá vốn đã được xác nhận (nhà cung cấp trả tổng / xác nhận mọi dòng, hoặc nhập tay). */
  productCostConfirmed: boolean;
  /** Đơn ĐÃ gửi mà còn dòng chưa được xác nhận giá ⇒ "đang chờ báo giá". */
  baseCostPending: boolean;
  /** Nguồn của `productCost` — `null` khi chưa có giá. */
  productCostSource: ProductCostSource | null;
  /** Giá vốn ĐÃ gồm phí label / đơn của nhà cung cấp ⇒ lợi nhuận không trừ `ORDER_LABEL_COST` lần nữa. */
  labelIncludedInCost: boolean;
}

/**
 * Giá vốn HIỆU LỰC của lần fulfill đang giữ đơn: `pod_orders.base_cost` (Base Cost tổng nhập qua Import) nếu có, không thì
 * `summary` (Provider Total / tổng các dòng). Bản SQL cùng luật: `pod-tiktok/shared/order-profit.sql.ts`.
 *
 * Giá nhập tay là con số có người chịu trách nhiệm ⇒ coi là đã xác nhận. Kiểm `null` chứ không kiểm truthy: 0 là giá hợp lệ.
 */
export function withOrderBaseCost(
  summary: ProductCostSummary,
  orderBaseCost: { toString(): string } | number | null | undefined,
): ProductCostSummary {
  if (orderBaseCost === null || orderBaseCost === undefined) return summary;
  return {
    productCost: Number(orderBaseCost),
    productCostConfirmed: true,
    baseCostPending: false,
    productCostSource: 'IMPORT',
    labelIncludedInCost: false,
  };
}

/**
 * @param providerTotal `fulfillment_orders.total` — tổng nhà cung cấp trả. Có (kể cả 0) ⇒ là giá vốn của đơn.
 */
export function productCostOf(
  submitted: boolean,
  items: ReadonlyArray<{
    baseCost: { toString(): string } | number | null;
    baseCostConfirmedAt?: Date | null;
    quantity: number;
  }>,
  providerTotal?: { toString(): string } | number | null,
): ProductCostSummary {
  if (providerTotal !== null && providerTotal !== undefined && Number.isFinite(Number(providerTotal))) {
    return {
      productCost: Math.round(Number(providerTotal) * 10_000) / 10_000,
      productCostConfirmed: true,
      baseCostPending: false,
      productCostSource: 'PROVIDER_TOTAL',
      labelIncludedInCost: true,
    };
  }
  if (items.length === 0) {
    return {
      productCost: null,
      productCostConfirmed: false,
      baseCostPending: false,
      productCostSource: null,
      labelIncludedInCost: false,
    };
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
    productCostSource: total === null ? null : 'ITEMS',
    labelIncludedInCost: false,
  };
}
