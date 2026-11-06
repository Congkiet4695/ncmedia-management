-- Bản thu nhỏ và URL nguồn của file Storage. Cột nullable, không ghi lại dòng cũ nên không khoá bảng lâu.
ALTER TABLE "storage_files"
  ADD COLUMN "thumbnail_object_key" VARCHAR(1024),
  ADD COLUMN "thumbnail_url" VARCHAR(2048),
  ADD COLUMN "source_url_hash" CHAR(64);

-- Mỗi tổ chức một file cho một URL nguồn (file đã xoá mềm không tính). Index một phần chỉ trên các dòng có giá trị.
CREATE UNIQUE INDEX "storage_files_organization_id_source_url_hash_key"
  ON "storage_files" ("organization_id", "source_url_hash")
  WHERE "source_url_hash" IS NOT NULL AND "deleted_at" IS NULL;
