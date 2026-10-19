-- TikTok Accounts: thông tin đăng nhập nhập tay + Ngày về tiền · Employees: "Tiền giao account" + sổ cái ·
-- POD Orders: "Design Amount".
--
-- Additive, an toàn với dữ liệu production:
--  * Mọi cột mới NULLABLE hoặc NOT NULL DEFAULT 0 (PostgreSQL ≥ 11 thêm default hằng số KHÔNG rewrite bảng).
--  * Đơn hiện có ⇒ design_amount = 0 ⇒ lợi nhuận y như trước.
--  * Employee hiện có ⇒ account_handover_amount = 0. KHÔNG backfill khoản 40 USD cho các account đã giao trước
--    migration này (chưa có dữ liệu chứng minh từng lần link/assign trong quá khứ — xem docs/employee.md).
--  * Password tiktok / 2FA Code lưu dạng MÃ HOÁ (AES-256-GCM, ứng dụng mã hoá) — DB không bao giờ thấy plaintext.

-- CreateEnum
CREATE TYPE "employee_account_handover_type" AS ENUM ('EMPLOYEE_LINK', 'ADMIN_ASSIGN', 'MANUAL_ADJUSTMENT');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "account_handover_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_account_handover_amount_non_negative" CHECK ("account_handover_amount" >= 0);

-- AlterTable
ALTER TABLE "pod_tiktok_accounts" ADD COLUMN     "money_return_date" DATE,
ADD COLUMN     "tiktok_mail" VARCHAR(255),
ADD COLUMN     "tiktok_password_enc" TEXT,
ADD COLUMN     "tiktok_two_factor_enc" TEXT;

-- AlterTable
ALTER TABLE "pod_orders" ADD COLUMN     "design_amount" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "pod_orders"
  ADD CONSTRAINT "pod_orders_design_amount_non_negative" CHECK ("design_amount" >= 0);

-- CreateTable
CREATE TABLE "employee_account_handover_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "tiktok_account_id" UUID,
    "type" "employee_account_handover_type" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "balance_before" DECIMAL(15,2) NOT NULL,
    "balance_after" DECIMAL(15,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "event_key" VARCHAR(120) NOT NULL,
    "actor_user_id" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "employee_account_handover_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_tiktok_account_credential_audits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "fields" JSONB NOT NULL,
    "performed_by" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_tiktok_account_credential_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_account_handover_transactions_employee_id_created__idx" ON "employee_account_handover_transactions"("employee_id", "created_at");

-- CreateIndex
CREATE INDEX "employee_account_handover_transactions_tiktok_account_id_idx" ON "employee_account_handover_transactions"("tiktok_account_id");

-- CreateIndex — hàng rào chống cộng trùng (một sự kiện nghiệp vụ ⇒ tối đa một dòng).
CREATE UNIQUE INDEX "employee_account_handover_transactions_organization_id_even_key" ON "employee_account_handover_transactions"("organization_id", "event_key");

-- CreateIndex
CREATE INDEX "pod_tiktok_account_credential_audits_account_id_created_at_idx" ON "pod_tiktok_account_credential_audits"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_account_credential_audits_organization_id_idx" ON "pod_tiktok_account_credential_audits"("organization_id");

-- AddForeignKey
ALTER TABLE "employee_account_handover_transactions" ADD CONSTRAINT "employee_account_handover_transactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_account_handover_transactions" ADD CONSTRAINT "employee_account_handover_transactions_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_account_credential_audits" ADD CONSTRAINT "pod_tiktok_account_credential_audits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
