import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodFlashSaleRetentionService } from '../services/pod-flash-sale-retention.service';

/**
 * PodFlashSaleRetentionJob — lịch dọn `pod_flash_sale_logs` / `pod_flash_sale_items` theo thời hạn lưu.
 *
 * 🔴 An toàn mặc định (docs/pod-flash-sale/retention.md):
 *  - TẮT (`FLASH_SALE_RETENTION_ENABLED=false`) — không đăng ký cron, không chạy gì khi khởi động / deploy.
 *  - Bật rồi vẫn DRY-RUN (`FLASH_SALE_RETENTION_DRY_RUN=true`) cho tới khi đổi rõ ràng.
 *  - Hạng mục không có số ngày giữ (ENV để trống) KHÔNG bị đụng tới.
 *  - Mỗi tick có trần số lô; phần còn lại tick sau làm tiếp. Khoá Redis chặn chạy chồng (cả với CLI).
 */
@Injectable()
export class PodFlashSaleRetentionJob implements OnModuleInit {
  private readonly logger = new Logger(PodFlashSaleRetentionJob.name);

  static readonly JOB_NAME = 'pod-flash-sale-retention';

  /** Chặn chồng tick trong cùng tiến trình (lớp trước khoá Redis). */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly retention: PodFlashSaleRetentionService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('flashSaleRetention.enabled', false);
    if (!enabled) {
      this.logger.log({
        module: 'pod-flash-sale',
        msg: 'Retention Flash Sale đang TẮT (FLASH_SALE_RETENTION_ENABLED=false)',
      });
      return;
    }

    const cronExpression = this.config.get<string>('flashSaleRetention.cron', '30 3 * * *');
    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodFlashSaleRetentionJob.JOB_NAME, job);
      job.start();
      this.logger.log({
        module: 'pod-flash-sale',
        cron: cronExpression,
        dryRun: this.retention.configuredOptions().dryRun,
        msg: 'Đã đăng ký lịch retention Flash Sale',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        cron: cronExpression,
        msg: `Không đăng ký được lịch retention: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  /** Một tick — không bao giờ ném lỗi ra ngoài (kết quả / lỗi đã được service ghi log). */
  async handleTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.retention.run(this.retention.configuredOptions());
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'retention.tick',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định ở tick retention',
      });
    } finally {
      this.running = false;
    }
  }
}
