-- Sync History ⇒ Latest Sync Status (docs/pod-tiktok/sync-status.md).
--
-- Trước: MỖI lượt đồng bộ INSERT một dòng (pod_sync_logs cho đơn, pod_product_sync_histories cho sản phẩm,
-- kèm pod_product_sync_logs cho TỪNG sản phẩm mỗi lượt) ⇒ tăng theo (shop × nhịp cron) mãi mãi
-- (local: 6.969 dòng cho MỘT shop). Hệ thống không cần lịch sử — chỉ cần lần gần nhất.
--
-- Sau: pod_shop_sync_statuses, ĐÚNG MỘT dòng cho mỗi (organization_id, shop_id, sync_type).
--
-- Thứ tự an toàn:
--   1. Tạo bảng mới.
--   2. Chuyển bản ghi MỚI NHẤT (theo started_at, rồi created_at) của mỗi khoá từ bảng cũ sang — đây chính là
--      bước "giữ bản ghi mới nhất, bỏ bản trùng". Lượt SINGLE (làm mới MỘT sản phẩm) không phải trạng thái
--      đồng bộ của shop ⇒ không chuyển.
--   3. Kiểm số dòng = số khoá (không trùng) — sai ⇒ RAISE, cả migration rollback.
--   4. Xoá 3 bảng lịch sử (metadata vận hành, KHÔNG phải dữ liệu nghiệp vụ — đơn / sản phẩm / shop không bị đụng).
--
-- ⚠️ Lịch sử cũ (ngoài bản ghi mới nhất) bị bỏ theo yêu cầu. Rollback: rollback.sql.

CREATE TYPE "pod_shop_sync_type" AS ENUM ('ORDER', 'PRODUCT');

CREATE TABLE "pod_shop_sync_statuses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sync_type" "pod_shop_sync_type" NOT NULL,
    "run_id" UUID NOT NULL,
    "trigger" "pod_sync_trigger" NOT NULL,
    "status" "pod_sync_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(2000),
    "details" JSONB,
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_shop_sync_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pod_shop_sync_statuses_org_shop_type_key"
  ON "pod_shop_sync_statuses"("organization_id", "shop_id", "sync_type");
CREATE INDEX "pod_shop_sync_statuses_organization_id_sync_type_idx"
  ON "pod_shop_sync_statuses"("organization_id", "sync_type");
CREATE INDEX "pod_shop_sync_statuses_status_started_at_idx"
  ON "pod_shop_sync_statuses"("status", "started_at");

ALTER TABLE "pod_shop_sync_statuses"
  ADD CONSTRAINT "pod_shop_sync_statuses_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pod_shop_sync_statuses"
  ADD CONSTRAINT "pod_shop_sync_statuses_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2a. ORDER — bản ghi mới nhất của mỗi (tổ chức, shop).
INSERT INTO "pod_shop_sync_statuses" (
  "id", "organization_id", "account_id", "shop_id", "sync_type", "run_id", "trigger", "status",
  "started_at", "finished_at", "duration_ms", "total_count", "created_count", "updated_count",
  "skipped_count", "failed_count", "error_code", "error_message", "details", "triggered_by",
  "created_at", "updated_at"
)
SELECT DISTINCT ON (l."organization_id", l."shop_id")
  l."id", l."organization_id", l."account_id", l."shop_id", 'ORDER', l."id", l."trigger", l."status",
  l."started_at", l."finished_at", l."duration_ms", l."total_orders", l."created_count", l."updated_count",
  l."skipped_count", l."failed_count", l."error_code", l."error_message",
  jsonb_strip_nulls(jsonb_build_object(
    'phase', l."phase",
    'windowFrom', l."window_from"::text,
    'windowTo', l."window_to"::text,
    'pagesFetched', l."pages_fetched",
    'apiCalls', l."api_calls",
    'tiktokTotalCount', l."tiktok_total_count",
    'tiktokRequestId', l."tiktok_request_id"
  )),
  l."triggered_by", l."created_at", COALESCE(l."finished_at", l."started_at")
FROM "pod_sync_logs" l
WHERE l."shop_id" IS NOT NULL AND l."account_id" IS NOT NULL
ORDER BY l."organization_id", l."shop_id", l."started_at" DESC, l."created_at" DESC;

-- 2b. PRODUCT — bản ghi mới nhất (bỏ lượt SINGLE) của mỗi (tổ chức, shop).
INSERT INTO "pod_shop_sync_statuses" (
  "id", "organization_id", "account_id", "shop_id", "sync_type", "run_id", "trigger", "status",
  "started_at", "finished_at", "duration_ms", "total_count", "created_count", "updated_count",
  "skipped_count", "failed_count", "error_code", "error_message", "details", "triggered_by",
  "created_at", "updated_at"
)
SELECT DISTINCT ON (h."organization_id", h."shop_id")
  h."id", h."organization_id", h."account_id", h."shop_id", 'PRODUCT', h."id",
  (CASE h."trigger"::text WHEN 'SCHEDULER' THEN 'CRON' ELSE 'MANUAL' END)::"pod_sync_trigger",
  h."status"::text::"pod_sync_status",
  h."started_at", h."finished_at", h."duration_ms", h."products_fetched", h."products_created",
  h."products_updated", h."products_skipped", h."products_failed", h."error_code", h."error_message",
  jsonb_strip_nulls(jsonb_build_object(
    'scope', h."scope",
    'productsDeactivated', h."products_deactivated",
    'pagesFetched', h."pages_fetched",
    'apiCalls', h."api_calls",
    'watermarkFrom', h."watermark_from"::text,
    'watermarkTo', h."watermark_to"::text,
    'tiktokRequestId', h."tiktok_request_id"
  )),
  h."triggered_by", h."created_at", COALESCE(h."finished_at", h."started_at")
FROM "pod_product_sync_histories" h
WHERE h."shop_id" IS NOT NULL AND h."scope" <> 'SINGLE'
ORDER BY h."organization_id", h."shop_id", h."started_at" DESC, h."created_at" DESC;

-- 3. Kiểm: mỗi khoá đúng một dòng (UNIQUE đã chặn, đây là xác nhận số khoá được chuyển đủ).
DO $$
DECLARE
  expected INTEGER;
  actual INTEGER;
BEGIN
  SELECT
    (SELECT COUNT(DISTINCT ("organization_id", "shop_id")) FROM "pod_sync_logs"
      WHERE "shop_id" IS NOT NULL AND "account_id" IS NOT NULL)
    + (SELECT COUNT(DISTINCT ("organization_id", "shop_id")) FROM "pod_product_sync_histories"
      WHERE "shop_id" IS NOT NULL AND "scope" <> 'SINGLE')
  INTO expected;
  SELECT COUNT(*) INTO actual FROM "pod_shop_sync_statuses";
  IF expected <> actual THEN
    RAISE EXCEPTION 'pod_shop_sync_statuses: chuyển % dòng, mong đợi % — dừng migration', actual, expected;
  END IF;
END $$;

-- 4. Bỏ bảng lịch sử (bảng con trước).
DROP TABLE "pod_product_sync_logs";
DROP TABLE "pod_product_sync_histories";
DROP TABLE "pod_sync_logs";
