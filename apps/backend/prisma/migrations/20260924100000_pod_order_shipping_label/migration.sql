-- Nhãn vận chuyển TikTok cho đơn POD.
--
-- Vì sao cần: địa chỉ người nhận có thể bị TikTok che (đơn 4PL, hoặc quá 30 ngày sau
-- COMPLETED). Khi KHÔNG còn đọc được địa chỉ, thứ hợp lệ để gửi sản xuất là nhãn vận chuyển
-- do TikTok cấp (Get Package Shipping Document) hoặc nhãn người vận hành tự dán vào.
-- Trước đây nhãn chỉ nằm trong body của lần gọi Fulfill nên backend không thể dựa vào nó để
-- quyết định "đơn này gửi được chưa" — đó chính là lý do nút Fulfill bị khoá vĩnh viễn.
--
-- Toàn bộ cột đều NULLABLE ⇒ tương thích ngược, không cần backfill.

-- AlterTable
ALTER TABLE "pod_orders"
  ADD COLUMN "shipping_label_url" VARCHAR(2048),
  ADD COLUMN "shipping_label_source" VARCHAR(16),
  ADD COLUMN "shipping_label_package_id" VARCHAR(64),
  ADD COLUMN "shipping_label_tracking_number" VARCHAR(128),
  ADD COLUMN "shipping_label_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "pod_order_packages"
  ADD COLUMN "shipping_service_id" VARCHAR(64),
  ADD COLUMN "shipping_service_name" VARCHAR(255),
  ADD COLUMN "tracking_number" VARCHAR(128),
  ADD COLUMN "shipping_document_url" VARCHAR(2048),
  ADD COLUMN "document_fetched_at" TIMESTAMPTZ(6);
