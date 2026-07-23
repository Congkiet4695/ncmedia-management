-- ============================================================================
-- Refactor Account & Order:
--  - Account: drop id_normalize (+ unique)
--  - Order: drop customer fields + seller_note/warehouse_note(2) + tracking
--  - OrderItem: drop supplier/sku/variant; add tracking_number + fulfillment_status
--  - New: order_notes (1 Order - N Note), enums order_note_type + order_item_status
--  Backfill trước khi drop → KHÔNG mất dữ liệu.
-- ============================================================================

-- 1) Enums mới
CREATE TYPE "order_note_type" AS ENUM ('SELLER', 'WAREHOUSE');
CREATE TYPE "order_item_status" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- 2) Bảng order_notes
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "order_note_type" NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_notes_order_id_idx" ON "order_notes"("order_id");
CREATE INDEX "order_notes_type_idx" ON "order_notes"("type");
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) OrderItem: thêm cột mới
ALTER TABLE "order_items"
  ADD COLUMN "tracking_number" VARCHAR(255),
  ADD COLUMN "fulfillment_status" "order_item_status" NOT NULL DEFAULT 'PENDING';

-- 4) BACKFILL tracking Order -> từng OrderItem
UPDATE "order_items" oi
SET "tracking_number" = o."tracking"
FROM "orders" o
WHERE oi."order_id" = o."id" AND o."tracking" IS NOT NULL AND o."tracking" <> '';

-- 5) BACKFILL seller_note/warehouse_note(2) -> order_notes
INSERT INTO "order_notes" ("id","order_id","type","content","created_by","created_at","updated_at")
SELECT gen_random_uuid(), "id", 'SELLER', "seller_note", "created_by", now(), now()
FROM "orders" WHERE "seller_note" IS NOT NULL AND "seller_note" <> '';

INSERT INTO "order_notes" ("id","order_id","type","content","created_by","created_at","updated_at")
SELECT gen_random_uuid(), "id", 'WAREHOUSE', "warehouse_note", "created_by", now(), now()
FROM "orders" WHERE "warehouse_note" IS NOT NULL AND "warehouse_note" <> '';

INSERT INTO "order_notes" ("id","order_id","type","content","created_by","created_at","updated_at")
SELECT gen_random_uuid(), "id", 'WAREHOUSE', "warehouse_note_2", "created_by", now(), now()
FROM "orders" WHERE "warehouse_note_2" IS NOT NULL AND "warehouse_note_2" <> '';

-- 6) OrderItem: drop cột cũ
ALTER TABLE "order_items" DROP COLUMN "sku", DROP COLUMN "supplier", DROP COLUMN "variant";

-- 7) Order: drop cột cũ
ALTER TABLE "orders"
  DROP COLUMN "customer_email",
  DROP COLUMN "customer_name",
  DROP COLUMN "customer_phone",
  DROP COLUMN "seller_note",
  DROP COLUMN "tracking",
  DROP COLUMN "warehouse_note",
  DROP COLUMN "warehouse_note_2";

-- 8) Account: drop id_normalize + unique
DROP INDEX IF EXISTS "accounts_organization_id_id_normalize_key";
ALTER TABLE "accounts" DROP COLUMN "id_normalize";
