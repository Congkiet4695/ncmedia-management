-- ============================================================================
-- GLOBAL TIKTOK MASTER DATA
--
-- Danh mục / Thương hiệu / Thuộc tính danh mục của TikTok chuyển từ mô hình
-- "một bản sao cho mỗi shop" sang **dữ liệu master toàn cục**: bỏ organization_id
-- và shop_id, khoá tự nhiên thành (provider, provider_id).
--
-- 🔴 Migration này KHÔNG được làm mất tham chiếu. Trước khi xoá bản sao thừa nó
-- gộp mọi bản sao của cùng một id TikTok về MỘT bản ghi sống sót rồi trỏ lại
-- pod_products.category_id / brand_id và pod_category_attributes.category_id vào
-- bản ghi đó. Thứ tự các bước là bắt buộc: dedupe thuộc tính TRƯỚC khi remap
-- category_id, nếu không thì phép cập nhật đâm vào unique (category_id,
-- tiktok_attribute_id) đang có.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Enum provider
-- ---------------------------------------------------------------------------
CREATE TYPE "pod_master_data_provider" AS ENUM ('TIKTOK');

-- ---------------------------------------------------------------------------
-- 1) DANH MỤC — chọn bản ghi sống sót + gộp tham chiếu
--
-- Ưu tiên: bản ghi CHƯA xoá mềm → tạo sớm nhất → id nhỏ nhất (tie-break tất định).
-- ---------------------------------------------------------------------------
ALTER TABLE "pod_product_categories"
  ADD COLUMN "provider" "pod_master_data_provider" NOT NULL DEFAULT 'TIKTOK';

CREATE TEMP TABLE "_category_survivor" AS
SELECT c."id" AS old_id, s."id" AS new_id
FROM "pod_product_categories" c
JOIN (
  SELECT DISTINCT ON ("tiktok_category_id") "tiktok_category_id", "id"
  FROM "pod_product_categories"
  ORDER BY "tiktok_category_id", ("deleted_at" IS NULL) DESC, "created_at" ASC, "id" ASC
) s ON s."tiktok_category_id" = c."tiktok_category_id";

CREATE INDEX ON "_category_survivor" (old_id);

-- 1a) Gộp THUỘC TÍNH trước: sau khi remap, nhiều bản sao cùng trỏ về một danh mục
--     ⇒ trùng (category_id, tiktok_attribute_id). Giữ bản đồng bộ gần nhất.
DELETE FROM "pod_category_attributes" a
USING (
  SELECT x."id",
         ROW_NUMBER() OVER (
           PARTITION BY m.new_id, x."tiktok_attribute_id"
           ORDER BY x."synced_at" DESC, x."id" ASC
         ) AS rn
  FROM "pod_category_attributes" x
  JOIN "_category_survivor" m ON m.old_id = x."category_id"
) d
WHERE a."id" = d."id" AND d.rn > 1;

UPDATE "pod_category_attributes" a
SET "category_id" = m.new_id
FROM "_category_survivor" m
WHERE a."category_id" = m.old_id AND a."category_id" <> m.new_id;

-- 1b) Sản phẩm trỏ lại danh mục sống sót.
UPDATE "pod_products" p
SET "category_id" = m.new_id
FROM "_category_survivor" m
WHERE p."category_id" = m.old_id AND p."category_id" <> m.new_id;

-- 1c) Xoá bản sao thừa (chỉ những bản KHÔNG phải bản sống sót).
DELETE FROM "pod_product_categories" c
USING "_category_survivor" m
WHERE c."id" = m.old_id AND m.old_id <> m.new_id;

-- 1d) Bỏ cột theo-tenant. PostgreSQL tự xoá kèm mọi index/constraint phụ thuộc
--     (unique (shop_id, tiktok_category_id), index organization_id, FK tới shop).
--
--     `permission_statuses` là dữ liệu THEO SELLER ("shop này có được bán ở danh mục
--     này không") nên không thể sống trong bảng dùng chung. Không có mã nguồn nào đọc
--     nó — xem báo cáo sprint §7.
ALTER TABLE "pod_product_categories"
  DROP COLUMN "organization_id",
  DROP COLUMN "shop_id",
  DROP COLUMN "permission_statuses";

DROP TABLE "_category_survivor";

CREATE UNIQUE INDEX "pod_product_categories_provider_tiktok_category_id_key"
  ON "pod_product_categories" ("provider", "tiktok_category_id");
CREATE INDEX "pod_product_categories_provider_is_leaf_idx"
  ON "pod_product_categories" ("provider", "is_leaf");

-- ---------------------------------------------------------------------------
-- 2) THUỘC TÍNH DANH MỤC — bỏ organization_id
-- ---------------------------------------------------------------------------
ALTER TABLE "pod_category_attributes" DROP COLUMN "organization_id";

CREATE INDEX "pod_category_attributes_tiktok_attribute_id_idx"
  ON "pod_category_attributes" ("tiktok_attribute_id");

-- ---------------------------------------------------------------------------
-- 3) THƯƠNG HIỆU — cùng khuôn với danh mục
--
-- Ưu tiên bản ghi CHƯA xoá mềm → bản THẬT của TikTok (is_system = false) trước bản
-- do hệ thống tự tạo → tạo sớm nhất. Bản do TikTok trả về mang đủ tên và trạng thái.
-- ---------------------------------------------------------------------------
ALTER TABLE "pod_product_brands"
  ADD COLUMN "provider" "pod_master_data_provider" NOT NULL DEFAULT 'TIKTOK';

CREATE TEMP TABLE "_brand_survivor" AS
SELECT b."id" AS old_id, s."id" AS new_id
FROM "pod_product_brands" b
JOIN (
  SELECT DISTINCT ON ("tiktok_brand_id") "tiktok_brand_id", "id"
  FROM "pod_product_brands"
  ORDER BY "tiktok_brand_id", ("deleted_at" IS NULL) DESC, "is_system" ASC, "created_at" ASC, "id" ASC
) s ON s."tiktok_brand_id" = b."tiktok_brand_id";

CREATE INDEX ON "_brand_survivor" (old_id);

UPDATE "pod_products" p
SET "brand_id" = m.new_id
FROM "_brand_survivor" m
WHERE p."brand_id" = m.old_id AND p."brand_id" <> m.new_id;

DELETE FROM "pod_product_brands" b
USING "_brand_survivor" m
WHERE b."id" = m.old_id AND m.old_id <> m.new_id;

ALTER TABLE "pod_product_brands"
  DROP COLUMN "organization_id",
  DROP COLUMN "shop_id";

DROP TABLE "_brand_survivor";

CREATE UNIQUE INDEX "pod_product_brands_provider_tiktok_brand_id_key"
  ON "pod_product_brands" ("provider", "tiktok_brand_id");
CREATE INDEX "pod_product_brands_provider_is_no_brand_idx"
  ON "pod_product_brands" ("provider", "is_no_brand");

-- ---------------------------------------------------------------------------
-- 4) Metadata + nhật ký của lượt đồng bộ TOÀN CỤC (Super Admin)
--
-- Tách khỏi `pod_resource_syncs` (khoá theo organization_id — vẫn dùng cho WAREHOUSE,
-- thứ thật sự thuộc về từng shop).
-- ---------------------------------------------------------------------------
CREATE TABLE "pod_master_data_syncs" (
    "id" UUID NOT NULL,
    "provider" "pod_master_data_provider" NOT NULL DEFAULT 'TIKTOK',
    "resource" "pod_resource_type" NOT NULL,
    "status" "pod_resource_sync_status" NOT NULL DEFAULT 'IDLE',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "last_error" VARCHAR(2000),
    "job_id" UUID,
    "source_shop_id" UUID,
    "last_run_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_master_data_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pod_master_data_syncs_provider_resource_key"
  ON "pod_master_data_syncs" ("provider", "resource");

CREATE TABLE "pod_master_data_sync_logs" (
    "id" UUID NOT NULL,
    "provider" "pod_master_data_provider" NOT NULL DEFAULT 'TIKTOK',
    "resource" "pod_resource_type" NOT NULL,
    "job_id" UUID NOT NULL,
    "status" "pod_resource_sync_status" NOT NULL,
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(2000),
    "source_shop_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_master_data_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pod_master_data_sync_logs_provider_resource_started_at_idx"
  ON "pod_master_data_sync_logs" ("provider", "resource", "started_at");
CREATE INDEX "pod_master_data_sync_logs_job_id_idx"
  ON "pod_master_data_sync_logs" ("job_id");

-- ---------------------------------------------------------------------------
-- 5) Dọn trạng thái đồng bộ CŨ theo tổ chức cho ba tài nguyên vừa chuyển toàn cục.
--
-- Để lại thì màn hình Resources của mỗi Organization vẫn khoe "Categories — SUCCESS,
-- 11.892 bản ghi, đồng bộ lúc …" như thể tổ chức đó vẫn còn phải tự sync. Nhật ký
-- (`pod_resource_sync_logs`) được GIỮ NGUYÊN: nó là lịch sử vận hành có thật.
-- ---------------------------------------------------------------------------
DELETE FROM "pod_resource_syncs"
WHERE "resource" IN ('CATEGORY', 'BRAND', 'CATEGORY_ATTRIBUTE');
