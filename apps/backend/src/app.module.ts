import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { ProfileModule } from './modules/profile/profile.module';

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
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),

    // Hạ tầng
    PrismaModule,
    RedisModule,

    // Health check
    HealthModule,

    // Business modules
    AuthModule,
    EmployeeModule,
    ProfileModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
