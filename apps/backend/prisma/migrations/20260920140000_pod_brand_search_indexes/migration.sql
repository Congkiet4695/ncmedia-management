-- Thương hiệu TikTok: ~2,06 triệu dòng sau khi đồng bộ đủ (BRAND_SYNC_FIX_REPORT.md).
-- Bộ chọn brand tìm ILIKE '%từ khoá%' và danh sách sắp theo (is_no_brand DESC, name) —
-- không có hai chỉ mục này thì mỗi lần gõ là một lần quét tuần tự cả bảng (~1,5 giây).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "pod_product_brands_name_trgm_idx" ON "pod_product_brands" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "pod_product_brands_no_brand_name_idx" ON "pod_product_brands"("is_no_brand" DESC, "name");
