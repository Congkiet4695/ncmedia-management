-- Ảnh biến thể (SKU Template) cũng được TikTok cấp uri sau lần upload đầu.
-- Lưu lại để mọi listing sau dùng chung — cùng cơ chế đã áp cho bộ ảnh mẫu.

-- AlterTable
ALTER TABLE "pod_sku_template_items" ADD COLUMN     "image_uploaded_at" TIMESTAMPTZ(6),
ADD COLUMN     "tiktok_image_uri" VARCHAR(512);

