-- CreateEnum
CREATE TYPE "pod_tiktok_oauth_state_status" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "pod_tiktok_oauth_states" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" VARCHAR(128) NOT NULL,
    "region" VARCHAR(10) NOT NULL,
    "status" "pod_tiktok_oauth_state_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "result_token" VARCHAR(128),
    "account_id" UUID,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_tiktok_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_tiktok_oauth_states_organization_id_idx" ON "pod_tiktok_oauth_states"("organization_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_oauth_states_expires_at_idx" ON "pod_tiktok_oauth_states"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_oauth_states_state_key" ON "pod_tiktok_oauth_states"("state");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_oauth_states_result_token_key" ON "pod_tiktok_oauth_states"("result_token");

-- AddForeignKey
ALTER TABLE "pod_tiktok_oauth_states" ADD CONSTRAINT "pod_tiktok_oauth_states_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
