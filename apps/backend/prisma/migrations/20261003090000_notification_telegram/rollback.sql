-- Rollback 20261003090000_notification_telegram (chạy tay, sau đó xoá dòng tương ứng trong _prisma_migrations).
DROP TABLE IF EXISTS "notification_events";
DROP TABLE IF EXISTS "organization_telegram_configs";
DROP TYPE IF EXISTS "notification_event_status";
DROP TYPE IF EXISTS "notification_entity_type";
DROP TYPE IF EXISTS "notification_event_type";
DROP TYPE IF EXISTS "notification_channel";
