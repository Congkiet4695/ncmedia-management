-- CreateEnum
CREATE TYPE "pod_payout_status" AS ENUM ('PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "pod_statement_tx_type" AS ENUM ('ORDER', 'ADJUSTMENT', 'RESERVE', 'OTHER');

-- AlterTable
ALTER TABLE "pod_tiktok_accounts" ADD COLUMN     "seller_user_id" UUID;

-- CreateTable
CREATE TABLE "pod_tiktok_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_payment_id" VARCHAR(64) NOT NULL,
    "status" "pod_payout_status" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "settlement_amount" DECIMAL(18,4),
    "amount_before_exchange" DECIMAL(18,4),
    "exchange_rate" DECIMAL(18,6),
    "reserve_amount" DECIMAL(18,4),
    "bank_account_masked" VARCHAR(64),
    "payment_create_time" BIGINT NOT NULL,
    "payment_created_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "payload_hash" CHAR(64) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_tiktok_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_tiktok_statements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_statement_id" VARCHAR(64) NOT NULL,
    "tiktok_payment_id" VARCHAR(64),
    "payment_id" UUID,
    "paymentStatus" "pod_payout_status" NOT NULL,
    "statement_time" BIGINT NOT NULL,
    "statement_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "currency" VARCHAR(10) NOT NULL,
    "settlement_amount" DECIMAL(18,4) NOT NULL,
    "revenue_amount" DECIMAL(18,4),
    "fee_amount" DECIMAL(18,4),
    "adjustment_amount" DECIMAL(18,4),
    "net_sales_amount" DECIMAL(18,4),
    "shipping_cost_amount" DECIMAL(18,4),
    "transactions_synced_at" TIMESTAMPTZ(6),
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "payload_hash" CHAR(64) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_tiktok_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_tiktok_statement_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "tiktok_transaction_id" VARCHAR(64) NOT NULL,
    "type" "pod_statement_tx_type" NOT NULL,
    "tiktok_order_id" VARCHAR(64),
    "adjustment_id" VARCHAR(64),
    "reserve_id" VARCHAR(64),
    "order_create_time" BIGINT,
    "currency" VARCHAR(10) NOT NULL,
    "settlement_amount" DECIMAL(18,4) NOT NULL,
    "revenue_amount" DECIMAL(18,4),
    "fee_tax_amount" DECIMAL(18,4),
    "shipping_cost_amount" DECIMAL(18,4),
    "adjustment_amount" DECIMAL(18,4),
    "reserve_amount" DECIMAL(18,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_tiktok_statement_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_tiktok_payments_organization_id_payment_created_at_idx" ON "pod_tiktok_payments"("organization_id", "payment_created_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_payments_organization_id_status_idx" ON "pod_tiktok_payments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_tiktok_payments_account_id_payment_created_at_idx" ON "pod_tiktok_payments"("account_id", "payment_created_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_payments_shop_id_idx" ON "pod_tiktok_payments"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_payments_organization_id_tiktok_payment_id_key" ON "pod_tiktok_payments"("organization_id", "tiktok_payment_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_organization_id_statement_at_idx" ON "pod_tiktok_statements"("organization_id", "statement_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_organization_id_tiktok_payment_id_idx" ON "pod_tiktok_statements"("organization_id", "tiktok_payment_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_payment_id_idx" ON "pod_tiktok_statements"("payment_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_account_id_statement_at_idx" ON "pod_tiktok_statements"("account_id", "statement_at");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_shop_id_idx" ON "pod_tiktok_statements"("shop_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statements_transactions_synced_at_idx" ON "pod_tiktok_statements"("transactions_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_statements_organization_id_tiktok_statement_id_key" ON "pod_tiktok_statements"("organization_id", "tiktok_statement_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statement_transactions_statement_id_idx" ON "pod_tiktok_statement_transactions"("statement_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statement_transactions_organization_id_tiktok_or_idx" ON "pod_tiktok_statement_transactions"("organization_id", "tiktok_order_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_statement_transactions_account_id_type_idx" ON "pod_tiktok_statement_transactions"("account_id", "type");

-- CreateIndex
CREATE INDEX "pod_tiktok_statement_transactions_shop_id_idx" ON "pod_tiktok_statement_transactions"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_statement_transactions_organization_id_tiktok_tr_key" ON "pod_tiktok_statement_transactions"("organization_id", "tiktok_transaction_id");

-- CreateIndex
CREATE INDEX "pod_tiktok_accounts_seller_user_id_idx" ON "pod_tiktok_accounts"("seller_user_id");

-- AddForeignKey
ALTER TABLE "pod_tiktok_accounts" ADD CONSTRAINT "pod_tiktok_accounts_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_payments" ADD CONSTRAINT "pod_tiktok_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_payments" ADD CONSTRAINT "pod_tiktok_payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statements" ADD CONSTRAINT "pod_tiktok_statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statements" ADD CONSTRAINT "pod_tiktok_statements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statements" ADD CONSTRAINT "pod_tiktok_statements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "pod_tiktok_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statement_transactions" ADD CONSTRAINT "pod_tiktok_statement_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statement_transactions" ADD CONSTRAINT "pod_tiktok_statement_transactions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_tiktok_statement_transactions" ADD CONSTRAINT "pod_tiktok_statement_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "pod_tiktok_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data migration — gán Seller mặc định cho các kết nối TikTok đã có.
--
-- Báo cáo Payout gom nhóm theo "seller_user_id". Các account được liên kết TRƯỚC bản
-- này chưa có seller nên sẽ rơi hết vào nhóm "Chưa gán". Mặc định lấy chính người đã
-- thực hiện uỷ quyền ("authorized_by") — người đó đang vận hành shop nên là suy đoán
-- hợp lý nhất; Admin có thể đổi lại bất cứ lúc nào qua API gán Seller.
-- ---------------------------------------------------------------------------
UPDATE "pod_tiktok_accounts"
SET "seller_user_id" = "authorized_by"
WHERE "seller_user_id" IS NULL
  AND "authorized_by" IS NOT NULL
  AND "deleted_at" IS NULL;

-- Ràng buộc toàn vẹn: mã tiền tệ ISO 4217 và số đơn không âm.
ALTER TABLE "pod_tiktok_payments"
  ADD CONSTRAINT "pod_tiktok_payments_currency_check" CHECK (char_length("currency") BETWEEN 3 AND 10);
ALTER TABLE "pod_tiktok_statements"
  ADD CONSTRAINT "pod_tiktok_statements_currency_check" CHECK (char_length("currency") BETWEEN 3 AND 10);
ALTER TABLE "pod_tiktok_statements"
  ADD CONSTRAINT "pod_tiktok_statements_order_count_check" CHECK ("order_count" >= 0);
ALTER TABLE "pod_tiktok_statement_transactions"
  ADD CONSTRAINT "pod_tiktok_statement_transactions_currency_check" CHECK (char_length("currency") BETWEEN 3 AND 10);
