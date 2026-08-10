-- CreateEnum
CREATE TYPE "pod_design_placement" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT', 'SLEEVE');

-- AlterTable
ALTER TABLE "pod_order_items" ADD COLUMN     "product_category" VARCHAR(255);

-- CreateTable
CREATE TABLE "pod_order_item_designs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "placement" "pod_design_placement" NOT NULL,
    "file_key" VARCHAR(512) NOT NULL,
    "file_url" VARCHAR(1024) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_order_item_designs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_order_item_designs_organization_id_idx" ON "pod_order_item_designs"("organization_id");

-- CreateIndex
CREATE INDEX "pod_order_item_designs_order_id_idx" ON "pod_order_item_designs"("order_id");

-- CreateIndex
CREATE INDEX "pod_order_item_designs_order_item_id_idx" ON "pod_order_item_designs"("order_item_id");

-- CreateIndex
CREATE INDEX "pod_order_item_designs_placement_idx" ON "pod_order_item_designs"("placement");

-- CreateIndex
CREATE UNIQUE INDEX "pod_order_item_designs_order_item_id_placement_key" ON "pod_order_item_designs"("order_item_id", "placement");

-- AddForeignKey
ALTER TABLE "pod_order_item_designs" ADD CONSTRAINT "pod_order_item_designs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "pod_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_order_item_designs" ADD CONSTRAINT "pod_order_item_designs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma schema khong bieu dien duoc)
-- ---------------------------------------------------------------------------

-- Kich thuoc file phai duong (0 byte la file hong).
ALTER TABLE "pod_order_item_designs"
  ADD CONSTRAINT "pod_order_item_designs_file_size_check"
  CHECK ("file_size" > 0);

-- So lan thay design bat dau tu 1.
ALTER TABLE "pod_order_item_designs"
  ADD CONSTRAINT "pod_order_item_designs_version_check"
  CHECK ("version" >= 1);

-- Khoa file va URL khong duoc rong.
ALTER TABLE "pod_order_item_designs"
  ADD CONSTRAINT "pod_order_item_designs_file_key_check"
  CHECK (length(btrim("file_key")) > 0 AND length(btrim("file_url")) > 0);
