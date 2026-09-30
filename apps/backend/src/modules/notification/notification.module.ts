import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { TelegramBotClient } from './clients/telegram-bot.client';
import { NotificationController } from './controllers/notification.controller';
import { NotificationEventRepository } from './repositories/notification-event.repository';
import { TelegramConfigRepository } from './repositories/telegram-config.repository';
import { NotificationDispatchJob } from './scheduler/notification-dispatch.job';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationEncryptionService } from './services/notification-encryption.service';
import { NotificationOutboxService } from './services/notification-outbox.service';
import { TelegramConfigService } from './services/telegram-config.service';

/**
 * NotificationModule — thông báo Telegram theo Organization (docs/notification/README.md).
 *
 * ```
 *   PodTiktok (tạo đơn) ─┐                    ┌─ NotificationDispatcherService (worker, cron + kick)
 *                        ├─▶ NotificationOutboxService ─▶ notification_events ─┤
 *   Fulfillment (gửi/huỷ)┘                    └─▶ TelegramBotClient ─▶ Telegram Bot API
 * ```
 *
 * Chiều phụ thuộc MỘT chiều: module nghiệp vụ import module này; module này KHÔNG import module
 * nghiệp vụ nào (payload là ảnh chụp do bên phát dựng) ⇒ không có vòng phụ thuộc Nest.
 * Chỉ export `NotificationOutboxService` — không module nào khác được gọi Telegram trực tiếp.
 */
@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [NotificationController],
  providers: [
    TelegramBotClient,
    NotificationEncryptionService,
    TelegramConfigRepository,
    NotificationEventRepository,
    NotificationDispatcherService,
    NotificationOutboxService,
    TelegramConfigService,
    NotificationDispatchJob,
  ],
  exports: [NotificationOutboxService],
})
export class NotificationModule {}
