import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { PodReturnController } from './pod-return.controller';
import { PodReturnRepository } from './repositories/pod-return.repository';
import { PodReturnSyncJob } from './schedulers/pod-return-sync.job';
import { PodReturnSyncService } from './services/pod-return-sync.service';
import { PodReturnService } from './services/pod-return.service';

/**
 * PodReturnModule — Return Orders (TikTok Return & Refund, scope `seller.return_refund.basic`).
 *
 * Phụ thuộc MỘT CHIỀU:
 * ```
 *   PodReturnModule ──▶ PodTiktokModule     (phạm vi shop, token / shop_cipher, khoá, trạng thái đồng bộ)
 *                   ──▶ NotificationModule  (outbox — sự kiện RETURN_REFUND_REQUEST)
 *                   ──▶ TikTokSdkModule     (@Global — TiktokReturnRefundApiService)
 * ```
 */
@Module({
  imports: [AuthModule, PodTiktokModule, NotificationModule, ScheduleModule.forRoot()],
  controllers: [PodReturnController],
  providers: [PodReturnRepository, PodReturnService, PodReturnSyncService, PodReturnSyncJob],
})
export class PodReturnModule {}
