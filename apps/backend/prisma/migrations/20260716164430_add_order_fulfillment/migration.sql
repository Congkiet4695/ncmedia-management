-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "order_status" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "order_status" ADD VALUE 'HAS_TRACKING';
ALTER TYPE "order_status" ADD VALUE 'SHIPPED';
ALTER TYPE "order_status" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "order_logs" ADD COLUMN     "ip_address" VARCHAR(45);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "claimed_at" TIMESTAMPTZ(6),
ADD COLUMN     "fulfilled_by_id" UUID,
ADD COLUMN     "warehouse_note_2" TEXT;

-- CreateIndex
CREATE INDEX "orders_fulfilled_by_id_idx" ON "orders"("fulfilled_by_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilled_by_id_fkey" FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
