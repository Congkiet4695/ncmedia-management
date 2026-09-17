-- Dữ liệu NHẬP TAY cho riêng một Draft Product của lượt đăng.
--
-- Thuần bổ sung: cột nullable, không đụng dữ liệu cũ, không index (không bao giờ truy vấn
-- theo trường con — chỉ đọc/ghi trọn gói theo sản phẩm). Sản phẩm nhập từ Excel giữ NULL và
-- tiếp tục lấy toàn bộ nội dung từ template của lượt đăng như trước.
ALTER TABLE "pod_listing_session_products"
  ADD COLUMN "manual_data" JSONB;
