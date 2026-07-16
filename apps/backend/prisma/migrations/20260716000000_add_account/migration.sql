-- ============================================================================
-- NCMedia Management Platform — Migration: Account (ShopAccount) module
-- Target: PostgreSQL 16 · Nguồn: docs/account.md (ACCEPTED)
-- Platform (Global) + Account (tenant-scoped) + AccountCredential (secret mã hoá) + audit log.
-- ============================================================================

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('NEW', 'LIVE', 'DIE_TRANG', 'DIE', 'RETURNED');

-- CreateTable: platforms (Global — ADR-011, không organization_id)
CREATE TABLE "platforms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable: accounts (tenant-scoped, soft delete, audit)
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "id_normalize" VARCHAR(120),
    "platform_id" UUID,
    "login_tool" VARCHAR(100),
    "seller_user_id" UUID,
    "status" "account_status" NOT NULL DEFAULT 'NEW',
    "issued_at" DATE,
    "activated_at" DATE,
    "died_blank_at" DATE,
    "died_at" DATE,
    "money_returned_at" DATE,
    "die_reason" TEXT,
    "proxy" VARCHAR(255),
    "docs_url" VARCHAR(1024),
    "note" TEXT,
    "note2" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: account_credentials (1-1, secret mã hoá at-rest)
CREATE TABLE "account_credentials" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "inf" TEXT,
    "ssn" TEXT,
    "phone_reg" TEXT,
    "gmail" TEXT,
    "gmail_password" TEXT,
    "recovery_mail" TEXT,
    "recovery_mail_2fa" TEXT,
    "platform_password" TEXT,
    "platform_2fa_secret" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: account_credential_access_logs (audit reveal — BR-A12)
CREATE TABLE "account_credential_access_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "accessed_by" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_credential_access_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "platforms_code_key" ON "platforms"("code");
CREATE UNIQUE INDEX "accounts_organization_id_id_normalize_key" ON "accounts"("organization_id", "id_normalize");
CREATE INDEX "accounts_organization_id_idx" ON "accounts"("organization_id");
CREATE INDEX "accounts_platform_id_idx" ON "accounts"("platform_id");
CREATE INDEX "accounts_seller_user_id_idx" ON "accounts"("seller_user_id");
CREATE INDEX "accounts_status_idx" ON "accounts"("status");
CREATE UNIQUE INDEX "account_credentials_account_id_key" ON "account_credentials"("account_id");
CREATE INDEX "account_credential_access_logs_account_id_idx" ON "account_credential_access_logs"("account_id");
CREATE INDEX "account_credential_access_logs_organization_id_idx" ON "account_credential_access_logs"("organization_id");

-- Foreign keys
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_credential_access_logs" ADD CONSTRAINT "account_credential_access_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
