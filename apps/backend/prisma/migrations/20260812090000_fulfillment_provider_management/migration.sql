-- Module quản lý Fulfillment Provider.
--
-- Viết tay thay vì để Prisma sinh: Prisma diễn đạt việc đổi tên giá trị enum bằng cách
-- DROP rồi CREATE lại type, làm mất dữ liệu của cột đang dùng type đó.
-- `ALTER TYPE ... RENAME VALUE` giữ nguyên mọi hàng hiện có.

-- 1. Đổi tên giá trị enum cho khớp tài liệu nhà cung cấp (MANGOTEE -> MANGO).
ALTER TYPE "fulfillment_provider" RENAME VALUE 'MANGOTEE' TO 'MANGO';

-- 2. Thêm provider tự khai báo (tích hợp riêng).
ALTER TYPE "fulfillment_provider" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- 3. Mỗi TikTok Account trỏ tới MỘT nhà cung cấp fulfillment.
--    NULL = chưa cấu hình. ON DELETE SET NULL: xoá provider KHÔNG được kéo mất kết nối TikTok,
--    chỉ làm kết nối đó quay về trạng thái "chưa cấu hình".
ALTER TABLE "pod_tiktok_accounts"
  ADD COLUMN "fulfillment_account_id" UUID;

ALTER TABLE "pod_tiktok_accounts"
  ADD CONSTRAINT "pod_tiktok_accounts_fulfillment_account_id_fkey"
  FOREIGN KEY ("fulfillment_account_id") REFERENCES "fulfillment_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pod_tiktok_accounts_fulfillment_account_id_idx"
  ON "pod_tiktok_accounts"("fulfillment_account_id");
