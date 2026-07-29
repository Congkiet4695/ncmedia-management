-- ============================================================================
-- Account — bổ sung 3 chỉ số tiền: Hold / Net / Paid (USD).
-- An toàn với dữ liệu production: NOT NULL kèm DEFAULT 0 → mọi Account cũ nhận 0,
-- không cần backfill, không khoá bảng lâu (PostgreSQL 11+ ADD COLUMN có DEFAULT
-- không rewrite toàn bảng).
-- ============================================================================

ALTER TABLE "accounts"
  ADD COLUMN "hold_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "net_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Ràng buộc không âm (đồng nhất với employees.salary / order_kpi / revenue_kpi).
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_hold_amount_nonneg" CHECK ("hold_amount" >= 0),
  ADD CONSTRAINT "accounts_net_amount_nonneg" CHECK ("net_amount" >= 0),
  ADD CONSTRAINT "accounts_paid_amount_nonneg" CHECK ("paid_amount" >= 0);
