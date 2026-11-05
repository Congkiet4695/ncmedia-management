-- Base Cost tổng của Order, nhập qua Import Base Cost / Tracking.
--
-- Trước đây schema KHÔNG có cột nào ở cấp Order: giá vốn đơn chỉ là tổng fulfillment_order_items.base_cost × quantity, nên
-- đơn nhiều dòng hoặc không có dòng cần fulfill không có chỗ để lưu một con số cho cả đơn.
--
-- Giá vốn hiệu lực của đơn = pod_orders.base_cost, không có thì tổng các dòng. Lợi nhuận chỉ tính khi đơn có lần fulfill
-- đang giữ đơn, như trước. Đồng bộ TikTok không ghi các cột này (như design_amount).
--
-- Chỉ THÊM cột NULL-able, không đổi dữ liệu.
--
-- Rollback (sau khi gỡ code; giá đã import vào các cột này sẽ mất):
--   ALTER TABLE "pod_orders" DROP CONSTRAINT "pod_orders_base_cost_check";
--   ALTER TABLE "pod_orders"
--     DROP COLUMN "base_cost", DROP COLUMN "base_cost_currency",
--     DROP COLUMN "base_cost_updated_at", DROP COLUMN "base_cost_updated_by";

ALTER TABLE "pod_orders"
  ADD COLUMN "base_cost" DECIMAL(18, 4),
  ADD COLUMN "base_cost_currency" VARCHAR(10),
  ADD COLUMN "base_cost_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "base_cost_updated_by" UUID;

-- 0 là giá hợp lệ. Có giá thì phải có đơn vị tiền: lợi nhuận so đơn vị tiền này với tiền thu về.
ALTER TABLE "pod_orders"
  ADD CONSTRAINT "pod_orders_base_cost_check"
  CHECK ("base_cost" IS NULL OR ("base_cost" >= 0 AND "base_cost_currency" IS NOT NULL));
