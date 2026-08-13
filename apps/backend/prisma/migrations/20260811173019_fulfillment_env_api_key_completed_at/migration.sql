-- AlterTable
ALTER TABLE "fulfillment_accounts" ALTER COLUMN "api_key_enc" DROP NOT NULL;

-- AlterTable
ALTER TABLE "fulfillment_orders" ADD COLUMN     "completed_at" TIMESTAMPTZ(6);
