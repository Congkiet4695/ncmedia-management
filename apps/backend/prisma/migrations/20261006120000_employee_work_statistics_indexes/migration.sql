-- Thống kê công việc nhân viên — chỉ THÊM index (không đổi dữ liệu / cột).
-- Kiểm trước: không có index trùng cột trên pod_listing_job_items (hiện có: (organization_id, status),
-- (job_id, status), (status, next_attempt_at) và hai UNIQUE theo job).

-- Listing hoàn tất trong khoảng ngày của một tổ chức.
CREATE INDEX "pod_listing_job_items_organization_id_finished_at_idx"
  ON "pod_listing_job_items"("organization_id", "finished_at");

-- "Lần listing thành công ĐẦU TIÊN" của (shop, sản phẩm TikTok) — NOT EXISTS chống đếm trùng retry / chạy lại.
CREATE INDEX "pod_listing_job_items_shop_id_remote_product_id_idx"
  ON "pod_listing_job_items"("shop_id", "remote_product_id");
