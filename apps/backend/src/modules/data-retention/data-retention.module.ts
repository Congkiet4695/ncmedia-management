import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DistributedLockService } from '../pod-tiktok/infra/distributed-lock.service';
import { DataRetentionJob } from './schedulers/data-retention.job';
import { DataRetentionService } from './services/data-retention.service';

/**
 * DataRetentionModule — cơ chế dọn dữ liệu hết hạn TẬP TRUNG (docs/data-retention.md).
 *
 * Gom các chính sách lưu theo NGÀY của nhiều module vào một lịch, một bộ khoá, một khuôn báo cáo:
 * Recent Notifications (giữ hôm nay), Publish History và Draft Listings (giữ 7 ngày).
 *
 * 🔴 Retention Flash Sale (`PodFlashSaleRetentionService`) giữ nguyên ở module của nó: chính sách của
 * nó đo theo trạng thái ĐỢT SALE đã đóng (không theo ngày lịch) và đã có CLI / ENV / tài liệu riêng
 * đang dùng trên production. Hai cơ chế không chạm cùng một bảng.
 *
 * Module chỉ phụ thuộc Prisma + Redis (@Global). `DistributedLockService` là lớp mỏng không trạng thái
 * trên Redis — khai trực tiếp thay vì kéo cả PodTiktokModule vào chỉ để lấy một khoá.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [DataRetentionService, DataRetentionJob, DistributedLockService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
