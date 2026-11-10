-- Organization lifecycle: giới hạn Shop + ngày hết hạn + hành động Super Admin + nhật ký xoá cứng.
-- docs/organization-lifecycle.md
--
-- CHỈ THÊM: 4 giá trị enum, 2 cột NULLABLE trên organizations, 1 bảng mới. Không đổi trạng thái tổ chức nào.
--
-- Organization ĐÃ TỒN TẠI (mọi trạng thái, trừ tổ chức hệ thống): shop_limit = 500, expires_at = created_at + 365 ngày
-- (yêu cầu nghiệp vụ). Đã đối chiếu production 2026-11-11 (chỉ đọc): 8 tổ chức ACTIVE đăng ký 20/07–27/10/2026 ⇒
-- hết hạn sớm nhất 20/07/2027, không tổ chức nào hết hạn ngay; nhiều Shop nhất đang kết nối = 87 < 500.
-- Organization MỚI: NULL cho tới lần duyệt đầu tiên — lúc đó đặt 10 Shop + created_at + 30 ngày (code).
-- Tổ chức hệ thống (is_platform): NULL = không giới hạn, không hết hạn.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "organization_approval_action" ADD VALUE 'ACTIVATE';
ALTER TYPE "organization_approval_action" ADD VALUE 'DEACTIVATE';
ALTER TYPE "organization_approval_action" ADD VALUE 'UPDATE_SHOP_LIMIT';
ALTER TYPE "organization_approval_action" ADD VALUE 'UPDATE_EXPIRATION';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "shop_limit" INTEGER;

-- CreateTable
CREATE TABLE "organization_deletion_logs" (
    "id" UUID NOT NULL,
    "deleted_organization_id" UUID NOT NULL,
    "organization_name" VARCHAR(255) NOT NULL,
    "organization_slug" VARCHAR(120) NOT NULL,
    "deleted_by" UUID NOT NULL,
    "deleted_by_email" VARCHAR(255) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_rows" INTEGER NOT NULL,
    "tables" JSONB NOT NULL,

    CONSTRAINT "organization_deletion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_deletion_logs_deleted_at_idx" ON "organization_deletion_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "organization_deletion_logs_deleted_organization_id_idx" ON "organization_deletion_logs"("deleted_organization_id");


-- Số Shop tối đa phải dương (NULL = chưa áp gói).
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_shop_limit_positive" CHECK ("shop_limit" IS NULL OR "shop_limit" > 0);

-- Backfill Organization đã tồn tại (xem đầu file). Idempotent: chỉ dòng chưa có giá trị.
UPDATE "organizations"
   SET "shop_limit" = 500
 WHERE "is_platform" = false AND "shop_limit" IS NULL;
UPDATE "organizations"
   SET "expires_at" = "created_at" + INTERVAL '365 days'
 WHERE "is_platform" = false AND "expires_at" IS NULL;
