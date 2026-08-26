-- Organization Registration Approval Workflow
--
-- Organization mới đăng ký phải được Super Admin duyệt trước khi đăng nhập được.
--
-- 🔴 KHÔNG đụng tới Organization đang chạy: giá trị mặc định của cột `status` vẫn là ACTIVE
-- và migration này không UPDATE một dòng `organizations` nào. Chỉ Organization tạo MỚI qua
-- luồng Register (service ghi tường minh PENDING) mới rơi vào hàng chờ duyệt.

-- 1. Trạng thái mới -----------------------------------------------------------------------
ALTER TYPE "organization_status" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "organization_status" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Chủ Organization chờ duyệt: chưa bao giờ được phép vào, khác hẳn INACTIVE (đã dùng rồi bị tắt).
ALTER TYPE "user_status" ADD VALUE IF NOT EXISTS 'PENDING';

-- 2. Organization: cờ platform + dấu vết duyệt/từ chối --------------------------------------
ALTER TABLE "organizations"
  ADD COLUMN "is_platform"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approved_by"     UUID,
  ADD COLUMN "approved_at"     TIMESTAMPTZ(6),
  ADD COLUMN "rejected_by"     UUID,
  ADD COLUMN "rejected_at"     TIMESTAMPTZ(6),
  ADD COLUMN "rejected_reason" VARCHAR(1000);

CREATE INDEX "organizations_status_created_at_idx"
  ON "organizations" ("status", "created_at");

-- Đúng MỘT Organization hệ thống được tồn tại. Hai bản ghi platform nghĩa là hai cửa Super
-- Admin song song — hàng rào rẻ nhất là để database từ chối ngay.
CREATE UNIQUE INDEX "organizations_single_platform_idx"
  ON "organizations" ("is_platform") WHERE "is_platform" = true;

-- 3. User: số điện thoại liên hệ (tuỳ chọn) --------------------------------------------------
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(20);

-- 4. Nhật ký duyệt (append-only) -------------------------------------------------------------
CREATE TYPE "organization_approval_action" AS ENUM ('APPROVE', 'REJECT');

CREATE TABLE "organization_approval_logs" (
  "id"                 UUID NOT NULL,
  "organization_id"    UUID NOT NULL,
  "operator_id"        UUID NOT NULL,
  "operator_email"     VARCHAR(255) NOT NULL,
  "operator_full_name" VARCHAR(255) NOT NULL,
  "action"             "organization_approval_action" NOT NULL,
  "old_status"         "organization_status" NOT NULL,
  "new_status"         "organization_status" NOT NULL,
  "reason"             VARCHAR(1000),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_approval_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_approval_logs_organization_id_created_at_idx"
  ON "organization_approval_logs" ("organization_id", "created_at");
CREATE INDEX "organization_approval_logs_operator_id_created_at_idx"
  ON "organization_approval_logs" ("operator_id", "created_at");

ALTER TABLE "organization_approval_logs"
  ADD CONSTRAINT "organization_approval_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
