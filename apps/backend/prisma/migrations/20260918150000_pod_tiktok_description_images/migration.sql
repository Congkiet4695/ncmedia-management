-- Ảnh trong MÔ TẢ sản phẩm đã upload lên TikTok với use_case = DESCRIPTION_IMAGE.
--
-- Thuần bổ sung: bảng mới, không đụng dữ liệu cũ. Là metadata "src này đã là ảnh mô tả TikTok
-- chưa" (thay cho việc đoán theo tiền tố URL) và cache dedup theo file/checksum/URL nguồn.
CREATE TABLE "pod_tiktok_description_images" (
  "id"              UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "source_key"      VARCHAR(200) NOT NULL,
  "source_url"      VARCHAR(2048) NOT NULL,
  "file_id"         UUID,
  "checksum"        CHAR(64),
  "tiktok_uri"      VARCHAR(512) NOT NULL,
  "tiktok_url"      VARCHAR(2048) NOT NULL,
  "width"           INTEGER,
  "height"          INTEGER,
  "uploaded_at"     TIMESTAMPTZ(6) NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pod_tiktok_description_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pod_tiktok_description_images_organization_id_source_key_key"
  ON "pod_tiktok_description_images"("organization_id", "source_key");
CREATE INDEX "pod_tiktok_description_images_organization_id_tiktok_url_idx"
  ON "pod_tiktok_description_images"("organization_id", "tiktok_url");
CREATE INDEX "pod_tiktok_description_images_organization_id_checksum_idx"
  ON "pod_tiktok_description_images"("organization_id", "checksum");
