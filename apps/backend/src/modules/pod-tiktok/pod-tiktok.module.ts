import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { TiktokApiClient } from './clients/tiktok-api.client';
import { TiktokAuthClient } from './clients/tiktok-auth.client';
import { TiktokFinanceClient } from './clients/tiktok-finance.client';
import { TiktokHttpService } from './clients/tiktok-http.service';
import { TiktokOrderClient } from './clients/tiktok-order.client';
import { TiktokSignatureService } from './clients/tiktok-signature.service';
import { DistributedLockService } from './infra/distributed-lock.service';
import { PodOrderMapper } from './mappers/pod-order.mapper';
import { PodOrderResponseMapper } from './mappers/pod-order-response.mapper';
import { PodPayoutMapper } from './mappers/pod-payout.mapper';
import { PodTiktokAccountMapper } from './mappers/pod-tiktok-account.mapper';
import { PodOrderController } from './pod-order.controller';
import { PodPayoutController } from './pod-payout.controller';
import { PodDashboardController } from './pod-dashboard.controller';
import { PodEmployeeWorkController } from './pod-employee-work.controller';
import { PodEmployeeWorkRepository } from './repositories/pod-employee-work.repository';
import { PodEmployeeWorkService } from './services/pod-employee-work.service';
import { PodDashboardRepository } from './repositories/pod-dashboard.repository';
import { PodDashboardService } from './services/pod-dashboard.service';
import { PodTiktokAccountController } from './pod-tiktok-account.controller';
import { TiktokCallbackController } from './tiktok-callback.controller';
import { PodOrderRepository } from './repositories/pod-order.repository';
import { PodPayoutReportRepository } from './repositories/pod-payout-report.repository';
import { PodPayoutRepository } from './repositories/pod-payout.repository';
import { PodShopSyncStatusRepository } from './repositories/pod-shop-sync-status.repository';
import { PodShopSyncStatusService } from './services/pod-shop-sync-status.service';
import { PodTiktokAccountRepository } from './repositories/pod-tiktok-account.repository';
import { PodTiktokOAuthStateRepository } from './repositories/pod-tiktok-oauth-state.repository';
import { PodTiktokShopSyncRepository } from './repositories/pod-tiktok-shop-sync.repository';
import { PodTiktokShopSyncService } from './services/pod-tiktok-shop-sync.service';
import { PodOrderFinanceService } from './services/pod-order-finance.service';
import { PodOrderSyncJob } from './schedulers/pod-order-sync.job';
import { PodOrderIngestionService } from './services/pod-order-ingestion.service';
import { PodOrderSyncService } from './services/pod-order-sync.service';
import { PodAccessScopeService } from './services/pod-access-scope.service';
import { PodScopeGuard } from './guards/pod-scope.guard';
import { PodOrderDesignResolver } from './services/pod-order-design-resolver.service';
import { PodOrderProductImageResolver } from './services/pod-order-product-image.resolver';
import { PodOrderService } from './services/pod-order.service';
import { PodPayoutService } from './services/pod-payout.service';
import { PodPayoutSyncService } from './services/pod-payout-sync.service';
import { PodSyncOrchestratorService } from './services/pod-sync-orchestrator.service';
import { PodTiktokAccountService } from './services/pod-tiktok-account.service';
import { PodTiktokOAuthService } from './services/pod-tiktok-oauth.service';
import { PodTiktokShopContextService } from './services/pod-tiktok-shop-context.service';
import { PodTiktokTokenService } from './services/pod-tiktok-token.service';
import { TiktokEncryptionService } from './services/tiktok-encryption.service';

/**
 * PodTiktokModule — Module POD / TikTok Shop.
 *
 * Sprint 1: Link TikTok Shop Account (OAuth code → token → Get Authorized Shops → DB).
 * Sprint 2: Scheduler + Get Orders + Sync Orders.
 *
 * Hoàn toàn ĐỘC LẬP với AccountModule/OrderModule (đơn nhập tay) — bảng riêng, service riêng.
 *
 * Phân lớp:
 *  - `clients/*`      — Anti-Corruption Layer, cửa duy nhất ra TikTok
 *  - `infra/*`        — khoá phân tán (Redis)
 *  - `services/*`     — nghiệp vụ (token, ingest, sync, orchestrator, truy vấn)
 *  - `schedulers/*`   — chỉ kích hoạt theo lịch, KHÔNG chứa nghiệp vụ
 *  - `repositories/*` — data access, luôn nhận organizationId
 */
@Module({
  // NotificationModule: ghi sự kiện NEW ORDER vào outbox trong transaction tạo đơn (một chiều —
  // module Notification không import module POD).
  imports: [AuthModule, NotificationModule, ScheduleModule.forRoot()],
  controllers: [
    TiktokCallbackController,
    PodTiktokAccountController,
    PodOrderController,
    PodPayoutController,
    PodDashboardController,
    PodEmployeeWorkController,
  ],
  providers: [
    // Dashboard quản trị (Hold · shop · đơn · tài chính · seller · xu hướng) — tổng hợp SQL.
    PodDashboardRepository,
    PodDashboardService,
    // Thống kê công việc nhân viên (Admin) — listing · shop · đơn · lợi nhuận theo người.
    PodEmployeeWorkRepository,
    PodEmployeeWorkService,
    // Sprint 1 — Link Account (luồng OAuth tự động)
    PodTiktokAccountService,
    PodTiktokOAuthService,
    PodTiktokAccountRepository,
    PodTiktokOAuthStateRepository,
    // Shop Sync — đối chiếu thông tin + trạng thái shop với TikTok (nút "Sync Shops").
    PodTiktokShopSyncService,
    PodTiktokShopSyncRepository,
    // Tài chính cấp đơn cho cột "Giá" (tiền thu về · giá vốn · lợi nhuận · margin).
    PodOrderFinanceService,
    PodTiktokAccountMapper,
    // Sprint 2 — Orders & Sync
    PodOrderService,
    // Đơn hàng chỉ ĐỌC design từ Product Mapping. Không còn service/repository ghi design
    // theo line item — đường ghi duy nhất là `MappingDesignService` của module Fulfillment.
    PodOrderDesignResolver,
    PodOrderProductImageResolver,
    PodOrderSyncService,
    PodSyncOrchestratorService,
    PodOrderIngestionService,
    PodTiktokTokenService,
    PodTiktokShopContextService,
    PodOrderRepository,
    // Latest Sync Status — MỘT dòng mỗi (tổ chức, shop, loại đồng bộ); dùng chung cho đơn và sản phẩm.
    PodShopSyncStatusRepository,
    PodShopSyncStatusService,
    PodOrderMapper,
    PodOrderResponseMapper,
    PodOrderSyncJob,
    // Báo cáo Payout (Finance API) — docs/pod-tiktok/10-payout-report.md
    PodPayoutService,
    PodPayoutSyncService,
    PodPayoutRepository,
    PodPayoutReportRepository,
    PodPayoutMapper,
    TiktokFinanceClient,
    // 🔴 Phân quyền theo shop — dùng chung cho MỌI module POD (xem PodAccessScopeService).
    PodAccessScopeService,
    PodScopeGuard,
    // Hạ tầng dùng chung
    TiktokEncryptionService,
    TiktokSignatureService,
    TiktokHttpService,
    TiktokAuthClient,
    TiktokApiClient,
    TiktokOrderClient,
    DistributedLockService,
  ],
  exports: [
    // 🔴 Phạm vi shop: mọi module POD khác import PodTiktokModule để dùng lại ĐÚNG một
    // nguồn sự thật này, thay vì mỗi nơi tự viết một phép lọc riêng.
    PodAccessScopeService,
    PodScopeGuard,
    // Trạng thái đồng bộ gần nhất — module Product ghi/đọc qua đây (không tự giữ bảng lịch sử riêng).
    PodShopSyncStatusRepository,
    PodShopSyncStatusService,
    // Hạ tầng để các Sprint sau (POD Detail, Fulfillment, Webhook) tái sử dụng.
    TiktokSignatureService,
    TiktokHttpService,
    TiktokAuthClient,
    TiktokApiClient,
    TiktokOrderClient,
    TiktokFinanceClient,
    TiktokEncryptionService,
    DistributedLockService,
    PodTiktokTokenService,
    PodTiktokShopContextService,
    PodTiktokAccountRepository,
    PodOrderRepository,
  ],
})
export class PodTiktokModule {}
