-- Flash Sale: tiến độ của lượt publish chạy NỀN.
--
-- Bối cảnh: một đợt sale được phép chứa tới 10.000 SKU, gửi lên TikTok qua nhiều lượt gọi
-- (trần 300 mục/lượt của sàn). Request HTTP trả về ngay sau khi hoạt động khuyến mãi được
-- tạo, nên tiến độ phải nằm ở database mới có ai đọc được.
--
-- Không có bảng batch riêng: "dòng nào đã lên sàn" đã có ở pod_flash_sale_items.status.
-- Các cột dưới đây chỉ phục vụ HIỂN THỊ tiến độ và phát hiện tiến trình chết giữa chừng.

ALTER TABLE "pod_flash_sales"
  ADD COLUMN "publish_run_id"        UUID,
  ADD COLUMN "publish_total_items"   INTEGER,
  ADD COLUMN "publish_total_batches" INTEGER,
  ADD COLUMN "publish_done_batches"  INTEGER,
  ADD COLUMN "publish_current_batch" INTEGER,
  ADD COLUMN "publish_failed_batch"  INTEGER,
  ADD COLUMN "publish_started_at"    TIMESTAMPTZ(6),
  ADD COLUMN "publish_finished_at"   TIMESTAMPTZ(6),
  ADD COLUMN "publish_heartbeat_at"  TIMESTAMPTZ(6);

-- Lượt quét nhặt đợt kẹt ở PUBLISHING: lọc theo status rồi sắp theo nhịp tim.
CREATE INDEX "pod_flash_sales_status_publish_heartbeat_at_idx"
  ON "pod_flash_sales" ("status", "publish_heartbeat_at");

-- Bộ đếm tiến độ không bao giờ âm, và số lô đã xong không vượt tổng số lô.
-- Hàng rào cuối: một bug ở tầng ứng dụng không được phép để lại "35/34" trong database.
ALTER TABLE "pod_flash_sales"
  ADD CONSTRAINT "pod_flash_sales_publish_progress_check" CHECK (
    ("publish_total_items"   IS NULL OR "publish_total_items"   >= 0) AND
    ("publish_total_batches" IS NULL OR "publish_total_batches" >= 0) AND
    ("publish_done_batches"  IS NULL OR "publish_done_batches"  >= 0) AND
    ("publish_total_batches" IS NULL OR "publish_done_batches" IS NULL
      OR "publish_done_batches" <= "publish_total_batches")
  );
