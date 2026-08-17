import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodProductSyncTrigger } from '@prisma/client';
import { PodProductSyncService } from '../services/pod-product-sync.service';

/**
 * PodProductSyncJob — lịch đồng bộ sản phẩm TikTok.
 *
 * Cùng khuôn với `PodOrderSyncJob` (nhất quán vận hành):
 *  - **Không hardcode cron**: lấy từ ENV `TIKTOK_PRODUCT_SYNC_CRON` (mặc định mỗi 6 giờ —
 *    sản phẩm đổi chậm hơn đơn hàng rất nhiều, quét dày chỉ tốn quota).
 *  - **Tắt được**: `TIKTOK_PRODUCT_SYNC_ENABLED=false` (mặc định ở dev).
 *  - **Mỏng**: chỉ kích hoạt, nghiệp vụ nằm ở `PodProductSyncService` ⇒ chuyển sang hàng
 *    đợi sau này không phải sửa nghiệp vụ.
 *  - **Không bao giờ ném lỗi ra ngoài**: một tick lỗi không được làm chết scheduler.
 */
@Injectable()
export class PodProductSyncJob implements OnModuleInit {
  private readonly logger = new Logger(PodProductSyncJob.name);

  static readonly JOB_NAME = 'pod-tiktok-product-sync';

  /** Chặn chồng lịch trong cùng tiến trình (lớp bảo vệ trước khoá Redis theo shop). */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly syncService: PodProductSyncService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.productSync.enabled', false);
    const cronExpression = this.config.get<string>('tiktok.productSync.cron', '0 */6 * * *');

    if (!enabled) {
      this.logger.warn({
        module: 'pod-product',
        msg: 'Scheduler đồng bộ sản phẩm đang TẮT (TIKTOK_PRODUCT_SYNC_ENABLED=false)',
      });
      return;
    }

    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodProductSyncJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'pod-product',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đồng bộ sản phẩm TikTok',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-product',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  /**
   * Một tick: đồng bộ TĂNG DẦN cho MỌI shop đủ điều kiện, mọi tổ chức.
   *
   * 🔴 Không lọc theo tổ chức: đây là tiến trình nền của hệ thống (Public App phục vụ
   * nhiều seller), tenant được lấy từ chính bản ghi shop — đúng nguyên tắc P5.
   */
  private async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn({
        module: 'pod-product',
        msg: 'Lượt đồng bộ sản phẩm trước chưa xong — bỏ qua tick này',
      });
      return;
    }

    this.running = true;
    try {
      const outcomes = await this.syncService.syncShops(
        {},
        { trigger: PodProductSyncTrigger.SCHEDULER },
      );

      this.logger.log({
        module: 'pod-product',
        operation: 'scheduler.tick',
        shops: outcomes.length,
        created: outcomes.reduce((sum, item) => sum + item.created, 0),
        updated: outcomes.reduce((sum, item) => sum + item.updated, 0),
        failed: outcomes.reduce((sum, item) => sum + item.failed, 0),
        msg: 'Hoàn tất một lượt đồng bộ sản phẩm theo lịch',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-product',
        operation: 'scheduler.tick',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định ở tick đồng bộ sản phẩm',
      });
    } finally {
      this.running = false;
    }
  }
}
