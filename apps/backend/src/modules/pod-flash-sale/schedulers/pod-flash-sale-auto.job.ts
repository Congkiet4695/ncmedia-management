import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PodFlashSaleAutoService } from '../services/pod-flash-sale-auto.service';

/**
 * PodFlashSaleAutoJob — nhịp quét Auto Flash Sale.
 *
 * 🔴 KHÔNG đăng ký một cron cho mỗi tổ chức theo giờ Admin chọn. Giờ chạy là DỮ LIỆU (mỗi tổ
 * chức một giờ, một múi giờ, đổi bất cứ lúc nào), còn cron đăng ký lúc khởi động thì không đổi
 * theo được và mỗi instance sẽ có một bản — chính là "scheduler trùng" cần tránh.
 *
 * Thay vào đó: một nhịp quét ngắn (\`TIKTOK_FLASH_SALE_AUTO_TICK_CRON\`, mặc định mỗi phút) hỏi
 * database "tổ chức nào đã tới mốc chạy mà chưa chạy". Việc giành mốc là một câu so-sánh-và-đổi
 * trong \`PodFlashSaleAutoService.runDueOrganizations\` ⇒ mỗi mốc chạy đúng một lần dù có bao
 * nhiêu instance, và mốc bị lỡ được chạy bù.
 *
 * Cùng khuôn với các scheduler khác của module: tắt được (\`TIKTOK_FLASH_SALE_AUTO_ENABLED\`),
 * mỏng, không bao giờ ném lỗi ra ngoài.
 */
@Injectable()
export class PodFlashSaleAutoJob implements OnModuleInit {
  private readonly logger = new Logger(PodFlashSaleAutoJob.name);

  static readonly JOB_NAME = 'pod-flash-sale-auto';

  /** Chặn chồng nhịp trong cùng tiến trình. Chống trùng GIỮA các instance nằm ở DB + Redis. */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly autoService: PodFlashSaleAutoService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('tiktok.flashSaleAuto.enabled', true);
    const cronExpression = this.config.get<string>('tiktok.flashSaleAuto.tickCron', '* * * * *');

    if (!enabled) {
      this.logger.warn({
        module: 'pod-flash-sale',
        msg: 'Scheduler Auto Flash Sale đang TẮT (TIKTOK_FLASH_SALE_AUTO_ENABLED=false)',
      });
      return;
    }

    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(PodFlashSaleAutoJob.JOB_NAME, job);
      job.start();
      this.logger.log({
        module: 'pod-flash-sale',
        cron: cronExpression,
        msg: 'Đã đăng ký nhịp quét Auto Flash Sale',
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        cron: cronExpression,
        msg: `Không đăng ký được scheduler Auto Flash Sale: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  private async handleTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.autoService.runDueOrganizations();
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        msg: `Nhịp quét Auto Flash Sale lỗi: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    } finally {
      this.running = false;
    }
  }
}
