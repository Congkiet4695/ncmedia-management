import * as Joi from 'joi';

/**
 * Schema validate biến môi trường khi khởi động (fail-fast nếu thiếu/sai).
 * Dùng bởi ConfigModule.forRoot({ validationSchema }).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGIN: Joi.string().default('*'),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  REFRESH_TOKEN_HMAC_SECRET: Joi.string().required(),

  /**
   * Mặc định theo môi trường: production TẮT, còn lại BẬT.
   *
   * Trước đây docker-compose khoá cứng `false` cho production. Sau khi chuyển sang nạp
   * biến bằng `env_file`, quên khai báo dòng này trong .env.production sẽ rơi về default —
   * nên default phải tự nó an toàn, không dựa vào lớp triển khai.
   */
  SWAGGER_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().default(false),
      otherwise: Joi.boolean().default(true),
    }),
  SWAGGER_PATH: Joi.string().default('docs'),

  // Khoá mã hoá secret Account (AES-256-GCM). Base64 của 32 byte (docs/account.md D-01).
  ACCOUNT_ENCRYPTION_KEY: Joi.string().required(),

  // --- Storage Module (core) ---
  // Nhà cung cấp đang dùng. Production đặt CLOUDFLARE_R2.
  STORAGE_PROVIDER: Joi.string().valid('CLOUDFLARE_R2', 'LOCAL_DISK').default('LOCAL_DISK'),
  // Trần 100MB khớp `client_max_body_size` của Nginx — đặt cao hơn chỉ tạo ra lỗi 413
  // ở tầng proxy mà ứng dụng không hề biết lý do.
  STORAGE_MAX_FILE_BYTES: Joi.number().integer().min(1024).max(104857600).default(104857600),
  // Đủ dài cho file 100MB trên đường truyền chậm; tối đa 10 phút.
  STORAGE_TIMEOUT_MS: Joi.number().integer().min(1000).max(600000).default(120000),

  // Cloudflare R2 — BẮT BUỘC khi STORAGE_PROVIDER=CLOUDFLARE_R2, bỏ qua khi dùng LOCAL_DISK.
  R2_ACCOUNT_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 'CLOUDFLARE_R2',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  R2_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'CLOUDFLARE_R2',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  R2_SECRET_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'CLOUDFLARE_R2',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  R2_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 'CLOUDFLARE_R2',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  // Trống = bucket private (file tải qua API thay vì URL công khai).
  R2_PUBLIC_URL: Joi.string().uri().allow('').default(''),

  // Lưu trữ đĩa cục bộ (chỉ dùng khi STORAGE_PROVIDER=LOCAL_DISK).
  UPLOAD_ROOT: Joi.string().default('./uploads'),
  UPLOAD_URL_PREFIX: Joi.string().pattern(/^\/[a-zA-Z0-9/_-]*$/).default('/uploads'),
  UPLOAD_PUBLIC_BASE_URL: Joi.string().uri().allow('').default(''),

  // Múi giờ quy đổi preset lọc thời gian (phút). Mặc định 420 = UTC+7.
  APP_TIMEZONE_OFFSET_MINUTES: Joi.number().integer().min(-720).max(840).default(420),

  // --- Module POD — TikTok Shop (docs/pod-tiktok/**) ---
  // app_key / app_secret / service_id: Partner Center → App & Service → Basic Information.
  TIKTOK_APP_KEY: Joi.string().required(),
  TIKTOK_APP_SECRET: Joi.string().required(),
  TIKTOK_SERVICE_ID: Joi.string().required(),
  TIKTOK_API_BASE_URL: Joi.string().uri().default('https://open-api.tiktokglobalshop.com'),
  TIKTOK_AUTH_BASE_URL: Joi.string().uri().default('https://auth.tiktok-shops.com'),
  TIKTOK_AUTHORIZE_BASE_URL_US: Joi.string().uri().default('https://services.us.tiktokshop.com'),
  TIKTOK_AUTHORIZE_BASE_URL_ROW: Joi.string().uri().default('https://services.tiktokshop.com'),
  TIKTOK_DEFAULT_REGION: Joi.string().valid('US', 'ROW').default('US'),
  // Trống = chuyển hướng tương đối (frontend và backend cùng domain qua Nginx).
  TIKTOK_CALLBACK_REDIRECT_BASE: Joi.string().uri().allow('').default(''),
  // Khoá mã hoá RIÊNG cho token TikTok (AES-256-GCM). Base64 của đúng 32 byte.
  TIKTOK_ENCRYPTION_KEY: Joi.string().required(),
  TIKTOK_HTTP_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(15000),
  TIKTOK_MAX_RETRY: Joi.number().integer().min(0).max(5).default(3),
  // Hạn `state` của luồng uỷ quyền: 1–30 phút (auth_code của TikTok sống 30 phút).
  TIKTOK_OAUTH_STATE_TTL_SECONDS: Joi.number().integer().min(60).max(1800).default(900),
  TIKTOK_OAUTH_STATE_RETENTION_HOURS: Joi.number().integer().min(1).max(720).default(72),

  // --- Đồng bộ đơn hàng (Sprint 2) ---
  TIKTOK_SYNC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  // Cron 5 trường (phút giờ ngày tháng thứ) — mặc định mỗi 5 phút.
  TIKTOK_SYNC_CRON: Joi.string().default('*/5 * * * *'),
  TIKTOK_SYNC_OVERLAP_SECONDS: Joi.number().integer().min(0).max(86400).default(300),
  TIKTOK_SYNC_LAG_SECONDS: Joi.number().integer().min(0).max(3600).default(60),
  // page_size hợp lệ theo tài liệu Get Order List: [1..100].
  TIKTOK_SYNC_PAGE_SIZE: Joi.number().integer().min(1).max(100).default(100),
  TIKTOK_SYNC_MAX_PAGES_PER_RUN: Joi.number().integer().min(1).max(1000).default(50),
  TIKTOK_SYNC_MAX_CONCURRENCY: Joi.number().integer().min(1).max(16).default(4),
  TIKTOK_SYNC_MAX_WINDOW_SECONDS: Joi.number().integer().min(3600).max(2592000).default(86400),
  TIKTOK_SYNC_INITIAL_LOOKBACK_SECONDS: Joi.number()
    .integer()
    .min(3600)
    .max(31536000)
    .default(2592000),
  // Pha BACKFILL — kéo lịch sử theo create_time. 0 ngày = toàn bộ lịch sử shop.
  TIKTOK_SYNC_BACKFILL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  TIKTOK_SYNC_BACKFILL_FROM_DAYS: Joi.number().integer().min(0).max(3650).default(0),
  TIKTOK_SYNC_BACKFILL_MAX_PAGES: Joi.number().integer().min(1).max(1000).default(200),
  TIKTOK_SYNC_RUN_DEADLINE_MS: Joi.number().integer().min(10000).max(3600000).default(240000),
  TIKTOK_SYNC_FAILURE_THRESHOLD: Joi.number().integer().min(1).max(50).default(5),
  TIKTOK_TOKEN_REFRESH_BEFORE_SECONDS: Joi.number().integer().min(60).max(604800).default(86400),

  // --- Đồng bộ sản phẩm (Sprint Product) ---
  TIKTOK_PRODUCT_SYNC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  TIKTOK_PRODUCT_SYNC_CRON: Joi.string().default('0 */6 * * *'),
  TIKTOK_PRODUCT_SYNC_INCLUDE_CATALOG: Joi.boolean().truthy('true').falsy('false').default(false),

  // --- Trạng thái duyệt listing (Sprint Publish) ---
  TIKTOK_LISTING_REVIEW_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  TIKTOK_LISTING_REVIEW_CRON: Joi.string().default('*/5 * * * *'),

  // --- Đồng bộ Payout (Finance API) ---
  TIKTOK_PAYOUT_SYNC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  TIKTOK_PAYOUT_WINDOW_DAYS: Joi.number().integer().min(1).max(3650).default(90),
  TIKTOK_PAYOUT_MAX_PAGES: Joi.number().integer().min(1).max(1000).default(100),
  TIKTOK_PAYOUT_STATEMENTS_PER_RUN: Joi.number().integer().min(1).max(500).default(50),

  // --- Module Fulfillment (xưởng in) ---
  // Base URL công khai của hệ thống, dùng dựng URL webhook cho nhà cung cấp.
  FULFILLMENT_WEBHOOK_BASE_URL: Joi.string().uri().allow('').default(''),
  MANGO_API_BASE_URL: Joi.string().uri().default('https://v3.mangoteeprints.com/api/public/v1'),
  MANGO_HTTP_TIMEOUT_MS: Joi.number().integer().min(1000).max(120000).default(30000),
  FULFILLMENT_SYNC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  FULFILLMENT_SYNC_CRON: Joi.string().default('*/5 * * * *'),
  FULFILLMENT_SYNC_BATCH_SIZE: Joi.number().integer().min(1).max(1000).default(100),
  FULFILLMENT_SYNC_DEADLINE_MS: Joi.number().integer().min(10000).max(3600000).default(240000),
  FULFILLMENT_WEBHOOK_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
  FULFILLMENT_WEBHOOK_RETRY_BATCH: Joi.number().integer().min(1).max(500).default(50),
});
