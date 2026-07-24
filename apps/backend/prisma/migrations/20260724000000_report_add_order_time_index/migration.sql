-- Report module: composite index tối ưu range-scan thời gian theo tổ chức (Dashboard/Reports).
CREATE INDEX IF NOT EXISTS "orders_organization_id_ordered_at_idx" ON "orders"("organization_id", "ordered_at");

-- Reconcile drift: order_notes.updated_at do Prisma quản (@updatedAt), không cần DEFAULT ở DB.
ALTER TABLE "order_notes" ALTER COLUMN "updated_at" DROP DEFAULT;
