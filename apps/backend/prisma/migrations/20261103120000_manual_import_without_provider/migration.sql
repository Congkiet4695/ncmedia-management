-- Import Excel Base Cost + Tracking Number cho đơn mà kết nối TikTok CHƯA gán nhà cung cấp fulfillment
-- (quyết định PO 2026-11-03).
--
-- Đánh dấu "đã fulfill" bằng Import Excel tạo một bản ghi fulfillment_orders nhập tay (source = MANUAL_IMPORT). Trước đây
-- bản ghi BẮT BUỘC có account_id + provider, và dòng hàng bắt buộc provider_sku ⇒ đơn của kết nối chưa gán nhà cung cấp
-- (hoặc sản phẩm chưa có Product Mapping) không import được. Không được tự gán nhà cung cấp mặc định ⇒ nới NOT NULL,
-- nhưng CHỈ cho bản ghi nhập tay:
--
--   - CHECK fulfillment_orders_provider_source_check: bản ghi của nhà cung cấp (source = PROVIDER) VẪN bắt buộc
--     account_id + provider — mọi luồng gửi / đồng bộ / huỷ qua API không đổi.
--   - Partial unique fulfillment_orders_pod_order_no_provider_unique: tối đa MỘT bản ghi đang sống không có nhà cung
--     cấp cho mỗi đơn (UNIQUE (pod_order_id, provider) sẵn có không áp cho provider NULL).
--   - fulfillment_order_items.provider_sku NULL-able: dòng của bản ghi nhập tay không có Product Mapping. Dòng của bản
--     ghi nhà cung cấp luôn có (code tạo dòng gửi đi luôn điền SKU nhà cung cấp — không đổi).
--
-- Chỉ nới ràng buộc + thêm CHECK/index; mọi bản ghi hiện có đều thoả ⇒ không đổi / không xoá dữ liệu.
--
-- Rollback (chỉ khi chưa có bản ghi nào account_id / provider / provider_sku NULL, sau khi gỡ code):
--   DROP INDEX "fulfillment_orders_pod_order_no_provider_unique";
--   ALTER TABLE "fulfillment_orders" DROP CONSTRAINT "fulfillment_orders_provider_source_check";
--   ALTER TABLE "fulfillment_orders" DROP CONSTRAINT "fulfillment_orders_account_provider_pair_check";
--   ALTER TABLE "fulfillment_orders" ALTER COLUMN "account_id" SET NOT NULL, ALTER COLUMN "provider" SET NOT NULL;
--   ALTER TABLE "fulfillment_order_items" ALTER COLUMN "provider_sku" SET NOT NULL;

ALTER TABLE "fulfillment_orders" ALTER COLUMN "account_id" DROP NOT NULL;
ALTER TABLE "fulfillment_orders" ALTER COLUMN "provider" DROP NOT NULL;

ALTER TABLE "fulfillment_orders"
  ADD CONSTRAINT "fulfillment_orders_provider_source_check"
  CHECK ("source" = 'MANUAL_IMPORT' OR ("account_id" IS NOT NULL AND "provider" IS NOT NULL));

-- Tài khoản và nhà cung cấp đi CÙNG nhau: có cái này thì có cái kia (nhà cung cấp là của tài khoản). Nhờ đó code chỉ cần
-- kiểm `provider` là biết bản ghi có tài khoản.
ALTER TABLE "fulfillment_orders"
  ADD CONSTRAINT "fulfillment_orders_account_provider_pair_check"
  CHECK (("account_id" IS NULL) = ("provider" IS NULL));

CREATE UNIQUE INDEX "fulfillment_orders_pod_order_no_provider_unique"
  ON "fulfillment_orders" ("pod_order_id")
  WHERE "deleted_at" IS NULL AND "provider" IS NULL;

ALTER TABLE "fulfillment_order_items" ALTER COLUMN "provider_sku" DROP NOT NULL;
