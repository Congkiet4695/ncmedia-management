-- Nguồn trạng thái của bản ghi fulfillment: PROVIDER (gửi qua API nhà cung cấp) / MANUAL_IMPORT (Admin đánh dấu
-- đã fulfill bằng Import Excel Base Cost + Tracking Number — nhà cung cấp không xác nhận, bản ghi không có ở đó).
--
-- Chỉ THÊM enum + cột có DEFAULT 'PROVIDER': mọi bản ghi hiện có giữ đúng nghĩa cũ, không đổi dữ liệu.
-- Postgres 11+ thêm cột có DEFAULT hằng không viết lại bảng ⇒ an toàn khi deploy giờ cao điểm.
--
-- Rollback: ALTER TABLE "fulfillment_orders" DROP COLUMN "source"; DROP TYPE "fulfillment_source";
-- (chỉ sau khi đã gỡ code đọc cột này; bản ghi MANUAL_IMPORT khi đó sẽ trông như bản ghi của nhà cung cấp).
CREATE TYPE "fulfillment_source" AS ENUM ('PROVIDER', 'MANUAL_IMPORT');

ALTER TABLE "fulfillment_orders" ADD COLUMN "source" "fulfillment_source" NOT NULL DEFAULT 'PROVIDER';
