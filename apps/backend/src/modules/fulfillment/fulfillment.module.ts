import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { FulfillmentController } from './controllers/fulfillment.controller';
import { MangoApiClient } from './mango/clients/mango-api.client';
import { MangoOrderMapper } from './mango/mappers/mango-order.mapper';
import { MangoFulfillmentService } from './mango/services/mango-fulfillment.service';
import { MangoWebhookController } from './mango/webhook/mango-webhook.controller';
import { MangoWebhookService } from './mango/webhook/mango-webhook.service';
import { FulfillmentRepository } from './repositories/fulfillment.repository';
import { FulfillmentSyncJob } from './scheduler/fulfillment-sync.job';
import { FulfillmentReadinessService } from './services/fulfillment-readiness.service';
import { FulfillmentSyncService } from './services/fulfillment-sync.service';
import { FulfillmentService } from './services/fulfillment.service';

/**
 * FulfillmentModule — gửi đơn POD sang xưởng in.
 *
 * Phân lớp:
 *  - `controllers/*`        — REST API (tenant-scoped + RBAC)
 *  - `services/*`           — nghiệp vụ KHÔNG phụ thuộc nhà cung cấp
 *  - `mango/*`              — toàn bộ phần đặc thù MangoTeePrints
 *      · `clients/`  cửa duy nhất ra API nhà cung cấp
 *      · `mappers/`  Anti-Corruption Layer hai chiều
 *      · `services/` nghiệp vụ tạo/đồng bộ/huỷ đơn
 *      · `webhook/`  nhận sự kiện gọi về
 *  - `scheduler/*`          — chỉ kích hoạt theo lịch, KHÔNG chứa nghiệp vụ
 *  - `repositories/*`       — data access, luôn nhận organizationId
 *
 * Thêm nhà cung cấp mới (Printify/Printful): tạo thư mục ngang hàng với `mango/`,
 * KHÔNG sửa `services/` chung và KHÔNG đụng tới module POD.
 *
 * 🔴 Phụ thuộc MỘT CHIỀU: Fulfillment → PodTiktok (đọc đơn, giải mã PII, khoá phân tán).
 * Module POD KHÔNG biết gì về Fulfillment ⇒ không có phụ thuộc vòng.
 */
@Module({
  imports: [AuthModule, PodTiktokModule, ScheduleModule.forRoot()],
  controllers: [FulfillmentController, MangoWebhookController],
  providers: [
    // Nghiệp vụ chung
    FulfillmentService,
    FulfillmentReadinessService,
    FulfillmentSyncService,
    FulfillmentRepository,
    // MangoTeePrints
    MangoApiClient,
    MangoOrderMapper,
    MangoFulfillmentService,
    MangoWebhookService,
    // Lịch
    FulfillmentSyncJob,
  ],
  exports: [FulfillmentService, FulfillmentRepository],
})
export class FulfillmentModule {}
