import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { ValidationError } from 'class-validator';

import { AppModule } from './app.module';
import { ApiErrorItem } from './common/interfaces/api-response.interface';

/**
 * Chuyển lỗi validate của class-validator thành errors[] chuẩn (ADR-022),
 * bọc trong BadRequestException để AllExceptionsFilter format envelope.
 */
function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const flatten = (list: ValidationError[]): ApiErrorItem[] =>
    list.flatMap((err) => {
      const own: ApiErrorItem[] = err.constraints
        ? Object.values(err.constraints).map((message) => ({ field: err.property, message }))
        : [];
      const children = err.children?.length ? flatten(err.children) : [];
      return [...own, ...children];
    });

  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Dữ liệu không hợp lệ',
    errors: flatten(errors),
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger (pino) làm logger toàn cục
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('apiPrefix', 'api/v1');
  const port = config.get<number>('port', 3000);

  // Security
  app.use(helmet());
  app.enableCors({
    origin: config.get<string>('corsOrigin', '*'),
    credentials: true,
    // Cho phép FE đọc tên file do server đặt (export Excel: employees_YYYYMMDD_HHmmss.xlsx).
    exposedHeaders: ['Content-Disposition'],
  });

  // Prefix + shutdown hooks
  app.setGlobalPrefix(apiPrefix);
  app.enableShutdownHooks();

  // ValidationPipe toàn cục
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Swagger
  if (config.get<boolean>('swagger.enabled', true)) {
    const swaggerPath = config.get<string>('swagger.path', 'docs');
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NCMedia Management Platform API')
      .setDescription('Backend API — Modular Monolith, Multi-Tenant (REST /api/v1)')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/${swaggerPath}`, app, document);
  }

  await app.listen(port);
  app.get(Logger).log(`🚀 API listening on port ${port} (prefix: /${apiPrefix})`);
}

void bootstrap();
