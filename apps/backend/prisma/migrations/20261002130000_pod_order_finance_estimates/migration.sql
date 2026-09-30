-- Tài chính cấp ĐƠN cho cột "Giá" của POD Orders (Tiền thu về · Lợi nhuận · Margin).
--
-- Nguồn (không tự suy công thức — chỉ dùng field chính thức của TikTok Finance API):
--  * Đơn ĐÃ quyết toán: `pod_tiktok_statement_transactions` (Get Transactions by Statement 202501)
--    — đã có `settlement_amount` / `revenue_amount` / `fee_tax_amount` / `shipping_cost_amount`.
--    Bổ sung 3 cột breakdown mà trước đây bị bỏ khi đồng bộ (Gross sales, Seller discount,
--    Referral fee…). Dòng đã đồng bộ trước migration này để NULL (chỉ hiển thị được 4 tổng).
--  * Đơn CHƯA quyết toán: bảng mới `pod_tiktok_unsettled_transactions`
--    (GET /finance/202507/orders/unsettled) — `est_settlement_amount` là field TikTok định nghĩa
--    ("revenue_amount - shipping_cost_amount - fee_tax_amount - adjustment_amount").
--
-- Additive, không đổi dữ liệu cũ.

ALTER TABLE "pod_tiktok_statement_transactions"
  ADD COLUMN "revenue_breakdown" JSONB,
  ADD COLUMN "fee_tax_breakdown" JSONB,
  ADD COLUMN "shipping_cost_breakdown" JSONB;

CREATE TABLE "pod_tiktok_unsettled_transactions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "tiktok_transaction_id" VARCHAR(64) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "tiktok_order_id" VARCHAR(64),
  "adjustment_id" VARCHAR(64),
  "currency" VARCHAR(10) NOT NULL,
  "est_settlement_amount" DECIMAL(18,4),
  "est_revenue_amount" DECIMAL(18,4),
  "est_fee_tax_amount" DECIMAL(18,4),
  "est_shipping_cost_amount" DECIMAL(18,4),
  "est_adjustment_amount" DECIMAL(18,4),
  "revenue_breakdown" JSONB,
  "fee_tax_breakdown" JSONB,
  "shipping_cost_breakdown" JSONB,
  "estimated_settlement" VARCHAR(100),
  "unsettled_reason" VARCHAR(500),
  "order_create_time" BIGINT,
  "order_delivery_time" BIGINT,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_by" UUID,
  "updated_by" UUID,
  CONSTRAINT "pod_tiktok_unsettled_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pod_tiktok_unsettled_transactions_organization_id_tiktok_trans_key"
  ON "pod_tiktok_unsettled_transactions"("organization_id", "tiktok_transaction_id");
CREATE INDEX "pod_tiktok_unsettled_transactions_organization_id_tiktok_orde_idx"
  ON "pod_tiktok_unsettled_transactions"("organization_id", "tiktok_order_id");
CREATE INDEX "pod_tiktok_unsettled_transactions_shop_id_idx"
  ON "pod_tiktok_unsettled_transactions"("shop_id");

ALTER TABLE "pod_tiktok_unsettled_transactions"
  ADD CONSTRAINT "pod_tiktok_unsettled_transactions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pod_tiktok_unsettled_transactions"
  ADD CONSTRAINT "pod_tiktok_unsettled_transactions_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
