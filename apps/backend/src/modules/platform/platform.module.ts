import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * PlatformModule — danh mục Platform Global (ADR-011). Import AuthModule để dùng JwtAuthGuard.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
