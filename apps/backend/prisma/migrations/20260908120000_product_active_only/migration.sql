-- ============================================================================
-- PRODUCT SYNC — chỉ quản lý sản phẩm ĐANG BÁN (status = ACTIVATE)
--
-- Nghiệp vụ mới: hệ thống chỉ đồng bộ và quản lý Product đang ACTIVE/LIVE trên TikTok Shop.
-- Trước sprint này, mọi trạng thái đều được kéo về và lưu — trên database hiện tại là
-- 601/734 sản phẩm DELETED, 22 DRAFT, 6 FREEZE, chỉ 105 thật sự đang bán.
--
-- 🔴 `ACTIVATE` (không phải `ACTIVE`) là giá trị TikTok dùng. Nguồn: `status` trong
-- `Product202502SearchProductsRequestBody` của SDK — "Possible values: ALL, DRAFT, PENDING,
-- FAILED, ACTIVATE, SELLER_DEACTIVATED, PLATFORM_DEACTIVATED, FREEZE, DELETED" — và khớp
-- với dữ liệu thật đang có trong bảng `pod_products`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Đánh dấu "không còn bán" — KHÔNG xoá
--
-- Vì sao cột riêng thay vì sửa `status`: hệ thống nay chỉ kéo về sản phẩm ACTIVATE, nên khi
-- một sản phẩm rời khỏi trạng thái đó nó chỉ BIẾN MẤT khỏi kết quả. Ta biết "không còn
-- active" nhưng KHÔNG biết nó chuyển sang trạng thái nào — ghi đè `status` bằng một giá trị
-- đoán mò là bịa dữ liệu của sàn.
--
-- KHÔNG xoá cứng: `pod_product_mappings`, Draft Listing và đơn hàng cũ còn tham chiếu.
-- ---------------------------------------------------------------------------
ALTER TABLE "pod_products" ADD COLUMN "deactivated_at" TIMESTAMPTZ(6);

-- Backfill: mọi sản phẩm đang KHÔNG ở trạng thái ACTIVATE đều là "không còn bán".
-- Dùng `updated_at` làm mốc phát hiện — đó là lần cuối hệ thống thấy bản ghi này từ TikTok,
-- trung thực hơn `now()` (vốn nói dối rằng ta vừa mới phát hiện ra).
UPDATE "pod_products"
SET "deactivated_at" = "updated_at"
WHERE "status" IS DISTINCT FROM 'ACTIVATE' AND "deleted_at" IS NULL;

-- Truy vấn mặc định của màn hình Products: "sản phẩm ĐANG BÁN của tổ chức này".
CREATE INDEX "pod_products_organization_id_status_deactivated_at_idx"
  ON "pod_products" ("organization_id", "status", "deactivated_at");

-- ---------------------------------------------------------------------------
-- 2) Sync History — đếm thêm số sản phẩm bị đánh dấu ngừng bán trong lượt
-- ---------------------------------------------------------------------------
ALTER TABLE "pod_product_sync_histories"
  ADD COLUMN "products_deactivated" INTEGER NOT NULL DEFAULT 0;
