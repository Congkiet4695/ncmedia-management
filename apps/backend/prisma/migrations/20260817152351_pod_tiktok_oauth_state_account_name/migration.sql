-- Tên kết nối do người dùng nhập TRƯỚC khi mở authorization link.
-- Callback của TikTok là request vô danh nên không thể hỏi lại tên ở bước đó ⇒
-- phải mang theo trong chính bản ghi `state`.
--
-- Thêm cột NOT NULL vào bảng đang có dữ liệu: đặt DEFAULT tạm để các bản ghi cũ
-- (phiên uỷ quyền dở dang, sẽ hết hạn) có giá trị hợp lệ, rồi BỎ DEFAULT ngay để
-- từ nay mọi phiên mới bắt buộc phải truyền tên vào.
ALTER TABLE "pod_tiktok_oauth_states"
  ADD COLUMN "account_name" VARCHAR(255) NOT NULL DEFAULT 'TikTok Shop';

ALTER TABLE "pod_tiktok_oauth_states"
  ALTER COLUMN "account_name" DROP DEFAULT;
