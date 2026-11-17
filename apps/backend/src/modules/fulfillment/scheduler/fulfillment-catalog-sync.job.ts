import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { FulfillmentProvider } from '@prisma/client';
import { CronJob } from 'cron';
import { FulfillmentCatalogSyncService } from '../services/fulfillment-catalog-sync.service';
import { ProductMappingAutoService } from '../services/product-mapping-auto.service';

/**
 * FulfillmentCatalogSyncJob — lớp lịch cho việc kéo danh mục nhà cung cấp về Database.
 *
 * Giữ đúng khuôn của các scheduler khác trong dự án:
 *  - **Không hardcode cron**: lấy từ ENV `FULFILLMENT_CATALOG_SYNC_CRON`. Vì là giá trị động
 *    nên đăng ký qua `SchedulerRegistry` thay vì decorator `@Cron`.
 *  - **Tắt được**: `FULFILLMENT_CATALOG_SYNC_ENABLED=false`.
 *  - **Mỏng**: không chứa nghiệp vụ, chỉ kích hoạt service.
 *  - **Không bao giờ ném lỗi ra ngoài**: lỗi làm hỏng tick sẽ khiến scheduler dừng hẳn.
 *
 * 🔴 HAI lịch, đều theo **UTC** (truyền `timeZone` tường minh — không phụ thuộc múi giờ máy chủ):
 *  - `FULFILLMENT_CATALOG_SYNC_CRON` (mặc định mỗi 6 giờ: 00/06/12/18 UTC): mọi nhà cung cấp TRỪ Sellerwix (Mango, Pressify) —
 *    giữ nguyên hành vi cũ.
 *  - `FULFILLMENT_CATALOG_SYNC_SELLERWIX_CRON` (mặc định `0 0 * * *` = 1 lần/ngày): Sellerwix, qua
 *    `syncSellerwixAccounts` (đọc một lần cho mỗi nhóm thông tin xác thực, bỏ qua tài khoản đã đồng bộ trong ngày).
 *    Production 2026-11: đồng bộ danh mục Sellerwix 4 lần/ngày trùng khớp với MỌI lần tạo đơn Sellerwix nhận 429.
 * Danh mục gần như tĩnh; cần dữ liệu mới ngay thì bấm đồng bộ thủ công (không bị ảnh hưởng bởi lịch).
 *
 * 🔴 Rà ánh xạ tự động chạy NGAY SAU khi đồng bộ xong: danh mục vừa có thêm sản phẩm mới thì
 * những dòng hàng trước đó không tìm được nay có thể ánh xạ được. Không làm bước này thì
 * người dùng phải đợi tới lượt đồng bộ ĐƠN kế tiếp mới thấy kết quả.
 */
@Injectable()
export class FulfillmentCatalogSyncJob implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentCatalogSyncJob.name);

  static readonly JOB_NAME = 'fulfillment-catalog-sync';

  static readonly SELLERWIX_JOB_NAME = 'fulfillment-catalog-sync-sellerwix';

  /** Lịch luôn chạy theo UTC (khung giờ báo cáo / đối soát 429 đều theo UTC). */
  static readonly TIME_ZONE = 'UTC';

  /** Chặn chồng lịch trong cùng tiến trình — một lượt có thể chạy rất lâu. Mỗi lịch một cờ. */
  private running = false;
  private sellerwixRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly catalogSync: FulfillmentCatalogSyncService,
    private readonly autoMap: ProductMappingAutoService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('fulfillment.catalogSync.enabled', false)) {
      this.logger.warn({
        module: 'fulfillment',
        msg: 'Scheduler đồng bộ danh mục đang TẮT (FULFILLMENT_CATALOG_SYNC_ENABLED=false)',
      });
      return;
    }

    this.register(
      FulfillmentCatalogSyncJob.JOB_NAME,
      this.config.get<string>('fulfillment.catalogSync.cron', '0 */6 * * *'),
      () => this.handleTick(),
      'Mango, Pressify (mọi nhà cung cấp trừ Sellerwix)',
    );
    this.register(
      FulfillmentCatalogSyncJob.SELLERWIX_JOB_NAME,
      this.config.get<string>('fulfillment.catalogSync.sellerwixCron', '0 0 * * *'),
      () => this.handleSellerwixTick(),
      'Sellerwix',
    );
  }

  private register(name: string, cronExpression: string, onTick: () => Promise<void>, scope: string): void {
    try {
      const job = CronJob.from({
        cronTime: cronExpression,
        onTick: () => {
          void onTick();
        },
        timeZone: FulfillmentCatalogSyncJob.TIME_ZONE,
        start: false,
      });
      this.registry.addCronJob(name, job);
      job.start();

      this.logger.log({
        module: 'fulfillment',
        job: name,
        cron: cronExpression,
        timeZone: FulfillmentCatalogSyncJob.TIME_ZONE,
        scope,
        msg: 'Đã đăng ký scheduler đồng bộ danh mục nhà cung cấp',
      });
    } catch (error) {
      // Cron sai cú pháp không được phép làm sập ứng dụng.
      this.logger.error({
        module: 'fulfillment',
        job: name,
        cron: cronExpression,
        msg: `Không đăng ký được scheduler danh mục: ${(error as Error).message}`,
      });
    }
  }

  private async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.sync.tick',
        msg: 'Nhịp trước chưa xong — bỏ qua nhịp hiện tại',
      });
      return;
    }

    this.running = true;
    try {
      const result = await this.catalogSync.syncAllAccounts({
        excludeProviders: [FulfillmentProvider.SELLERWIX],
      });
      this.logger.log({
        module: 'fulfillment',
        operation: 'catalog.sync.tick',
        ...result,
        msg: `Đồng bộ danh mục theo lịch: ${result.succeeded}/${result.accounts} tài khoản thành công`,
      });

      // Danh mục vừa đổi ⇒ rà lại những sản phẩm chưa ánh xạ được.
      const mapped = await this.autoMap.resolveAll();
      this.logger.log({
        module: 'fulfillment',
        operation: 'catalog.sync.tick.automap',
        ...mapped,
        msg: `Rà ánh xạ tự động sau đồng bộ danh mục: tạo mới ${mapped.autoMapped} ánh xạ`,
      });
    } catch (error) {
      this.logger.error({
        module: 'fulfillment',
        operation: 'catalog.sync.tick',
        msg: `Lượt đồng bộ danh mục theo lịch thất bại: ${(error as Error).message}`,
      });
    } finally {
      this.running = false;
    }
  }

  /** Lịch Sellerwix (1 lần/ngày): đọc danh mục một lần cho mỗi nhóm thông tin xác thực, rồi rà ánh xạ tự động. */
  private async handleSellerwixTick(): Promise<void> {
    if (this.sellerwixRunning) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.sync.sellerwix.tick',
        msg: 'Lượt Sellerwix trước chưa xong — bỏ qua nhịp hiện tại',
      });
      return;
    }

    this.sellerwixRunning = true;
    try {
      const result = await this.catalogSync.syncSellerwixAccounts();
      this.logger.log({
        module: 'fulfillment',
        operation: 'catalog.sync.sellerwix.tick',
        ...result,
        msg: `Đồng bộ danh mục Sellerwix theo lịch: ${result.succeeded}/${result.accounts} tài khoản, ${result.fetches} lần đọc API`,
      });
      const mapped = await this.autoMap.resolveAll();
      this.logger.log({
        module: 'fulfillment',
        operation: 'catalog.sync.sellerwix.tick.automap',
        ...mapped,
        msg: `Rà ánh xạ tự động sau đồng bộ danh mục Sellerwix: tạo mới ${mapped.autoMapped} ánh xạ`,
      });
    } catch (error) {
      this.logger.error({
        module: 'fulfillment',
        operation: 'catalog.sync.sellerwix.tick',
        msg: `Lượt đồng bộ danh mục Sellerwix theo lịch thất bại: ${(error as Error).message}`,
      });
    } finally {
      this.sellerwixRunning = false;
    }
  }
}
