-- Module Product Mapping.
--
-- Viết tay để dùng UNIQUE INDEX CÓ ĐIỀU KIỆN — Prisma chưa diễn đạt được `WHERE` trên
-- `@@unique`, mà ràng buộc ở đây bắt buộc phải bỏ qua bản ghi đã xoá mềm: xoá một ánh xạ
-- rồi tạo lại cùng Seller SKU là thao tác hợp lệ và phải làm được.

-- 1. Tên biến thể nguyên văn từ nhà cung cấp (hiển thị + đối soát).
ALTER TABLE "fulfillment_product_mappings"
  ADD COLUMN "provider_variant_name" VARCHAR(255);

-- 2. "Một Seller SKU chỉ được map một lần với một Provider".
--    Áp trên (organization, account, seller_sku) và CHỈ với bản ghi còn sống.
--    NULL không tham gia UNIQUE trong Postgres, nên ánh xạ theo `tiktok_sku_id` hoặc
--    `tiktok_product_id` (seller_sku để trống) không bị ràng buộc này chặn nhầm.
CREATE UNIQUE INDEX "fulfillment_product_mappings_seller_sku_unique"
  ON "fulfillment_product_mappings" ("organization_id", "account_id", "seller_sku")
  WHERE "deleted_at" IS NULL AND "seller_sku" IS NOT NULL;

-- 3. Chỉ mục phục vụ tra cứu ngược khi hiển thị "đơn nào đang dùng ánh xạ này".
CREATE INDEX "fulfillment_product_mappings_provider_sku_idx"
  ON "fulfillment_product_mappings" ("organization_id", "provider_sku")
  WHERE "deleted_at" IS NULL;
