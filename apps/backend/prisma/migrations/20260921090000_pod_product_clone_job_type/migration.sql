-- Nhân bản sản phẩm sang nhiều shop (Products → Nhân bản sản phẩm).
--
-- Thuần bổ sung: thêm một giá trị enum cho loại lượt chạy của Bulk Listing Engine. Lượt CLONE
-- dùng lại nguyên bảng pod_listing_jobs / pod_listing_job_items / pod_listing_logs /
-- pod_listing_payloads — KHÔNG có bảng mới: mỗi item = (sản phẩm nguồn × shop đích), payload
-- được giải từ chính sản phẩm (listing_template_id = NULL), kết quả từng shop nằm ở item.
ALTER TYPE "pod_listing_job_type" ADD VALUE 'CLONE';
