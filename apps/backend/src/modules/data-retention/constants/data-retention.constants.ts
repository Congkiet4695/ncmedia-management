/**
 * Retention tập trung — dọn dữ liệu vận hành hết hạn (docs/data-retention.md).
 *
 * Ba tác vụ, mỗi tác vụ chạy ĐỘC LẬP (khoá riêng, lỗi riêng):
 *  - `RECENT_NOTIFICATIONS` — `notification_events` (màn "Thông báo gần đây"): chỉ giữ NGÀY HIỆN TẠI.
 *  - `PUBLISH_HISTORY`      — `pod_listing_jobs` + `pod_listing_job_items` + `pod_listing_logs`
 *                             (màn Publish History): giữ N ngày gần nhất.
 *  - `DRAFT_LISTINGS`       — `pod_listing_payloads` + `pod_listing_payload_items` (màn Draft Listings):
 *                             giữ N ngày gần nhất.
 */
export const DATA_RETENTION_TASKS = [
  'RECENT_NOTIFICATIONS',
  'PUBLISH_HISTORY',
  'DRAFT_LISTINGS',
] as const;
export type DataRetentionTask = (typeof DATA_RETENTION_TASKS)[number];

/** Số ngày giữ mặc định của Publish History / Draft Listings (yêu cầu nghiệp vụ: 7 ngày gần nhất). */
export const DATA_RETENTION_DEFAULT_KEEP_DAYS = 7;

/** Khoá Redis của TỪNG tác vụ — cron trên nhiều replica và CLI không chạy chồng một tác vụ. */
export const DATA_RETENTION_TASK_LOCK_PREFIX = 'data-retention:lock:';
export const DATA_RETENTION_TASK_LOCK_TTL_MS = 10 * 60_000;

/**
 * Khoá "đã chạy hôm nay" của cron — nhiều replica cùng bắn cron thì chỉ replica giành được khoá của NGÀY
 * nghiệp vụ đó chạy. Để tự hết hạn (không giải phóng): dài hơn một ngày, ngắn hơn hai ngày.
 */
export const DATA_RETENTION_DAILY_TICK_PREFIX = 'data-retention:tick:';
export const DATA_RETENTION_DAILY_TICK_TTL_MS = 30 * 60 * 60_000;

/** Lịch mặc định: 00:20 theo MÚI GIỜ NGHIỆP VỤ — ngay sau khi sang ngày mới, lúc ít tải. */
export const DATA_RETENTION_DEFAULT_CRON = '20 0 * * *';
