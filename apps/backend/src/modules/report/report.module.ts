import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportController } from './report.controller';
import { ReportRepository } from './repositories/report.repository';
import { ReportService } from './services/report.service';

/**
 * ReportModule — Báo cáo thống kê (Dashboard + Reports). PrismaModule là @Global nên
 * không cần import lại. AuthModule cung cấp guard/permission cho controller.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService, ReportRepository],
})
export class ReportModule {}
