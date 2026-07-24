-- Employee KPI: KPI Đơn hàng + KPI Doanh thu. Mặc định 0 → không mất dữ liệu, các Employee cũ = 0.
ALTER TABLE "employees"
  ADD COLUMN "order_kpi" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revenue_kpi" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Ràng buộc không âm (đồng nhất với salary).
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_order_kpi_nonneg" CHECK ("order_kpi" >= 0),
  ADD CONSTRAINT "employees_revenue_kpi_nonneg" CHECK ("revenue_kpi" >= 0);
