/**
 * Cấu hình tập trung — nạp qua @nestjs/config (ConfigModule).
 * Không đọc process.env rải rác trong code (KISS/DRY). Luôn qua ConfigService.
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Khai báo hạ tầng cho Auth — CHƯA implement Auth ở giai đoạn này.
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    refreshHmacSecret: process.env.REFRESH_TOKEN_HMAC_SECRET,
  },

  swagger: {
    enabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
    path: process.env.SWAGGER_PATH ?? 'docs',
  },

  // Mã hoá secret của Account (AES-256-GCM) — docs/account.md D-01. Khoá 32 byte (base64).
  account: {
    encryptionKey: process.env.ACCOUNT_ENCRYPTION_KEY,
  },

  /**
   * Storage Module (core) — lưu trữ file dùng chung toàn hệ thống.
   *
   * `provider` quyết định nhà cung cấp đang dùng:
   *   - CLOUDFLARE_R2 : production (yêu cầu đủ R2_*).
   *   - LOCAL_DISK    : dev/test, không cần credential.
   * Đổi provider KHÔNG cần sửa module nghiệp vụ nào.
   */
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? 'LOCAL_DISK',
    /** Giới hạn dung lượng một file (byte). Mặc định 100MB — xem storage.constants.ts. */
    maxFileBytes: parseInt(process.env.STORAGE_MAX_FILE_BYTES ?? '104857600', 10),
    /**
     * Timeout gọi nhà cung cấp lưu trữ (ms). Mặc định 120s.
     * 30s là quá ngắn cho file 100MB: chỉ cần đường truyền ~30 Mbps là đã hết giờ giữa chừng
     * và upload hỏng dù mọi thứ khác đều đúng.
     */
    timeoutMs: parseInt(process.env.STORAGE_TIMEOUT_MS ?? '120000', 10),

    r2: {
      accountId: process.env.R2_ACCOUNT_ID,
      accessKey: process.env.R2_ACCESS_KEY,
      secretKey: process.env.R2_SECRET_KEY,
      bucket: process.env.R2_BUCKET,
      /** URL công khai của bucket (R2 Public Bucket / custom domain). Trống = bucket private. */
      publicUrl: process.env.R2_PUBLIC_URL ?? '',
    },

    local: {
      root: process.env.UPLOAD_ROOT ?? './uploads',
      urlPrefix: process.env.UPLOAD_URL_PREFIX ?? '/uploads',
      publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '',
    },
  },

  /**
   * Chênh lệch múi giờ (phút) dùng để quy đổi các mốc "Hôm nay / Hôm qua / Tháng này".
   * Mặc định +420 = UTC+7 (giờ Việt Nam — nơi đội vận hành làm việc).
   */
  timezoneOffsetMinutes: parseInt(process.env.APP_TIMEZONE_OFFSET_MINUTES ?? '420', 10),

  /**
   * Module Fulfillment — gửi đơn sang xưởng in (docs/fulfillment/README.md).
   *
   * API key của nhà cung cấp KHÔNG nằm ở đây: mỗi Organization tự cấu hình và khoá được
   * mã hoá trong DB (`fulfillment_accounts.api_key_enc`). Phần này chỉ là tham số vận hành.
   */
  fulfillment: {
    /** Base URL công khai của hệ thống — dùng để dựng URL webhook đăng ký với nhà cung cấp. */
    webhookBaseUrl: process.env.FULFILLMENT_WEBHOOK_BASE_URL ?? '',

    mango: {
      /** Ghi đè base URL Mango (mặc định lấy hằng số trong `mango.constants.ts`). */
      baseUrl: process.env.MANGO_API_BASE_URL ?? 'https://v3.mangoteeprints.com/api/public/v1',
      timeoutMs: parseInt(process.env.MANGO_HTTP_TIMEOUT_MS ?? '30000', 10),
    },

    sync: {
      enabled: (process.env.FULFILLMENT_SYNC_ENABLED ?? 'false') === 'true',
      /** Cron 5 trường — mặc định mỗi 5 phút. */
      cron: process.env.FULFILLMENT_SYNC_CRON ?? '*/5 * * * *',
      /** Số đơn hỏi trạng thái mỗi lượt (ưu tiên đơn lâu chưa đồng bộ nhất). */
      batchSize: parseInt(process.env.FULFILLMENT_SYNC_BATCH_SIZE ?? '100', 10),
      /** Deadline cho cả lượt (ms) — phải NHỎ HƠN chu kỳ cron. */
      runDeadlineMs: parseInt(process.env.FULFILLMENT_SYNC_DEADLINE_MS ?? '240000', 10),
    },

    webhook: {
      /** Số lần thử xử lý một webhook trước khi chuyển sang dead letter. */
      maxAttempts: parseInt(process.env.FULFILLMENT_WEBHOOK_MAX_ATTEMPTS ?? '5', 10),
      retryBatch: parseInt(process.env.FULFILLMENT_WEBHOOK_RETRY_BATCH ?? '50', 10),
    },
  },

  /**
   * Module POD — TikTok Shop (docs/pod-tiktok/**).
   * Giá trị lấy từ Partner Center → App & Service → (chọn app) → Basic Information.
   * Domain theo tài liệu chính thức "Methods and endpoints" / "Authorization overview":
   *   - Business API: https://open-api.tiktokglobalshop.com
   *   - Token:        https://auth.tiktok-shops.com
   *   - Authorize US: https://services.us.tiktokshop.com/open/authorize
   *   - Authorize ROW:https://services.tiktokshop.com/open/authorize
   * Khoá mã hoá RIÊNG cho token TikTok (key separation với ACCOUNT_ENCRYPTION_KEY).
   */
  tiktok: {
    appKey: process.env.TIKTOK_APP_KEY,
    appSecret: process.env.TIKTOK_APP_SECRET,
    serviceId: process.env.TIKTOK_SERVICE_ID,
    apiBaseUrl: process.env.TIKTOK_API_BASE_URL ?? 'https://open-api.tiktokglobalshop.com',
    authBaseUrl: process.env.TIKTOK_AUTH_BASE_URL ?? 'https://auth.tiktok-shops.com',
    authorizeBaseUrlUs:
      process.env.TIKTOK_AUTHORIZE_BASE_URL_US ?? 'https://services.us.tiktokshop.com',
    authorizeBaseUrlRow:
      process.env.TIKTOK_AUTHORIZE_BASE_URL_ROW ?? 'https://services.tiktokshop.com',
    /**
     * Gốc URL để chuyển hướng sau khi TikTok gọi callback.
     *
     * Bỏ trống (mặc định) ⇒ chuyển hướng TƯƠNG ĐỐI `/tiktok/link-success`. Đúng cho cách
     * triển khai hiện tại: Nginx phục vụ frontend và backend trên CÙNG một domain.
     * Chỉ cần đặt giá trị khi frontend nằm ở domain khác.
     */
    callbackRedirectBase: process.env.TIKTOK_CALLBACK_REDIRECT_BASE ?? '',

    /** Thị trường mặc định khi dựng authorization link: US | ROW (PO chốt: US). */
    defaultRegion: process.env.TIKTOK_DEFAULT_REGION ?? 'US',
    encryptionKey: process.env.TIKTOK_ENCRYPTION_KEY,
    httpTimeoutMs: parseInt(process.env.TIKTOK_HTTP_TIMEOUT_MS ?? '15000', 10),
    maxRetry: parseInt(process.env.TIKTOK_MAX_RETRY ?? '3', 10),

    /**
     * Đồng bộ đơn hàng (Sprint 2). KHÔNG hardcode cron/ngưỡng trong code.
     *
     * - `syncCron`: cron expression (mặc định mỗi 5 phút).
     * - `overlapSeconds`: quét lùi thêm để bù cảnh báo chính thức của TikTok
     *   "Update times may exceed the selected search range during data refreshes".
     * - `lagSeconds`: không đọc sát thời điểm hiện tại (dữ liệu chưa ổn định).
     * - `pageSize`: 1–100 theo tài liệu Get Order List (dùng 100 để giảm số call).
     * - `maxPagesPerRun`: chặn một shop chiếm hết deadline của cả lượt cron.
     * - `refreshBeforeSeconds`: refresh access token TRƯỚC khi hết hạn.
     */
    sync: {
      enabled: (process.env.TIKTOK_SYNC_ENABLED ?? 'false') === 'true',
      cron: process.env.TIKTOK_SYNC_CRON ?? '*/5 * * * *',
      overlapSeconds: parseInt(process.env.TIKTOK_SYNC_OVERLAP_SECONDS ?? '300', 10),
      lagSeconds: parseInt(process.env.TIKTOK_SYNC_LAG_SECONDS ?? '60', 10),
      pageSize: parseInt(process.env.TIKTOK_SYNC_PAGE_SIZE ?? '100', 10),
      maxPagesPerRun: parseInt(process.env.TIKTOK_SYNC_MAX_PAGES_PER_RUN ?? '50', 10),
      maxConcurrency: parseInt(process.env.TIKTOK_SYNC_MAX_CONCURRENCY ?? '4', 10),
      /** Cửa sổ tối đa mỗi lượt (giây) — vượt thì tự chia nhỏ. Mặc định 24h. */
      maxWindowSeconds: parseInt(process.env.TIKTOK_SYNC_MAX_WINDOW_SECONDS ?? '86400', 10),
      /**
       * Lưới an toàn cho pha INCREMENTAL: shop đã backfill xong nhưng mất watermark
       * thì quét lùi tối đa ngần này (giây). KHÔNG phải là phạm vi kéo lịch sử —
       * lịch sử do pha BACKFILL đảm nhiệm (xem `backfill` bên dưới).
       */
      initialLookbackSeconds: parseInt(
        process.env.TIKTOK_SYNC_INITIAL_LOOKBACK_SECONDS ?? '2592000',
        10,
      ),

      /**
       * Pha BACKFILL — kéo TOÀN BỘ lịch sử đơn theo `create_time`.
       *
       * Vì sao tách khỏi pha incremental: `create_time` BẤT BIẾN nên phân trang một
       * cửa sổ `create_time` là snapshot ổn định; còn `update_time` thay đổi liên tục
       * (tài liệu TikTok: "Update times may exceed the selected search range"), chỉ
       * hợp để bắt thay đổi chứ không thể dùng kéo lịch sử.
       */
      backfill: {
        enabled: (process.env.TIKTOK_SYNC_BACKFILL_ENABLED ?? 'true') === 'true',
        /** Kéo lùi tối đa bao nhiêu NGÀY. 0 = toàn bộ lịch sử shop (khuyến nghị). */
        fromDays: parseInt(process.env.TIKTOK_SYNC_BACKFILL_FROM_DAYS ?? '0', 10),
        /** Số trang tối đa cho MỘT lượt backfill (lượt sau tiếp tục từ cursor). */
        maxPagesPerRun: parseInt(process.env.TIKTOK_SYNC_BACKFILL_MAX_PAGES ?? '200', 10),
      },
      /** Deadline cho toàn bộ một lượt cron (ms) — phải < chu kỳ cron. */
      runDeadlineMs: parseInt(process.env.TIKTOK_SYNC_RUN_DEADLINE_MS ?? '240000', 10),
      /** Số lần thất bại liên tiếp thì mở circuit breaker cho shop. */
      failureThreshold: parseInt(process.env.TIKTOK_SYNC_FAILURE_THRESHOLD ?? '5', 10),
      refreshBeforeSeconds: parseInt(process.env.TIKTOK_TOKEN_REFRESH_BEFORE_SECONDS ?? '86400', 10),
    },

    /**
     * Đồng bộ Payout (Finance API) — docs/pod-tiktok/10-payout-report.md.
     *
     * Không có watermark riêng: lần đầu (shop chưa có payment nào) kéo toàn bộ lịch sử,
     * các lượt sau chỉ quét lại `windowDays` gần nhất vì trạng thái chi trả còn chuyển
     * tiếp (PROCESSING → PAID/FAILED) nên bản ghi cũ vẫn có thể đổi.
     */
    payout: {
      enabled: (process.env.TIKTOK_PAYOUT_SYNC_ENABLED ?? 'true') === 'true',
      /** Số ngày quét lại ở mỗi lượt định kỳ. */
      windowDays: parseInt(process.env.TIKTOK_PAYOUT_WINDOW_DAYS ?? '90', 10),
      /** Trần số trang cho MỘT endpoint trong một lượt (100 bản ghi/trang). */
      maxPagesPerRun: parseInt(process.env.TIKTOK_PAYOUT_MAX_PAGES ?? '100', 10),
      /** Số statement được kéo giao dịch cấp đơn mỗi lượt (phần dư chạy ở lượt sau). */
      statementsPerRun: parseInt(process.env.TIKTOK_PAYOUT_STATEMENTS_PER_RUN ?? '50', 10),
    },
  },
});
