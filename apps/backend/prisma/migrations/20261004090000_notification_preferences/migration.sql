-- Tuỳ chọn LOẠI thông báo theo Organization (docs/notification/README.md §Tuỳ chọn).
--
-- Một dòng / tổ chức (UNIQUE organization_id) — không có cấu hình chung toàn hệ thống. Tách khỏi
-- organization_telegram_configs để lưu được cả khi chưa cấu hình bot. Chưa có dòng ⇒ mặc định BẬT
-- cả hai loại (đúng hành vi trước khi có tuỳ chọn). Chỉ THÊM bảng mới. Rollback: rollback.sql.

CREATE TABLE "organization_notification_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "notify_new_order" BOOLEAN NOT NULL DEFAULT true,
    "notify_fulfillment" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "organization_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_notification_preferences_organization_id_key"
  ON "organization_notification_preferences"("organization_id");

ALTER TABLE "organization_notification_preferences"
  ADD CONSTRAINT "organization_notification_preferences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
