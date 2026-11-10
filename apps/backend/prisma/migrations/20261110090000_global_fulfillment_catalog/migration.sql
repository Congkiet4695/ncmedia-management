-- Global Fulfillment Catalog — Phase 1 (schema). CHỈ THÊM MỚI: không DROP, không ALTER bảng cũ, không
-- DELETE/UPDATE dữ liệu.
--
-- Tách danh mục nhà cung cấp thành hai lớp, song song với ba bảng cũ (fulfillment_catalogues /
-- fulfillment_products / fulfillment_variants — vẫn được ghi và vẫn phục vụ luồng gửi đơn):
--
--   provider_catalog_{catalogues,products,variants}  GLOBAL, khoá (provider, external_*_id).
--                                                    Không organization_id / account_id / giá.
--   fulfillment_account_{catalogues,products,variants} THEO TÀI KHOẢN, khoá (account_id, global_*_id):
--                                                    giá, đơn vị tiền, trạng thái, tier, raw đầy đủ.
--
-- Giá KHÔNG ở lớp global: Base Cost của ánh xạ phải là giá của ĐÚNG tài khoản (Mango định giá theo
-- tier của API key). id của dòng THEO TÀI KHOẢN = id của dòng cũ tương ứng ⇒ id giao diện thấy không đổi.
--
-- Dữ liệu được điền bởi:
--   - dual write sau mỗi lượt đồng bộ danh mục (FulfillmentGlobalCatalogRepository.projectAccount);
--   - backfill: scripts/backfill-global-catalog.ts (dry-run mặc định, --apply để ghi).
-- Đọc từ lớp mới chỉ khi GLOBAL_FULFILLMENT_CATALOG_ENABLED=true (mặc định false).
--
-- Rollback: đặt GLOBAL_FULFILLMENT_CATALOG_ENABLED=false (đọc lại bảng cũ). Bảng mới có thể giữ lại
-- hoặc DROP sáu bảng dưới — không bảng cũ nào phụ thuộc vào chúng.

-- CreateTable
CREATE TABLE "provider_catalog_catalogues" (
    "id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "external_catalogue_id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "raw_data" JSONB,
    "source_account_id" UUID,
    "source_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_catalog_catalogues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_catalog_products" (
    "id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "catalogue_id" UUID,
    "external_product_id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(1000) NOT NULL,
    "sku" VARCHAR(255),
    "image" VARCHAR(2048),
    "raw_data" JSONB,
    "source_account_id" UUID,
    "source_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_catalog_variants" (
    "id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "product_id" UUID NOT NULL,
    "external_variant_id" VARCHAR(128) NOT NULL,
    "sku" VARCHAR(255) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "color" VARCHAR(100),
    "size" VARCHAR(100),
    "raw_data" JSONB,
    "source_account_id" UUID,
    "source_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_catalog_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_account_catalogues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "global_catalogue_id" UUID NOT NULL,
    "status" "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fulfillment_account_catalogues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_account_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "global_product_id" UUID NOT NULL,
    "catalogue_id" UUID,
    "base_price" VARCHAR(64),
    "currency" VARCHAR(10),
    "variations_count" INTEGER,
    "status" "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
    "raw_data" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fulfillment_account_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_account_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "account_product_id" UUID NOT NULL,
    "global_variant_id" UUID NOT NULL,
    "price" VARCHAR(64),
    "currency" VARCHAR(10),
    "tier" VARCHAR(64),
    "status" "fulfillment_catalog_item_status" NOT NULL DEFAULT 'ACTIVE',
    "raw_data" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fulfillment_account_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_catalog_catalogues_provider_external_catalogue_id_key" ON "provider_catalog_catalogues"("provider", "external_catalogue_id");

-- CreateIndex
CREATE INDEX "provider_catalog_products_catalogue_id_idx" ON "provider_catalog_products"("catalogue_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_catalog_products_provider_external_product_id_key" ON "provider_catalog_products"("provider", "external_product_id");

-- CreateIndex
CREATE INDEX "provider_catalog_variants_product_id_idx" ON "provider_catalog_variants"("product_id");

-- CreateIndex
CREATE INDEX "provider_catalog_variants_provider_sku_idx" ON "provider_catalog_variants"("provider", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "provider_catalog_variants_provider_external_variant_id_key" ON "provider_catalog_variants"("provider", "external_variant_id");

-- CreateIndex
CREATE INDEX "fulfillment_account_catalogues_account_id_status_idx" ON "fulfillment_account_catalogues"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_account_catalogues_account_id_global_catalogue__key" ON "fulfillment_account_catalogues"("account_id", "global_catalogue_id");

-- CreateIndex
CREATE INDEX "fulfillment_account_products_account_id_status_idx" ON "fulfillment_account_products"("account_id", "status");

-- CreateIndex
CREATE INDEX "fulfillment_account_products_catalogue_id_idx" ON "fulfillment_account_products"("catalogue_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_account_products_account_id_global_product_id_key" ON "fulfillment_account_products"("account_id", "global_product_id");

-- CreateIndex
CREATE INDEX "fulfillment_account_variants_account_product_id_status_idx" ON "fulfillment_account_variants"("account_product_id", "status");

-- CreateIndex
CREATE INDEX "fulfillment_account_variants_account_id_status_idx" ON "fulfillment_account_variants"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_account_variants_account_id_global_variant_id_key" ON "fulfillment_account_variants"("account_id", "global_variant_id");

-- AddForeignKey
ALTER TABLE "provider_catalog_products" ADD CONSTRAINT "provider_catalog_products_catalogue_id_fkey" FOREIGN KEY ("catalogue_id") REFERENCES "provider_catalog_catalogues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_catalog_variants" ADD CONSTRAINT "provider_catalog_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "provider_catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_catalogues" ADD CONSTRAINT "fulfillment_account_catalogues_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_catalogues" ADD CONSTRAINT "fulfillment_account_catalogues_global_catalogue_id_fkey" FOREIGN KEY ("global_catalogue_id") REFERENCES "provider_catalog_catalogues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_products" ADD CONSTRAINT "fulfillment_account_products_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_products" ADD CONSTRAINT "fulfillment_account_products_global_product_id_fkey" FOREIGN KEY ("global_product_id") REFERENCES "provider_catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_variants" ADD CONSTRAINT "fulfillment_account_variants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_variants" ADD CONSTRAINT "fulfillment_account_variants_account_product_id_fkey" FOREIGN KEY ("account_product_id") REFERENCES "fulfillment_account_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_account_variants" ADD CONSTRAINT "fulfillment_account_variants_global_variant_id_fkey" FOREIGN KEY ("global_variant_id") REFERENCES "provider_catalog_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

