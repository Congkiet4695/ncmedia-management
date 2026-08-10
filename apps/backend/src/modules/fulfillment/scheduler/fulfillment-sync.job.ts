import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FulfillmentTrigger } from '@prisma/client';
import { MangoWebhookService } from '../mango/webhook/mango-webhook.service';
import { FulfillmentSyncService } from '../services/fulfillment-sync.service';

/**
 * FulfillmentSyncJob — lớp lịch cho đồng bộ trạng thái fulfillment.
 *
 * Thiết kế giống scheduler của module POD để vận hành nhất quán:
 *  - **Không hardcode cron**: lấy từ ENV `FULFILLMENT_SYNC_CRON` (mặc định mỗi 5 phút).
 *    Vì là giá trị động nên đăng ký qua `SchedulerRegistry` thay vì decorator `@Cron`.
 *  - **Tắt được**: `FULFILLMENT_SYNC_ENABLED=false`.
 *  - **Mỏng**: không chứa nghiệp vụ, chỉ kích hoạt service.
 *  - **Không bao giờ ném lỗi ra ngoài**: lỗi làm hỏng tick sẽ khiến scheduler dừng hẳn.
 */
@Injectable()
export class FulfillmentSyncJob implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentSyncJob.name);

  static readonly JOB_NAME = 'fulfillment-status-sync';

  /** Chặn chồng lịch trong cùng tiến trình (lớp bảo vệ trước khoá Redis). */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly syncService: FulfillmentSyncService,
    private readonly webhookService: MangoWebhookService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('fulfillment.sync.enabled', false)) {
      this.logger.warn({
        module: 'fulfillment',
        msg: 'Scheduler đồng bộ fulfillment đang TẮT (FULFILLMENT_SYNC_ENABLED=false)',
      });
      return;
    }

    const cronExpression = this.config.get<string>('fulfillment.sync.cron', '*/5 * * * *');
    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(FulfillmentSyncJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'fulfillment',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đồng bộ trạng thái fulfillment',
      });
    } catch (error) {
      // Cron sai cú pháp không được phép làm sập ứng dụng.
      this.logger.error({
        module: 'fulfillment',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler: ${(error as Error).message}`,
      });
    }
  }

  /** Một nhịp: thử lại webhook tồn đọng TRƯỚC, rồi mới hỏi trạng thái. */
  private async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'sync.tick',
        msg: 'Nhịp trước chưa xong — bỏ qua nhịp hiện tại',
      });
      return;
    }

    this.running = true;
    try {
      // Webhook đã nhận nhưng xử lý lỗi thường phản ánh trạng thái MỚI NHẤT,
      // xử lý trước để lượt hỏi trạng thái phía sau không phải gọi lại API cho cùng đơn.
      await this.webhookService.retryPending();
      await this.syncService.runAll(FulfillmentTrigger.CRON);
    } catch (error) {
      this.logger.error({
        module: 'fulfillment',
        operation: 'sync.tick',
        msg: `Lượt đồng bộ theo lịch thất bại: ${(error as Error).message}`,
      });
    } finally {
      this.running = false;
    }
  }
}
