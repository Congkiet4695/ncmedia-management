-- Module Notification — Telegram theo Organization (docs/notification/README.md).
--
-- 1. organization_telegram_configs: cấu hình Bot của TỪNG tổ chức (token mã hoá AES-256-GCM,
--    UNIQUE organization_id ⇒ không dùng chung giữa tổ chức).
-- 2. notification_events: OUTBOX — thông báo cần gửi. UNIQUE (organization_id, event_type,
--    entity_type, entity_id, channel) là hàng rào idempotency: một đơn chỉ có tối đa MỘT thông báo
--    NEW ORDER dù đồng bộ chạy lại / chạy song song.
--
-- Chỉ THÊM bảng/enum mới — không đụng dữ liệu hiện có. Rollback: rollback.sql.

CREATE TYPE "notification_channel" AS ENUM ('TELEGRAM');
CREATE TYPE "notification_event_type" AS ENUM ('ORDER_CREATED', 'FULFILLMENT_SUBMITTED', 'FULFILLMENT_CANCELLED');
CREATE TYPE "notification_entity_type" AS ENUM ('POD_ORDER', 'FULFILLMENT_ORDER');
CREATE TYPE "notification_event_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "organization_telegram_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_token_enc" TEXT NOT NULL,
    "bot_token_hint" VARCHAR(8) NOT NULL,
    "bot_username" VARCHAR(64),
    "chat_id" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_delivery_ok" BOOLEAN,
    "last_delivery_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "organization_telegram_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" "notification_event_type" NOT NULL,
    "entity_type" "notification_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL DEFAULT 'TELEGRAM',
    "status" "notification_event_status" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "lock_token" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "provider_message_id" VARCHAR(64),
    "last_error_code" VARCHAR(64),
    "error_message" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_telegram_configs_organization_id_key"
  ON "organization_telegram_configs"("organization_id");

CREATE UNIQUE INDEX "notification_events_idempotency_key"
  ON "notification_events"("organization_id", "event_type", "entity_type", "entity_id", "channel");

CREATE INDEX "notification_events_status_next_attempt_at_idx"
  ON "notification_events"("status", "next_attempt_at");

CREATE INDEX "notification_events_organization_id_created_at_idx"
  ON "notification_events"("organization_id", "created_at");

ALTER TABLE "organization_telegram_configs"
  ADD CONSTRAINT "organization_telegram_configs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_events"
  ADD CONSTRAINT "notification_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Đồng bộ tên index của migration 20261002130000 với tên Prisma sinh ra (tên gốc dài hơn 63 ký tự
-- nên PostgreSQL đã tự cắt — lệch với schema, `migrate diff` báo drift). Chỉ đổi tên, không đổi cột.
ALTER INDEX IF EXISTS "pod_tiktok_unsettled_transactions_organization_id_tiktok_orde_i"
  RENAME TO "pod_tiktok_unsettled_transactions_organization_id_tiktok_or_idx";
ALTER INDEX IF EXISTS "pod_tiktok_unsettled_transactions_organization_id_tiktok_trans_"
  RENAME TO "pod_tiktok_unsettled_transactions_organization_id_tiktok_tr_key";
