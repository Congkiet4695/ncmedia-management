import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { businessDayOf } from '../../../common/time/business-time';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  DATA_RETENTION_DAILY_TICK_PREFIX,
  DATA_RETENTION_DAILY_TICK_TTL_MS,
  DATA_RETENTION_DEFAULT_CRON,
} from '../constants/data-retention.constants';
import { DataRetentionService } from '../services/data-retention.service';

/**
 * DataRetentionJob — lịch dọn dữ liệu hết hạn (Recent Notifications · Publish History · Draft Listings).
 *
 * 🔴 An toàn mặc định (docs/data-retention.md):
 *  - TẮT (`DATA_RETENTION_ENABLED=false`) — không đăng ký cron, KHÔNG chạy gì khi khởi động / deploy.
 *  - Bật rồi vẫn DRY-RUN (`DATA_RETENTION_DRY_RUN=true`) cho tới khi đổi rõ ràng — kiểm cutoff trước.
 *  - Cron chạy theo MÚI GIỜ NGHIỆP VỤ (`APP_BUSINESS_TIMEZONE`), mặc định 00:20 — ngay sau khi sang ngày.
 *  - Nhiều replica: mỗi ngày nghiệp vụ chỉ MỘT replica chạy (khoá `data-retention:tick:<ngày>`), và mỗi
 *    tác vụ còn có khoá riêng (chặn chồng với CLI).
 */
@Injectable()
export class DataRetentionJob implements OnModuleInit {
  private readonly logger = new Logger(DataRetentionJob.name);

  static readonly JOB_NAME = 'data-retention';

  /** Chặn chồng tick trong cùng tiến trình (lớp trước khoá Redis). */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly retention: DataRetentionService,
    private readonly locks: DistributedLockService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('dataRetention.enabled', false)) {
      this.logger.log({
        module: 'data-retention',
        msg: 'Retention dữ liệu đang TẮT (DATA_RETENTION_ENABLED=false)',
      });
      return;
    }

    const cronExpression = this.config.get<string>(
      'dataRetention.cron',
      DATA_RETENTION_DEFAULT_CRON,
    );
    const { timeZone, dryRun, tasks } = this.retention.configuredOptions();
    try {
      const job = CronJob.from({
        cronTime: cronExpression,
        timeZone,
        onTick: () => void this.handleTick(),
      });
      this.registry.addCronJob(DataRetentionJob.JOB_NAME, job);
      job.start();
      this.logger.log({
        module: 'data-retention',
        cron: cronExpression,
        timeZone,
        dryRun,
        tasks,
        msg: 'Đã đăng ký lịch retention dữ liệu',
      });
    } catch (error) {
      // Cron sai cú pháp không được làm sập ứng dụng — chỉ tắt lịch và báo lỗi.
      this.logger.error({
        module: 'data-retention',
        cron: cronExpression,
        msg: `Không đăng ký được lịch retention: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  /** Một tick — không bao giờ ném lỗi ra ngoài (kết quả / lỗi đã được service ghi log). */
  async handleTick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const options = this.retention.configuredOptions();
      const day = businessDayOf(now, options.timeZone);
      // Giành "lượt của hôm nay" — replica khác bắn cron cùng lúc sẽ thấy khoá và bỏ qua.
      const claimed = await this.locks.acquire(
        `${DATA_RETENTION_DAILY_TICK_PREFIX}${day}`,
        DATA_RETENTION_DAILY_TICK_TTL_MS,
      );
      if (!claimed) {
        this.logger.log({
          module: 'data-retention',
          day,
          msg: 'Lượt retention hôm nay đã do replica khác chạy',
        });
        return;
      }
      await this.retention.run({ ...options, now });
    } catch (error) {
      this.logger.error({
        module: 'data-retention',
        operation: 'retention.tick',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định ở tick retention',
      });
    } finally {
      this.running = false;
    }
  }
}
