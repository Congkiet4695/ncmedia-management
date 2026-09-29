import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PodTiktokModule } from '../pod-tiktok/pod-tiktok.module';
import { FulfillmentController } from './controllers/fulfillment.controller';
import { PlatformFulfillmentController } from './controllers/platform-fulfillment.controller';
import { PodOrderFulfillmentController } from './controllers/pod-order-fulfillment.controller';
import { MangoApiClient } from './mango/clients/mango-api.client';
import { MangoCatalogService } from './mango/services/mango-catalog.service';
import { MangoCredentialService } from './mango/services/mango-credential.service';
import { MangoOrderMapper } from './mango/mappers/mango-order.mapper';
import { MangoFulfillmentService } from './mango/services/mango-fulfillment.service';
import { MangoWebhookController } from './mango/webhook/mango-webhook.controller';
import { MangoWebhookService } from './mango/webhook/mango-webhook.service';
import { ProductDesignMapper } from './mappers/product-design.mapper';
import { FulfillmentCatalogRepository } from './repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from './repositories/fulfillment.repository';
import { FulfillmentCatalogSyncJob } from './scheduler/fulfillment-catalog-sync.job';
import { FulfillmentSyncJob } from './scheduler/fulfillment-sync.job';
import { AutoMapOrderSyncHook } from './services/auto-map-order-sync.hook';
import { FulfillmentCatalogQueryService } from './services/fulfillment-catalog-query.service';
import { FulfillmentOptionsService } from './services/fulfillment-options.service';
import { FulfillmentCatalogSyncService } from './services/fulfillment-catalog-sync.service';
import { ProductMappingAutoService } from './services/product-mapping-auto.service';
import { FulfillmentReadinessService } from './services/fulfillment-readiness.service';
import { FulfillmentShippingLabelService } from './services/fulfillment-shipping-label.service';
import { PlatformFulfillmentService } from './services/platform-fulfillment.service';
import { ProductDesignService } from './services/product-design.service';
import { FulfillmentSyncService } from './services/fulfillment-sync.service';
import { FulfillmentService } from './services/fulfillment.service';
import { FulfillmentProviderGateway } from './services/fulfillment-provider.gateway';
import { SellerwixApiClient } from './sellerwix/clients/sellerwix-api.client';
import { SellerwixOrderMapper } from './sellerwix/mappers/sellerwix-order.mapper';
import { SellerwixCatalogService } from './sellerwix/services/sellerwix-catalog.service';
import { SellerwixCredentialService } from './sellerwix/services/sellerwix-credential.service';
import { SellerwixFulfillmentService } from './sellerwix/services/sellerwix-fulfillment.service';
import { SellerwixWebhookController } from './sellerwix/webhook/sellerwix-webhook.controller';
import { SellerwixWebhookService } from './sellerwix/webhook/sellerwix-webhook.service';

/**
 * FulfillmentModule — gửi đơn POD sang xưởng in.
 *
 * Phân lớp:
 *  - `controllers/*`        — REST API (tenant-scoped + RBAC)
 *  - `services/*`           — nghiệp vụ KHÔNG phụ thuộc nhà cung cấp
 *  - `services/fulfillment-provider.gateway.ts` — chọn adapter theo `account.provider`;
 *      controller/scheduler CHỈ gọi gateway, không gọi thẳng nhà cung cấp nào
 *  - `mango/*`              — toàn bộ phần đặc thù MangoTeePrints
 *  - `sellerwix/*`          — toàn bộ phần đặc thù Sellerwix (cùng bố cục với `mango/`)
 *      · `clients/`  cửa duy nhất ra API nhà cung cấp
 *      · `mappers/`  Anti-Corruption Layer hai chiều
 *      · `services/` nghiệp vụ tạo/đồng bộ/huỷ đơn
 *      · `webhook/`  nhận sự kiện gọi về
 *  - `scheduler/*`          — chỉ kích hoạt theo lịch, KHÔNG chứa nghiệp vụ
 *  - `repositories/*`       — data access, luôn nhận organizationId
 *
 * Thêm nhà cung cấp mới: tạo thư mục ngang hàng với `mango/` / `sellerwix/`, cài
 * `FulfillmentProviderAdapter`, đăng ký adapter trong gateway. KHÔNG đụng tới module POD.
 *
 * 🔴 Phụ thuộc MỘT CHIỀU: Fulfillment → PodTiktok (đọc đơn, giải mã PII, khoá phân tán).
 * Module POD KHÔNG biết gì về Fulfillment ⇒ không có phụ thuộc vòng.
 */
@Module({
  imports: [AuthModule, PodTiktokModule, ScheduleModule.forRoot()],
  controllers: [
    FulfillmentController,
    PodOrderFulfillmentController,
    // Khu vực quản trị NỀN TẢNG: nhà cung cấp dùng chung + đồng bộ danh mục tập trung.
    PlatformFulfillmentController,
    MangoWebhookController,
    SellerwixWebhookController,
  ],
  providers: [
    // Nghiệp vụ chung
    FulfillmentService,
    FulfillmentReadinessService,
    // Nhãn vận chuyển TikTok — đường duy nhất tạo/lấy lại gói hàng của đơn.
    FulfillmentShippingLabelService,
    PlatformFulfillmentService,
    ProductDesignService,
    ProductDesignMapper,
    FulfillmentSyncService,
    FulfillmentRepository,
    // Bản sao danh mục nhà cung cấp: Mango API → Sync Job → Database → UI
    FulfillmentCatalogRepository,
    FulfillmentCatalogSyncService,
    FulfillmentCatalogQueryService,
    FulfillmentOptionsService,
    // Ánh xạ tự động — cùng một luật, ba nguồn kích hoạt (đồng bộ đơn · đồng bộ danh mục · thủ công)
    ProductMappingAutoService,
    AutoMapOrderSyncHook,
    // MangoTeePrints
    MangoApiClient,
    MangoOrderMapper,
    MangoCatalogService,
    MangoCredentialService,
    MangoFulfillmentService,
    MangoWebhookService,
    // Sellerwix
    SellerwixApiClient,
    SellerwixOrderMapper,
    SellerwixCatalogService,
    SellerwixCredentialService,
    SellerwixFulfillmentService,
    SellerwixWebhookService,
    // Chọn adapter theo nhà cung cấp — điểm vào duy nhất từ controller/scheduler.
    FulfillmentProviderGateway,
    // Lịch
    FulfillmentSyncJob,
    FulfillmentCatalogSyncJob,
  ],
  exports: [FulfillmentService, FulfillmentRepository],
})
export class FulfillmentModule {}
