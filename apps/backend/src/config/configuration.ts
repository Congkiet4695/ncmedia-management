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
});
