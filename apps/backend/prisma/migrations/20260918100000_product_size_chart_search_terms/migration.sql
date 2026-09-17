-- Lưu lại phần Get Product ĐÃ trả về nhưng trước đây bị bỏ: từ khoá tìm kiếm, product
-- highlights và bảng size. Không có chúng thì màn hình Sửa sản phẩm không có vế để so, và
-- mọi lần lưu đều phải coi là "thay toàn bộ".
ALTER TABLE "pod_products"
  ADD COLUMN IF NOT EXISTS "search_terms" JSONB,
  ADD COLUMN IF NOT EXISTS "key_product_features" JSONB,
  ADD COLUMN IF NOT EXISTS "size_chart_uri" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "size_chart_url" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "size_chart_template_id" VARCHAR(64);
