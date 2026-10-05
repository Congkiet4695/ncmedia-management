-- Rollback 20261006120000_employee_work_statistics_indexes (chạy tay, sau đó xoá dòng tương ứng trong _prisma_migrations).
DROP INDEX IF EXISTS "pod_listing_job_items_organization_id_finished_at_idx";
DROP INDEX IF EXISTS "pod_listing_job_items_shop_id_remote_product_id_idx";
