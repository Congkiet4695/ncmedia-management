import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodSyncTrigger } from '@prisma/client';
import { PodSyncOrchestratorService } from '../services/pod-sync-orchestrator.service';

/**
 * PodOrderSyncJob — lớp lịch (scheduler) cho đồng bộ đơn TikTok.
 *
 * Thiết kế:
 *  - **Không hardcode cron**: biểu thức lấy từ ENV `TIKTOK_SYNC_CRON` (mặc định: mỗi 5 phút).
 *    Vì cron là giá trị động, job được đăng ký thủ công qua `SchedulerRegistry`
 *    thay vì decorator `@Cron` (decorator yêu cầu hằng số tại thời điểm biên dịch).
 *  - **Tắt được**: `TIKTOK_SYNC_ENABLED=false` thì không đăng ký job (mặc định ở dev).
 *  - **Mỏng**: toàn bộ nghiệp vụ nằm ở `PodSyncOrchestratorService` — lớp này chỉ kích hoạt,
 *    nhờ vậy có thể chuyển sang hàng đợi (BullMQ) sau này mà không sửa business logic.
 *  - **Không bao giờ ném lỗi ra ngoài**: lỗi làm hỏng tick sẽ khiến scheduler dừng.
 */
@Injectable()
export class PodOrderSyncJob implements OnModuleInit {
  private readonly logger = new Logger(PodOrderSyncJob.name);

  /** Tên job trong SchedulerRegistry — dùng để kiểm tra/điều khiển khi vận hành. */
  static readonly JOB_NAME = 'pod-tiktok-order-sync';

  /** Chặn chồng lịch ngay trong cùng một tiến trình (lớp bảo vệ trước khoá Redis). */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly orchestrator: PodSyncOrchestratorService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.sync.enabled', false);
    const cronExpression = this.config.get<string>('tiktok.sync.cron', '*/5 * * * *');

    if (!enabled) {
      this.logger.warn({
        module: 'pod-tiktok',
        msg: 'Scheduler đồng bộ đơn TikTok đang TẮT (TIKTOK_SYNC_ENABLED=false)',
      });
      return;
    }

    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodOrderSyncJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'pod-tiktok',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đồng bộ đơn TikTok',
      });
    } catch (error) {
      // Cron sai cú pháp không được phép làm sập ứng dụng — chỉ tắt tính năng và báo lỗi.
      this.logger.error({
        module: 'pod-tiktok',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler: ${(error as Error).message}`,
      });
    }
  }

  /** Một nhịp cron. Luôn nuốt lỗi để scheduler không bị dừng. */
  private async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'sync.tick',
        msg: 'Nhịp trước chưa xong trong tiến trình này — bỏ qua nhịp hiện tại',
      });
      return;
    }

    this.running = true;
    try {
      await this.orchestrator.runAll(PodSyncTrigger.CRON);
    } catch (error) {
      this.logger.error({
        module: 'pod-tiktok',
        operation: 'sync.tick',
        msg: `Lượt đồng bộ theo lịch thất bại: ${(error as Error).message}`,
      });
    } finally {
      this.running = false;
    }
  }
}
