-- Nhà cung cấp fulfillment SELLERWIX.
--
-- Nguồn: Sellerwix Public API (Postman "Sellerwix API", collection 1626796/2s93JxshF5).
-- Chi tiết: docs/fulfillment/sellerwix.md
--
-- 1. Enum: thêm giá trị SELLERWIX. Không đổi/xoá giá trị cũ.
--
-- 2. `fulfillment_accounts` — hai cột GENERIC (không mang tên Sellerwix) cho nhà cung cấp có
--    thông tin xác thực nhiều phần:
--      · `secret_enc`       bí mật THỨ HAI, mã hoá AES-256-GCM giống `api_key_enc`.
--                           Sellerwix: private key RSA (PEM) dùng ký JWT assertion RS256.
--      · `provider_config`  cấu hình KHÔNG bí mật của nhà cung cấp.
--                           Sellerwix: { "storeId", "publicKeyId" }.
--    MangoTeePrints không dùng hai cột này ⇒ NULL, hành vi cũ giữ nguyên.
--
-- 3. `fulfillment_webhook_logs` — chống xử lý TRÙNG một sự kiện webhook.
--      · `provider_event_id`  khoá sự kiện do nhà cung cấp gửi (Sellerwix: event.id + type + created_at).
--      · `provider_event_at`  thời điểm sự kiện phía nhà cung cấp — bỏ qua sự kiện CŨ tới sau.
--    UNIQUE từng phần theo (provider, provider_event_id): cùng một sự kiện gửi lại hai lần
--    thì lần thứ hai không chèn được ⇒ không xử lý lần hai. Bản ghi cũ (NULL) không bị ảnh hưởng.

-- AlterEnum
ALTER TYPE "fulfillment_provider" ADD VALUE IF NOT EXISTS 'SELLERWIX';

-- AlterTable
ALTER TABLE "fulfillment_accounts"
  ADD COLUMN "secret_enc" TEXT,
  ADD COLUMN "provider_config" JSONB;

-- AlterTable
ALTER TABLE "fulfillment_webhook_logs"
  ADD COLUMN "provider_event_id" VARCHAR(255),
  ADD COLUMN "provider_event_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_webhook_logs_provider_event_id_key"
  ON "fulfillment_webhook_logs" ("provider", "provider_event_id")
  WHERE "provider_event_id" IS NOT NULL;

-- CreateIndex — tra sự kiện mới nhất đã áp cho một đơn (chặn sự kiện cũ tới sau).
CREATE INDEX "fulfillment_webhook_logs_fulfillment_order_id_provider_event_at_idx"
  ON "fulfillment_webhook_logs" ("fulfillment_order_id", "provider_event_at");
