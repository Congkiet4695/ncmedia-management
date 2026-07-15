import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global để mọi module dùng chung một PrismaService (kết nối duy nhất).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
