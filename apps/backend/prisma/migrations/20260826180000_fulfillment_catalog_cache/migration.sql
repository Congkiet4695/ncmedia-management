-- ============================================================================
-- Bản sao danh mục nhà cung cấp + kết quả ánh xạ tự động
--
-- LÝ DO (bắt buộc giải thích khi đổi Database)
--   Trước đây màn hình Product Mapping gọi THẲNG sang Mango API mỗi lần mở: danh mục vài
--   nghìn sản phẩm, và mỗi sản phẩm là thêm một lời gọi để lấy biến thể. Hệ quả: chậm, phụ
--   thuộc mạng, timeout, và hỏng hoàn toàn khi nhà cung cấp lỗi — trong khi dữ liệu này gần
--   như tĩnh. Cache Redis 5 phút chỉ giấu độ trễ, không làm được ba việc mà tính năng thực
--   sự cần: tìm kiếm/phân trang phía server, ánh xạ TỰ ĐỘNG (phải quét toàn bộ danh mục),
--   và hoạt động được khi nhà cung cấp đang lỗi.
--
--   Kiến trúc mới:  Mango API → Sync Job → Database → UI.
--
--   `fulfillment_mapping_candidates` tồn tại vì khi hệ thống KHÔNG tự ánh xạ được thì không
--   có bản ghi Product Mapping nào để ghi trạng thái vào. Ba kết cục (đã tự ánh xạ / nhiều
--   ứng viên phải chọn tay / không tìm thấy) dẫn tới ba hành động khác nhau của người vận
--   hành nên phải phân biệt được.
--
-- CAM KẾT
--   OK Chỉ THÊM MỚI — không sửa, không xoá bảng/cột nào đang có.
--   OK Không mất dữ liệu — không đụng tới bất kỳ bảng nghiệp vụ nào hiện hữu.
--   OK Có rollback — xem rollback.sql cùng thư mục (drop sạch những gì file này tạo ra).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "fulfillment_catalog_item_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "fulfillment_auto_map_status" AS ENUM ('AUTO_MAPPED', 'NEED_MANUAL', 'NOT_FOUND', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "fulfillment_auto_map_tier" AS ENUM ('SELLER_SKU', 'PRODUCT_TITLE', 'VARIANT', 'CATALOGUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Catalogue
--
-- Mango KHÔNG có endpoint /catalogs (đã dò thực tế: HTTP 404). Danh mục được suy ra từ cặp
-- catalog_id / catalog_name gắn trên mỗi sản phẩm, nên `raw_data` cho phép NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE "fulfillment_catalogues" (
  "id"                    UUID NOT NULL,
  "organization_id"       UUID NOT NULL,
  "account_id"            UUID NOT NULL,
  "provider"              "fulfillment_provider" NOT NULL,
  "external_catalogue_id" VARCHAR(128) NOT NULL,
  "name"                  VARCHAR(500) NOT NULL,
  "status"                "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
  "raw_data"              JSONB,
  "synced_at"             TIMESTAMPTZ(6) NOT NULL,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"            TIMESTAMPTZ(6),

  CONSTRAINT "fulfillment_catalogues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fulfillment_catalogues_account_id_external_catalogue_id_key"
  ON "fulfillment_catalogues" ("account_id", "external_catalogue_id");
CREATE INDEX "fulfillment_catalogues_organization_id_provider_idx"
  ON "fulfillment_catalogues" ("organization_id", "provider");
CREATE INDEX "fulfillment_catalogues_account_id_status_idx"
  ON "fulfillment_catalogues" ("account_id", "status");

ALTER TABLE "fulfillment_catalogues"
  ADD CONSTRAINT "fulfillment_catalogues_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Product
-- ---------------------------------------------------------------------------
CREATE TABLE "fulfillment_products" (
  "id"                  UUID NOT NULL,
  "organization_id"     UUID NOT NULL,
  "account_id"          UUID NOT NULL,
  "provider"            "fulfillment_provider" NOT NULL,
  "catalogue_id"        UUID,
  "external_product_id" VARCHAR(128) NOT NULL,
  "name"                VARCHAR(1000) NOT NULL,
  "sku"                 VARCHAR(255),
  "image"               VARCHAR(2048),
  "base_price"          VARCHAR(64),
  "currency"            VARCHAR(10),
  "variations_count"    INTEGER,
  "status"              "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
  "raw_data"            JSONB,
  "synced_at"           TIMESTAMPTZ(6) NOT NULL,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"          TIMESTAMPTZ(6),

  CONSTRAINT "fulfillment_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fulfillment_products_account_id_external_product_id_key"
  ON "fulfillment_products" ("account_id", "external_product_id");
CREATE INDEX "fulfillment_products_organization_id_provider_idx"
  ON "fulfillment_products" ("organization_id", "provider");
CREATE INDEX "fulfillment_products_account_id_status_idx"
  ON "fulfillment_products" ("account_id", "status");
CREATE INDEX "fulfillment_products_catalogue_id_idx"
  ON "fulfillment_products" ("catalogue_id");
-- Ánh xạ tự động tầng 1 tra theo SKU sản phẩm.
CREATE INDEX "fulfillment_products_account_id_sku_idx"
  ON "fulfillment_products" ("account_id", "sku");

ALTER TABLE "fulfillment_products"
  ADD CONSTRAINT "fulfillment_products_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fulfillment_products"
  ADD CONSTRAINT "fulfillment_products_catalogue_id_fkey"
  FOREIGN KEY ("catalogue_id") REFERENCES "fulfillment_catalogues"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Variant
-- ---------------------------------------------------------------------------
CREATE TABLE "fulfillment_variants" (
  "id"                  UUID NOT NULL,
  "organization_id"     UUID NOT NULL,
  "account_id"          UUID NOT NULL,
  "provider"            "fulfillment_provider" NOT NULL,
  "product_id"          UUID NOT NULL,
  "external_variant_id" VARCHAR(128) NOT NULL,
  "sku"                 VARCHAR(255) NOT NULL,
  "name"                VARCHAR(500) NOT NULL,
  "color"               VARCHAR(100),
  "size"                VARCHAR(100),
  "price"               VARCHAR(64),
  "status"              "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
  "raw_data"            JSONB,
  "synced_at"           TIMESTAMPTZ(6) NOT NULL,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"          TIMESTAMPTZ(6),

  CONSTRAINT "fulfillment_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fulfillment_variants_product_id_external_variant_id_key"
  ON "fulfillment_variants" ("product_id", "external_variant_id");
CREATE INDEX "fulfillment_variants_organization_id_provider_idx"
  ON "fulfillment_variants" ("organization_id", "provider");
CREATE INDEX "fulfillment_variants_product_id_status_idx"
  ON "fulfillment_variants" ("product_id", "status");
-- 🔴 Chỉ mục CHÍNH của ánh xạ tự động: tra Seller SKU của TikTok trên SKU biến thể.
CREATE INDEX "fulfillment_variants_account_id_sku_idx"
  ON "fulfillment_variants" ("account_id", "sku");

ALTER TABLE "fulfillment_variants"
  ADD CONSTRAINT "fulfillment_variants_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "fulfillment_products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Kết quả ánh xạ tự động
-- ---------------------------------------------------------------------------
CREATE TABLE "fulfillment_mapping_candidates" (
  "id"                UUID NOT NULL,
  "organization_id"   UUID NOT NULL,
  "account_id"        UUID NOT NULL,
  "tiktok_product_id" VARCHAR(64) NOT NULL,
  "seller_sku"        VARCHAR(255) NOT NULL,
  "status"            "fulfillment_auto_map_status" NOT NULL,
  "tier"              "fulfillment_auto_map_tier",
  "candidate_count"   INTEGER NOT NULL DEFAULT 0,
  "candidates"        JSONB,
  "mapping_id"        UUID,
  "resolved_at"       TIMESTAMPTZ(6) NOT NULL,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "fulfillment_mapping_candidates_pkey" PRIMARY KEY ("id")
);

-- Mỗi cặp khoá chỉ giữ KẾT QUẢ GẦN NHẤT — không tích luỹ lịch sử rà soát.
CREATE UNIQUE INDEX "fulfillment_mapping_candidates_org_product_sku_key"
  ON "fulfillment_mapping_candidates" ("organization_id", "tiktok_product_id", "seller_sku");
CREATE INDEX "fulfillment_mapping_candidates_organization_id_status_idx"
  ON "fulfillment_mapping_candidates" ("organization_id", "status");
CREATE INDEX "fulfillment_mapping_candidates_account_id_idx"
  ON "fulfillment_mapping_candidates" ("account_id");

ALTER TABLE "fulfillment_mapping_candidates"
  ADD CONSTRAINT "fulfillment_mapping_candidates_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
