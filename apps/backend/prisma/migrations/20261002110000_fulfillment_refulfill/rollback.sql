-- Rollback chỉ chạy được khi không còn hai bản ghi (kể cả đã lưu trữ) cho cùng (đơn, nhà cung cấp).
-- Giá trị enum 'SUPERSEDED' không gỡ được trong PostgreSQL — để lại, vô hại.
DROP INDEX IF EXISTS "fulfillment_orders_pod_order_id_provider_idx";
DROP INDEX IF EXISTS "fulfillment_orders_pod_order_id_provider_active_key";
CREATE UNIQUE INDEX "fulfillment_orders_pod_order_id_provider_key" ON "fulfillment_orders"("pod_order_id", "provider");
