import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
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
 * 🔴 Mặc định chạy mỗi 6 giờ, thưa hơn hẳn scheduler trạng thái đơn (5 phút). Danh mục xưởng
 * in gần như tĩnh, trong khi một lượt đồng bộ là hàng nghìn lời gọi API — chạy dày chỉ để
 * đốt hạn mức tần suất của nhà cung cấp. Cần dữ liệu mới ngay thì bấm đồng bộ thủ công.
 *
 * 🔴 Rà ánh xạ tự động chạy NGAY SAU khi đồng bộ xong: danh mục vừa có thêm sản phẩm mới thì
 * những dòng hàng trước đó không tìm được nay có thể ánh xạ được. Không làm bước này thì
 * người dùng phải đợi tới lượt đồng bộ ĐƠN kế tiếp mới thấy kết quả.
 */
@Injectable()
export class FulfillmentCatalogSyncJob implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentCatalogSyncJob.name);

  static readonly JOB_NAME = 'fulfillment-catalog-sync';

  /** Chặn chồng lịch trong cùng tiến trình — một lượt có thể chạy rất lâu. */
  private running = false;

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

    const cronExpression = this.config.get<string>('fulfillment.catalogSync.cron', '0 */6 * * *');
    try {
      const job = new CronJob(cronExpression, () => {
        void this.handleTick();
      });
      this.registry.addCronJob(FulfillmentCatalogSyncJob.JOB_NAME, job);
      job.start();

      this.logger.log({
        module: 'fulfillment',
        cron: cronExpression,
        msg: 'Đã đăng ký scheduler đồng bộ danh mục nhà cung cấp',
      });
    } catch (error) {
      // Cron sai cú pháp không được phép làm sập ứng dụng.
      this.logger.error({
        module: 'fulfillment',
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
      const result = await this.catalogSync.syncAllAccounts();
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
}
