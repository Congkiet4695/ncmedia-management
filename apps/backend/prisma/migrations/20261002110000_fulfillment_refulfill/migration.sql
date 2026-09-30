-- Fulfill lại sau khi nhà cung cấp đã huỷ đơn.
--
-- Bản ghi đã huỷ được LƯU TRỮ (deleted_at) — giữ nguyên items, raw request/response, giá vốn và
-- toàn bộ fulfillment_histories — rồi tạo bản ghi MỚI với mã đơn mới cho lần thử kế tiếp.
-- UNIQUE (pod_order_id, provider) cũ tính cả bản ghi đã lưu trữ nên chặn đúng việc này; thay bằng
-- partial unique chỉ áp cho bản ghi đang hiệu lực. Hàng rào "hai người bấm Fulfill cùng lúc" giữ
-- nguyên: tối đa MỘT bản ghi sống cho mỗi (đơn, nhà cung cấp).
--
-- Backward compatible: dữ liệu hiện có đều thoả index mới (index cũ chặt hơn).

DROP INDEX IF EXISTS "fulfillment_orders_pod_order_id_provider_key";

CREATE UNIQUE INDEX "fulfillment_orders_pod_order_id_provider_active_key"
  ON "fulfillment_orders"("pod_order_id", "provider")
  WHERE "deleted_at" IS NULL;

-- Chỉ mục thường cho truy vấn lịch sử theo đơn (kể cả lần thử đã lưu trữ).
CREATE INDEX "fulfillment_orders_pod_order_id_provider_idx"
  ON "fulfillment_orders"("pod_order_id", "provider");

-- Sự kiện nhật ký: bản ghi đã huỷ được thay bằng một lần thử mới.
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
