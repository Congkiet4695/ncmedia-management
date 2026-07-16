-- ============================================================================
-- NCMedia Management Platform — Migration: Employee module (Sprint 2)
-- Target: PostgreSQL 16
-- Sinh từ prisma/schema.prisma. Employee là hồ sơ nghiệp vụ 1-1 với User (ADR-007).
-- ============================================================================

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_of_birth" DATE,
    "salary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "avatar" VARCHAR(1024),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_idx" ON "employees"("organization_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- CHECK constraint (không biểu diễn được trong Prisma schema — thêm thủ công)
-- ----------------------------------------------------------------------------

-- Lương không âm (BR: salary >= 0)
ALTER TABLE "employees" ADD CONSTRAINT "employees_salary_nonneg_check" CHECK ("salary" >= 0);
