-- Category Template: cache `uri` TikTok của ảnh bảng size (use case SIZE_CHART_IMAGE) để listing
-- sau dùng lại thay vì upload lại cùng một tấm. Cột nullable, không đụng dữ liệu cũ.
ALTER TABLE "pod_category_templates"
  ADD COLUMN "size_chart_tiktok_image_uri" VARCHAR(512),
  ADD COLUMN "size_chart_image_uploaded_at" TIMESTAMPTZ(6);
