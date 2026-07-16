import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PlatformResponseDto } from './dto/platform-response.dto';

/** PlatformService — đọc danh mục Platform Global (ADR-011). */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive(): Promise<PlatformResponseDto[]> {
    const rows = await this.prisma.platform.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  }
}
