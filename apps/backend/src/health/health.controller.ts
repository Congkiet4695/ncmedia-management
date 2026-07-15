import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

type CheckState = 'up' | 'down';

/**
 * Health Check nhẹ (không phụ thuộc phiên bản Terminus).
 *  - GET /health        : liveness (tiến trình còn sống)
 *  - GET /health/ready  : readiness (DB + Redis sẵn sàng)
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  liveness(): { status: string; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (database + redis)' })
  async readiness(): Promise<{ status: string; checks: Record<string, CheckState> }> {
    const checks: Record<string, CheckState> = { database: 'up', redis: 'up' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.database = 'down';
    }

    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') checks.redis = 'down';
    } catch {
      checks.redis = 'down';
    }

    const healthy = Object.values(checks).every((s) => s === 'up');
    if (!healthy) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'One or more dependencies are not ready',
        errors: Object.entries(checks)
          .filter(([, s]) => s === 'down')
          .map(([field]) => ({ field, message: 'down' })),
      });
    }

    return { status: 'ok', checks };
  }
}
