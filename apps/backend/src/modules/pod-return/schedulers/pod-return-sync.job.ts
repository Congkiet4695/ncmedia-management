import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodReturnSyncService } from '../services/pod-return-sync.service';

/**
 * PodReturnSyncJob — đồng bộ Return/Refund định kỳ cho mọi shop đủ điều kiện.
 *
 * Cùng khuôn với `PodOrderSyncJob`: cron động qua `SchedulerRegistry`, tắt được
 * (`TIKTOK_RETURN_SYNC_ENABLED`), mỏng, không bao giờ ném lỗi ra ngoài. Chống chạy trùng giữa các
 * instance nằm ở khoá Redis của service (toàn cục + theo shop).
 */
@Injectable()
export class PodReturnSyncJob implements OnModuleInit {
  private readonly logger = new Logger(PodReturnSyncJob.name);

  static readonly JOB_NAME = 'pod-tiktok-return-sync';

  /** Chặn chồng nhịp trong cùng tiến trình. */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly sync: PodReturnSyncService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.returnSync.enabled', false);
    const cronExpression = this.config.get<string>('tiktok.returnSync.cron', '*/15 * * * *');
    if (!enabled) {
      this.logger.warn({
        module: 'pod-return',
        msg: 'Scheduler Return/Refund đang TẮT (TIKTOK_RETURN_SYNC_ENABLED=false)',
      });
      return;
    }
    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodReturnSyncJob.JOB_NAME, job);
      job.start();
      this.logger.log({ module: 'pod-return', cron: cronExpression, msg: 'Đã đăng ký đồng bộ Return/Refund' });
    } catch (error) {
      this.logger.error({
        module: 'pod-return',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler Return/Refund: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  private async handleTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync.runAll();
    } catch (error) {
      this.logger.error({
        module: 'pod-return',
        msg: `Lượt đồng bộ Return/Refund lỗi: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    } finally {
      this.running = false;
    }
  }
}
