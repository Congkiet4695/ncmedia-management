import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodListingReviewService } from '../services/pod-listing-review.service';

/**
 * PodListingReviewJob — lịch đọc lại **trạng thái duyệt** của listing đã publish.
 *
 * Cùng khuôn với `PodProductSyncJob` / `PodOrderSyncJob` (nhất quán vận hành):
 *  - **Không hardcode cron**: lấy từ ENV `TIKTOK_LISTING_REVIEW_CRON`. Mặc định **5 phút/lần**
 *    đúng theo yêu cầu sprint — trạng thái duyệt đổi trong vài phút tới vài giờ, quét dày hơn
 *    chỉ đốt quota mà không biết sớm hơn.
 *  - **Tắt được**: `TIKTOK_LISTING_REVIEW_ENABLED=false`.
 *  - **Mỏng**: chỉ kích hoạt; toàn bộ nghiệp vụ nằm ở `PodListingReviewService.tick()`.
 *  - **Không bao giờ ném lỗi ra ngoài**: một tick lỗi không được làm chết scheduler.
 */
@Injectable()
export class PodListingReviewJob implements OnModuleInit {
  private readonly logger = new Logger(PodListingReviewJob.name);

  static readonly JOB_NAME = 'pod-listing-review-sync';

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly review: PodListingReviewService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.listingReview.enabled', true);
    const cronExpression = this.config.get<string>('tiktok.listingReview.cron', '*/5 * * * *');

    if (!enabled) {
      this.logger.warn({
        module: 'pod-listing',
        msg: 'Scheduler đọc trạng thái duyệt đang TẮT (TIKTOK_LISTING_REVIEW_ENABLED=false)',
      });
      return;
    }

    try {
      const job = new CronJob(cronExpression, () => {
        void this.review.tick();
      });
      this.registry.addCronJob(PodListingReviewJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'pod-listing',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đọc trạng thái duyệt listing',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-listing',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }
}
