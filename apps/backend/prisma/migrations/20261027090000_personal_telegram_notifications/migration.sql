-- Kênh Telegram CÁ NHÂN (Employee tự cấu hình) — chỉ nhận đơn thuộc shop đang được gán cho người đó.
--
-- Không đổi / không xoá dữ liệu cũ: mọi dòng hiện có nhận owner_key / recipient_key = 'ORGANIZATION'
-- (đúng nghĩa cũ: kênh của tổ chức). Chỉ THÊM cột + đổi khoá UNIQUE sang (…, owner_key).
--
-- 🔴 Thứ tự: tạo UNIQUE mới TRƯỚC rồi mới bỏ UNIQUE cũ ⇒ không có lúc nào outbox mất khoá chống trùng
-- (instance cũ còn chạy trong lúc deploy vẫn ghi ON CONFLICT DO NOTHING an toàn).

-- 1) Cột mới (DEFAULT ⇒ dòng cũ = kênh tổ chức).
ALTER TABLE "organization_telegram_configs"
  ADD COLUMN "owner_key" VARCHAR(64) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "user_id" UUID;

ALTER TABLE "organization_notification_preferences"
  ADD COLUMN "owner_key" VARCHAR(64) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "user_id" UUID;

ALTER TABLE "notification_events"
  ADD COLUMN "recipient_key" VARCHAR(64) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "recipient_user_id" UUID,
  ADD COLUMN "account_id" UUID,
  ADD COLUMN "shop_id" UUID;

-- 2) owner_key / recipient_key luôn khớp user_id: 'ORGANIZATION' ⇔ không có user; ngược lại = id user.
ALTER TABLE "organization_telegram_configs"
  ADD CONSTRAINT "organization_telegram_configs_owner_key_check"
  CHECK (("user_id" IS NULL AND "owner_key" = 'ORGANIZATION') OR ("user_id" IS NOT NULL AND "owner_key" = "user_id"::text));

ALTER TABLE "organization_notification_preferences"
  ADD CONSTRAINT "organization_notification_preferences_owner_key_check"
  CHECK (("user_id" IS NULL AND "owner_key" = 'ORGANIZATION') OR ("user_id" IS NOT NULL AND "owner_key" = "user_id"::text));

ALTER TABLE "notification_events"
  ADD CONSTRAINT "notification_events_recipient_key_check"
  CHECK (("recipient_user_id" IS NULL AND "recipient_key" = 'ORGANIZATION') OR ("recipient_user_id" IS NOT NULL AND "recipient_key" = "recipient_user_id"::text));

-- 3) Khoá UNIQUE mới (tạo trước), rồi bỏ khoá cũ.
CREATE UNIQUE INDEX "organization_telegram_configs_owner_key" ON "organization_telegram_configs"("organization_id", "owner_key");
CREATE UNIQUE INDEX "organization_notification_preferences_owner_key" ON "organization_notification_preferences"("organization_id", "owner_key");

-- Tên index cũ được dùng lại cho khoá mới ⇒ tạo khoá mới dưới tên tạm, bỏ khoá cũ, rồi đổi tên.
CREATE UNIQUE INDEX "notification_events_idempotency_key_v2" ON "notification_events"("organization_id", "event_type", "entity_type", "entity_id", "channel", "recipient_key");
DROP INDEX "notification_events_idempotency_key";
ALTER INDEX "notification_events_idempotency_key_v2" RENAME TO "notification_events_idempotency_key";

DROP INDEX "organization_telegram_configs_organization_id_key";
DROP INDEX "organization_notification_preferences_organization_id_key";

-- 4) Index truy vấn.
CREATE INDEX "organization_telegram_configs_organization_id_enabled_idx" ON "organization_telegram_configs"("organization_id", "enabled");
CREATE INDEX "notification_events_organization_id_recipient_key_created_a_idx" ON "notification_events"("organization_id", "recipient_key", "created_at");

-- 5) Khoá ngoại tới users (xoá cứng user ⇒ xoá kênh cá nhân; users dùng xoá mềm nên thực tế không xảy ra).
ALTER TABLE "organization_telegram_configs" ADD CONSTRAINT "organization_telegram_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_notification_preferences" ADD CONSTRAINT "organization_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
