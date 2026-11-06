-- Hoàn tác thủ công migration 20261106090000. Object thumbnail đã tạo trên kho cần dọn riêng.
DROP INDEX IF EXISTS "storage_files_organization_id_source_url_hash_key";
ALTER TABLE "storage_files"
  DROP COLUMN IF EXISTS "thumbnail_object_key",
  DROP COLUMN IF EXISTS "thumbnail_url",
  DROP COLUMN IF EXISTS "source_url_hash";
