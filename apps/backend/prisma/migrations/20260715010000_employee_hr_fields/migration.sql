-- ============================================================================
-- NCMedia Management Platform — Migration: Employee HR fields (sheet "Nhân viên")
-- Target: PostgreSQL 16
-- Bổ sung các cột nhân sự vào bảng employees. KHÔNG mất dữ liệu cũ (backfill status).
-- ============================================================================

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'INACTIVE', 'RESIGNED', 'SUSPENDED');

-- AlterTable: thêm cột status (backfill từ users.status), và các cột hồ sơ nhân sự
ALTER TABLE "employees"
  ADD COLUMN "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "lark_account" VARCHAR(255),
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "resigned_at" DATE,
  ADD COLUMN "cccd" VARCHAR(20),
  ADD COLUMN "cccd_image_url" VARCHAR(1024),
  ADD COLUMN "phone" VARCHAR(20),
  ADD COLUMN "address" VARCHAR(500),
  ADD COLUMN "department" VARCHAR(255),
  ADD COLUMN "bank_account" VARCHAR(100),
  ADD COLUMN "bank_qr_url" VARCHAR(1024);

-- Backfill "status" từ users.status hiện có (không mất trạng thái cũ).
-- LOCKED (không có ở employee_status) → SUSPENDED.
UPDATE "employees" e
SET "status" = CASE u."status"
  WHEN 'ACTIVE'    THEN 'ACTIVE'::"employee_status"
  WHEN 'INACTIVE'  THEN 'INACTIVE'::"employee_status"
  WHEN 'SUSPENDED' THEN 'SUSPENDED'::"employee_status"
  ELSE 'SUSPENDED'::"employee_status"
END
FROM "users" u
WHERE e."user_id" = u."id";

-- CreateIndex
CREATE UNIQUE INDEX "employees_cccd_key" ON "employees"("cccd");
CREATE INDEX "employees_status_idx" ON "employees"("status");
CREATE INDEX "employees_department_idx" ON "employees"("department");
