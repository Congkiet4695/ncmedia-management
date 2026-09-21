-- Ảnh mặc định cho GIÁ TRỊ biến thể của SKU Template (Color = Black → black.jpg).
--
-- Thuần bổ sung: ba cột NULL trên pod_sku_template_variant_values + FK Storage File. Template cũ
-- không có ảnh giữ nguyên hành vi. Ảnh thuộc về giá trị của trục ĐẦU TIÊN; tổ hợp chứa giá trị
-- đó kế thừa khi dựng listing (`sku_img` của TikTok chỉ gắn vào sales attribute đầu).
ALTER TABLE "pod_sku_template_variant_values"
  ADD COLUMN "image_file_id" UUID,
  ADD COLUMN "tiktok_image_uri" VARCHAR(512),
  ADD COLUMN "image_uploaded_at" TIMESTAMPTZ(6);

ALTER TABLE "pod_sku_template_variant_values"
  ADD CONSTRAINT "pod_sku_template_variant_values_image_file_id_fkey"
  FOREIGN KEY ("image_file_id") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pod_sku_template_variant_values_image_file_id_idx"
  ON "pod_sku_template_variant_values"("image_file_id");

-- 🔴 Sửa use_case: ảnh biến thể (`sku_img`) phải upload với `use_case = ATTRIBUTE_IMAGE` (hợp
-- đồng Create Product của TikTok), trước đây upload bằng MAIN_IMAGE. `uri` đã cache là uri của
-- use case sai ⇒ xoá cache để lần publish tới upload lại đúng use case. Không mất file gốc.
UPDATE "pod_sku_template_items"
SET "tiktok_image_uri" = NULL, "image_uploaded_at" = NULL
WHERE "tiktok_image_uri" IS NOT NULL;
