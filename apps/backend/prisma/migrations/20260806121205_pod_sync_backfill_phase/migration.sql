-- CreateEnum
CREATE TYPE "pod_sync_phase" AS ENUM ('BACKFILL', 'INCREMENTAL');

-- AlterTable
ALTER TABLE "pod_sync_logs" ADD COLUMN     "phase" "pod_sync_phase" NOT NULL DEFAULT 'INCREMENTAL',
ADD COLUMN     "tiktok_total_count" INTEGER;

-- AlterTable
ALTER TABLE "pod_tiktok_shops" ADD COLUMN     "backfill_cursor" BIGINT;

-- ---------------------------------------------------------------------------
-- Data migration — BẮT BUỘC.
--
-- Trước bản vá này, `advanceSyncCursor` đặt `backfill_done = true` ngay sau lát
-- cửa sổ ĐẦU TIÊN, trong khi hệ thống chỉ quét theo `update_time` từ mốc
-- (now − 30 ngày). Hệ quả: mọi đơn có `update_time` cũ hơn 30 ngày KHÔNG BAO GIỜ
-- được kéo về (đo thực tế: DB 55 / TikTok 143 đơn).
--
-- Vì vậy cờ `backfill_done` hiện có KHÔNG đáng tin: đặt lại toàn bộ về FALSE để
-- mọi shop chạy lại pha BACKFILL theo `create_time` và lấy đủ lịch sử.
-- An toàn: ingest là idempotent (UNIQUE organization_id + tiktok_order_id), đơn đã
-- có sẽ vào nhánh SKIP/UPDATE chứ không tạo bản ghi trùng.
--
-- KHÔNG đụng tới `last_order_sync_cursor`: watermark `update_time` vẫn đúng và
-- chỉ được phép tiến, không lùi.
-- ---------------------------------------------------------------------------
UPDATE "pod_tiktok_shops" SET "backfill_done" = false WHERE "deleted_at" IS NULL;
