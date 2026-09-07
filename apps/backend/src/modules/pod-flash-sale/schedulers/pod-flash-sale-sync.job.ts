import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodFlashSaleSyncService } from '../services/pod-flash-sale-sync.service';

/**
 * PodFlashSaleSyncJob — lịch đọc lại trạng thái Flash Sale từ TikTok.
 *
 * Cùng khuôn với `PodProductSyncJob` và `PodListingReviewJob` (nhất quán vận hành):
 *  - **Không hardcode cron**: `TIKTOK_FLASH_SALE_SYNC_CRON`, mặc định 5 phút/lần. Khớp với
 *    chu kỳ tự làm mới 30 giây của giao diện: màn hình đọc DB, scheduler mới là nơi hỏi sàn,
 *    nên tăng tần suất ở giao diện KHÔNG kéo theo một request nào tới TikTok.
 *  - **Tắt được**: `TIKTOK_FLASH_SALE_SYNC_ENABLED=false`.
 *  - **Mỏng**: chỉ kích hoạt; nghiệp vụ nằm ở `PodFlashSaleSyncService`.
 *  - **Không bao giờ ném lỗi ra ngoài**: một tick hỏng không được làm chết scheduler.
 */
@Injectable()
export class PodFlashSaleSyncJob implements OnModuleInit {
  private readonly logger = new Logger(PodFlashSaleSyncJob.name);

  static readonly JOB_NAME = 'pod-flash-sale-sync';

  /** Chặn chồng lịch trong cùng tiến trình — một lượt chậm không được kéo theo lượt thứ hai. */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly syncService: PodFlashSaleSyncService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.flashSaleSync.enabled', true);
    const cronExpression = this.config.get<string>('tiktok.flashSaleSync.cron', '*/5 * * * *');

    if (!enabled) {
      this.logger.warn({
        module: 'pod-flash-sale',
        msg: 'Scheduler đồng bộ Flash Sale đang TẮT (TIKTOK_FLASH_SALE_SYNC_ENABLED=false)',
      });
      return;
    }

    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodFlashSaleSyncJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'pod-flash-sale',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đồng bộ trạng thái Flash Sale',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  /** Một tick: đóng đợt hết giờ + hỏi lại TikTok cho các đợt còn đang chạy. */
  private async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn({
        module: 'pod-flash-sale',
        msg: 'Bỏ qua tick vì lượt trước chưa xong',
      });
      return;
    }

    this.running = true;
    try {
      await this.syncService.syncDueFlashSales();
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        msg: `Tick đồng bộ Flash Sale lỗi: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    } finally {
      this.running = false;
    }
  }
}
