import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * PrismaService & RedisService là global (được export bởi module tương ứng),
 * nên chỉ cần khai báo controller ở đây.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
