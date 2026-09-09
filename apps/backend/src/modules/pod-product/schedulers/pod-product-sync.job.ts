import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodProductSyncTrigger } from '@prisma/client';
import { POD_PRODUCT_SYNC_DUE_CRON } from '../constants/pod-product.constants';
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

  /**
   * Tick thứ hai — **worker của hàng đợi đồng bộ hoãn theo shop**.
   *
   * 🔴 Đây KHÔNG phải scheduler thứ hai: cùng một `SchedulerRegistry`, cùng một lớp job,
   * chỉ thêm một cron. Dựng hẳn một scheduler riêng chỉ để chờ 5 phút là thừa — và chính
   * là thứ yêu cầu cấm.
   *
   * Chạy mỗi phút: đủ dày để một lịch hẹn 5 phút lệch tối đa 1 phút, đủ thưa để tick rỗng
   * chỉ tốn đúng một lệnh Redis.
   */
  static readonly DUE_JOB_NAME = 'pod-tiktok-product-sync-due';

  /** Chặn chồng tick của worker hàng đợi (độc lập với lượt quét định kỳ). */
  private runningDue = false;

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

      // Worker hàng đợi hoãn — luôn chạy cùng scheduler, không có cờ bật/tắt riêng: tắt nó
      // nghĩa là lịch hẹn sau publish nằm mãi trong Redis mà không ai lấy ra.
      const dueJob = new CronJob(POD_PRODUCT_SYNC_DUE_CRON, () => {
        void this.handleDueTick();
      });
      this.registry.addCronJob(PodProductSyncJob.DUE_JOB_NAME, dueJob);
      dueJob.start();

      this.logger.log({
        module: 'pod-product',
        cron: POD_PRODUCT_SYNC_DUE_CRON,
        msg: 'Đã đăng ký worker hàng đợi đồng bộ sản phẩm theo shop',
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
   * Một tick của worker hàng đợi: chạy các lượt đồng bộ ĐẾN HẠN.
   *
   * 🔴 Chỉ đụng những shop có tên trong hàng đợi — mỗi shop là một dòng do chính lượt
   * publish của nó tạo ra. Đây là chỗ bảo đảm "publish shop A ⇒ 5 phút sau chỉ sync shop A".
   */
  private async handleDueTick(): Promise<void> {
    if (this.runningDue) return;

    this.runningDue = true;
    try {
      const result = await this.syncService.runDueShopSyncs();
      if (result.shops > 0) {
        this.logger.log({
          module: 'pod-product',
          operation: 'scheduler.due-tick',
          shops: result.shops,
          failed: result.failed,
          msg: 'Đã chạy các lượt đồng bộ sản phẩm đến hạn (theo shop)',
        });
      }
    } catch (error) {
      // Một tick hỏng không được làm chết worker — lịch vẫn nằm trong Redis, tick sau lấy tiếp.
      this.logger.error({
        module: 'pod-product',
        operation: 'scheduler.due-tick',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định ở worker hàng đợi',
      });
    } finally {
      this.runningDue = false;
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
