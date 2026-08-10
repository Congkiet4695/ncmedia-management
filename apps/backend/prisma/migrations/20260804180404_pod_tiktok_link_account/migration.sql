-- CreateEnum
CREATE TYPE "pod_tiktok_account_status" AS ENUM ('PENDING', 'ACTIVE', 'REAUTH_REQUIRED', 'DEAUTHORIZED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "pod_tiktok_token_action" AS ENUM ('ISSUE', 'REFRESH', 'REAUTHORIZE', 'REVOKE_LOCAL');

-- CreateTable
CREATE TABLE "pod_tiktok_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_name" VARCHAR(255) NOT NULL,
    "open_id" VARCHAR(128) NOT NULL,
    "seller_name" VARCHAR(255),
    "seller_base_region" VARCHAR(10),
    "user_type" INTEGER NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "refresh_token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "granted_scopes" JSONB,
    "status" "pod_tiktok_account_status" NOT NULL DEFAULT 'PENDING',
    "last_refreshed_at" TIMESTAMPTZ(6),
    "refresh_failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(20),
    "last_error_message" VARCHAR(500),
    "last_error_request_id" VARCHAR(64),
    "authorized_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_tiktok_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_tiktok_shops" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "tiktok_shop_id" VARCHAR(64) NOT NULL,
    "shop_cipher_enc" TEXT NOT NULL,
    "shop_code" VARCHAR(64),
    "name" VARCHAR(255) NOT NULL,
    "region" VARCHAR(10) NOT NULL,
    "seller_type" VARCHAR(20) NOT NULL,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_order_sync_cursor" BIGINT,
    "last_order_sync_at" TIMESTAMPTZ(6),
    "webhook_registered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_tiktok_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_tiktok_token_audits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "action" "pod_tiktok_token_action" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_code" VARCHAR(20),
    "tiktok_request_id" VARCHAR(64),
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "performed_by" UUID,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_tiktok_token_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_tiktok_accounts_organization_id_idx" ON "pod_tiktok_accounts"("organization_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_accounts_status_idx" ON "pod_tiktok_accounts"("status");

-- CreateIndex
CREATE INDEX "pod_tiktok_accounts_access_token_expires_at_idx" ON "pod_tiktok_accounts"("access_token_expires_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_accounts_refresh_token_expires_at_idx" ON "pod_tiktok_accounts"("refresh_token_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_accounts_organization_id_open_id_key" ON "pod_tiktok_accounts"("organization_id", "open_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_shops_organization_id_idx" ON "pod_tiktok_shops"("organization_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_shops_account_id_idx" ON "pod_tiktok_shops"("account_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_shops_tiktok_shop_id_idx" ON "pod_tiktok_shops"("tiktok_shop_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_shops_sync_enabled_idx" ON "pod_tiktok_shops"("sync_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_shops_organization_id_tiktok_shop_id_key" ON "pod_tiktok_shops"("organization_id", "tiktok_shop_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_token_audits_account_id_created_at_idx" ON "pod_tiktok_token_audits"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_token_audits_organization_id_idx" ON "pod_tiktok_token_audits"("organization_id");

-- AddForeignKey
ALTER TABLE "pod_tiktok_accounts" ADD CONSTRAINT "pod_tiktok_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_accounts" ADD CONSTRAINT "pod_tiktok_accounts_authorized_by_fkey" FOREIGN KEY ("authorized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_shops" ADD CONSTRAINT "pod_tiktok_shops_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_token_audits" ADD CONSTRAINT "pod_tiktok_token_audits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma schema không biểu diễn được — thêm thủ công)
-- ---------------------------------------------------------------------------

-- user_type: chỉ chấp nhận token của SELLER (0) hoặc Global Selling seller (4/5).
-- Nguồn: Authorization overview — user_type enumeration (TikTok Shop Partner Center).
ALTER TABLE "pod_tiktok_accounts"
  ADD CONSTRAINT "pod_tiktok_accounts_user_type_check"
  CHECK ("user_type" IN (0, 4, 5));

-- Bộ đếm lỗi refresh không âm.
ALTER TABLE "pod_tiktok_accounts"
  ADD CONSTRAINT "pod_tiktok_accounts_refresh_failure_count_check"
  CHECK ("refresh_failure_count" >= 0);

-- Tên kết nối không được rỗng/chỉ khoảng trắng.
ALTER TABLE "pod_tiktok_accounts"
  ADD CONSTRAINT "pod_tiktok_accounts_account_name_check"
  CHECK (length(btrim("account_name")) > 0);

-- seller_type theo tài liệu Get Authorized Shops: LOCAL | CROSS_BORDER.
-- Không dùng enum Postgres: TikTok có thể bổ sung giá trị mới ⇒ tránh vỡ sync.
ALTER TABLE "pod_tiktok_shops"
  ADD CONSTRAINT "pod_tiktok_shops_seller_type_check"
  CHECK ("seller_type" IN ('LOCAL', 'CROSS_BORDER'));

-- Watermark đồng bộ (Unix seconds) không âm — dự trù Sprint Sync Orders.
ALTER TABLE "pod_tiktok_shops"
  ADD CONSTRAINT "pod_tiktok_shops_last_order_sync_cursor_check"
  CHECK ("last_order_sync_cursor" IS NULL OR "last_order_sync_cursor" >= 0);
