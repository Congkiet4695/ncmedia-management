import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { maskSensitiveQuery } from './common/utils/mask-sensitive-query.util';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './modules/storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { ProfileModule } from './modules/profile/profile.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AccountModule } from './modules/account/account.module';
import { OrderModule } from './modules/order/order.module';
import { ReportModule } from './modules/report/report.module';
import { PodTiktokModule } from './modules/pod-tiktok/pod-tiktok.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';

@Module({
  imports: [
    // Cấu hình + validate env (fail-fast)
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    // Logger có cấu trúc (pino) + mask PII (Decision-018 / ADR-024)
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('logLevel', 'info'),
          transport:
            config.get<string>('env') !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Che dữ liệu nhạy cảm / PII trong log
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.confirmPassword',
              'req.body.email',
              '*.password',
              '*.passwordHash',
              '*.tokenHash',
              '*.refreshToken',
              '*.accessToken',
              '*.temporaryPassword',
              '*.initialPassword',
              '*.newPassword',
              // Module POD — TikTok Shop: token/secret/cipher tuyệt đối không vào log.
              'req.headers["x-tts-access-token"]',
              'req.body.authorizationCode',
              '*.authorizationCode',
              '*.auth_code',
              '*.appSecret',
              '*.app_secret',
              '*.accessTokenEnc',
              '*.refreshTokenEnc',
              '*.shopCipherEnc',
              '*.access_token',
              '*.refresh_token',
              '*.cipher',
              '*.sign',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            // `req.url` là chuỗi ⇒ phải che bằng serializer, `redact` ở trên không với tới.
            req(req: { id?: unknown; method?: string; url?: string; remoteAddress?: string }) {
              return {
                id: req.id,
                method: req.method,
                url: typeof req.url === 'string' ? maskSensitiveQuery(req.url) : req.url,
                remoteAddress: req.remoteAddress,
              };
            },
          },
        },
      }),
    }),

    // Hạ tầng
    PrismaModule,
    RedisModule,
    // Storage (@Global) — cửa duy nhất để mọi module lưu trữ file
    StorageModule,

    // Health check
    HealthModule,

    // Business modules
    AuthModule,
    EmployeeModule,
    ProfileModule,
    PlatformModule,
    AccountModule,
    OrderModule,
    ReportModule,
    // Module POD — TikTok Shop (Sprint 1: Link Account)
    PodTiktokModule,
    // Gửi đơn POD sang xưởng in (MangoTeePrints)
    FulfillmentModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
