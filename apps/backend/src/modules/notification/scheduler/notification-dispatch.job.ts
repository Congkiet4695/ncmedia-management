import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';

/**
 * NotificationDispatchJob — nhịp định kỳ của worker gửi thông báo.
 *
 * Cùng khuôn với scheduler của POD / Fulfillment:
 *  - Cron lấy từ ENV `NOTIFICATION_DISPATCH_CRON` (mặc định mỗi 15 giây, cron 6 trường có giây) nên
 *    đăng ký qua `SchedulerRegistry` thay vì decorator `@Cron`.
 *  - Tắt được: `NOTIFICATION_DISPATCH_ENABLED=false`.
 *  - Mỏng: chỉ kích hoạt `NotificationDispatcherService` (vốn không ném lỗi).
 *
 * Đây là LƯỚI AN TOÀN: đường chính là `kick()` ngay sau khi ghi sự kiện. Nhịp cron nhặt sự kiện
 * hẹn lại (retry), sự kiện của worker đã chết (lease hết hạn) và sự kiện còn tồn sau khi restart.
 * Chạy trên nhiều instance là an toàn — claim dùng `FOR UPDATE SKIP LOCKED`.
 */
@Injectable()
export class NotificationDispatchJob implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatchJob.name);

  static readonly JOB_NAME = 'notification-dispatch';

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('notification.dispatch.enabled', true)) {
      this.logger.warn({
        module: 'notification',
        msg: 'Worker gửi thông báo đang TẮT (NOTIFICATION_DISPATCH_ENABLED=false)',
      });
      return;
    }
    const cronExpression = this.config.get<string>('notification.dispatch.cron', '*/15 * * * * *');
    try {
      const job = new CronJob(cronExpression, () => {
        void this.dispatcher.runOnce();
      });
      this.registry.addCronJob(NotificationDispatchJob.JOB_NAME, job);
      job.start();
      this.logger.log({
        module: 'notification',
        cron: cronExpression,
        msg: 'Đã đăng ký worker gửi thông báo',
      });
    } catch (error) {
      // Cron sai cú pháp không được làm sập ứng dụng — chỉ tắt nhịp định kỳ và báo lỗi.
      this.logger.error({
        module: 'notification',
        cron: cronExpression,
        msg: `Không đăng ký được worker gửi thông báo: ${(error as Error).message}`,
      });
    }
  }
}
