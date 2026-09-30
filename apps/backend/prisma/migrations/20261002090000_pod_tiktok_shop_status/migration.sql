-- Trạng thái của TỪNG shop phía TikTok — do Shop Sync ghi (POST /pod/tiktok/accounts/sync-shops).
--
-- Vì sao cần cột riêng thay vì dùng `pod_tiktok_accounts.status`: một kết nối (authorization)
-- còn sống vẫn có thể chứa shop đã ngừng hoạt động. Product Sync đọc cột này để BỎ QUA shop
-- không còn ACTIVE thay vì gọi Product API rồi hỏng cả lượt.
--
-- Additive, không xoá dữ liệu. Mặc định ACTIVE giữ nguyên hành vi hiện tại cho các shop đã có
-- (trước đây mọi shop đều được coi là đang hoạt động); `status_checked_at = NULL` cho biết shop
-- đó CHƯA từng được đối chiếu với TikTok — lượt Shop Sync đầu tiên sẽ ghi trạng thái thật.

CREATE TYPE "pod_tiktok_shop_status" AS ENUM ('ACTIVE', 'INACTIVE', 'DEAUTHORIZED');

ALTER TABLE "pod_tiktok_shops"
  ADD COLUMN "status" "pod_tiktok_shop_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_status_error_code" VARCHAR(20),
  ADD COLUMN "last_status_error_message" VARCHAR(500);

CREATE INDEX "pod_tiktok_shops_organization_id_status_idx"
  ON "pod_tiktok_shops"("organization_id", "status");
