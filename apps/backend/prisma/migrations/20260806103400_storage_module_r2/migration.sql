/*
  Warnings:

  - You are about to drop the column `file_key` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `file_name` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `file_size` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `file_url` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `mime_type` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `uploaded_at` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - You are about to drop the column `uploaded_by` on the `pod_order_item_designs` table. All the data in the column will be lost.
  - Added the required column `storage_file_id` to the `pod_order_item_designs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "storage_module_name" AS ENUM ('POD_TIKTOK', 'EMPLOYEE', 'ORDER', 'ACCOUNT', 'REPORT', 'COMMON');

-- CreateEnum
CREATE TYPE "storage_reference_type" AS ENUM ('POD_ORDER_ITEM_DESIGN', 'EMPLOYEE_AVATAR', 'EMPLOYEE_CCCD', 'ACCOUNT_DOCUMENT', 'ORDER_ATTACHMENT', 'SHIPPING_LABEL', 'EXCEL_IMPORT', 'EXCEL_EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "storage_provider_name" AS ENUM ('CLOUDFLARE_R2', 'LOCAL_DISK', 'AWS_S3', 'MINIO', 'GCS');

-- AlterEnum
ALTER TYPE "pod_design_placement" ADD VALUE 'LABEL';

-- ---------------------------------------------------------------------------
-- DON DU LIEU DESIGN CU (bat buoc truoc khi doi sang storage_files)
--
-- Truoc sprint nay, file design duoc luu tren DIA CUC BO va metadata nam ngay
-- trong pod_order_item_designs. Sau sprint nay file nam o Cloudflare R2 va moi
-- design PHAI tro toi mot ban ghi storage_files.
--
-- Khong the tu dong chuyen file tu dia sang R2 bang SQL, nen cac ban ghi design
-- cu bi xoa. File cu (neu con) van nam trong thu muc UPLOAD_ROOT, khong bi dong toi.
-- Sau khi migrate, upload lai design qua Storage Module.
-- ---------------------------------------------------------------------------
DELETE FROM "pod_order_item_designs";

-- DropForeignKey
ALTER TABLE "pod_order_item_designs" DROP CONSTRAINT "pod_order_item_designs_uploaded_by_fkey";

-- AlterTable
ALTER TABLE "pod_order_item_designs" DROP COLUMN "file_key",
DROP COLUMN "file_name",
DROP COLUMN "file_size",
DROP COLUMN "file_url",
DROP COLUMN "mime_type",
DROP COLUMN "uploaded_at",
DROP COLUMN "uploaded_by",
ADD COLUMN     "storage_file_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "storage_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module" "storage_module_name" NOT NULL,
    "reference_type" "storage_reference_type" NOT NULL,
    "reference_id" UUID,
    "folder" VARCHAR(512) NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "stored_name" VARCHAR(255) NOT NULL,
    "extension" VARCHAR(20) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "public_url" VARCHAR(2048),
    "provider" "storage_provider_name" NOT NULL DEFAULT 'CLOUDFLARE_R2',
    "bucket" VARCHAR(255),
    "checksum" CHAR(64),
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "storage_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_files_object_key_key" ON "storage_files"("object_key");

-- CreateIndex
CREATE INDEX "storage_files_organization_id_idx" ON "storage_files"("organization_id");

-- CreateIndex
CREATE INDEX "storage_files_organization_id_module_idx" ON "storage_files"("organization_id", "module");

-- CreateIndex
CREATE INDEX "storage_files_reference_type_reference_id_idx" ON "storage_files"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "storage_files_uploaded_by_idx" ON "storage_files"("uploaded_by");

-- CreateIndex
CREATE INDEX "storage_files_created_at_idx" ON "storage_files"("created_at");

-- AddForeignKey
ALTER TABLE "pod_order_item_designs" ADD CONSTRAINT "pod_order_item_designs_storage_file_id_fkey" FOREIGN KEY ("storage_file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma schema khong bieu dien duoc)
-- ---------------------------------------------------------------------------

-- File rong la file hong.
ALTER TABLE "storage_files"
  ADD CONSTRAINT "storage_files_file_size_check"
  CHECK ("file_size" > 0);

-- Khoa doi tuong, thu muc, ten file khong duoc rong.
ALTER TABLE "storage_files"
  ADD CONSTRAINT "storage_files_key_check"
  CHECK (length(btrim("object_key")) > 0
     AND length(btrim("folder")) > 0
     AND length(btrim("stored_name")) > 0
     AND length(btrim("original_name")) > 0);

-- Phan mo rong luon luu dang chu thuong, khong co dau cham.
ALTER TABLE "storage_files"
  ADD CONSTRAINT "storage_files_extension_check"
  CHECK ("extension" = lower("extension") AND "extension" NOT LIKE '.%');
