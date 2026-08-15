import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
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
import { PodOrderDesignController } from './pod-order-design.controller';
import { PodPayoutController } from './pod-payout.controller';
import { PodTiktokAccountController } from './pod-tiktok-account.controller';
import { TiktokCallbackController } from './tiktok-callback.controller';
import { PodOrderDesignRepository } from './repositories/pod-order-design.repository';
import { PodOrderRepository } from './repositories/pod-order.repository';
import { PodPayoutReportRepository } from './repositories/pod-payout-report.repository';
import { PodPayoutRepository } from './repositories/pod-payout.repository';
import { PodSyncLogRepository } from './repositories/pod-sync-log.repository';
import { PodTiktokAccountRepository } from './repositories/pod-tiktok-account.repository';
import { PodOrderSyncJob } from './schedulers/pod-order-sync.job';
import { PodOrderIngestionService } from './services/pod-order-ingestion.service';
import { PodOrderSyncService } from './services/pod-order-sync.service';
import { PodOrderDesignService } from './services/pod-order-design.service';
import { PodOrderService } from './services/pod-order.service';
import { PodPayoutService } from './services/pod-payout.service';
import { PodPayoutSyncService } from './services/pod-payout-sync.service';
import { PodSyncOrchestratorService } from './services/pod-sync-orchestrator.service';
import { PodTiktokAccountService } from './services/pod-tiktok-account.service';
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
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [
    TiktokCallbackController,
    PodTiktokAccountController,
    PodOrderController,
    PodOrderDesignController,
    PodPayoutController,
  ],
  providers: [
    // Sprint 1 — Link Account
    PodTiktokAccountService,
    PodTiktokAccountRepository,
    PodTiktokAccountMapper,
    // Sprint 2 — Orders & Sync
    PodOrderService,
    PodOrderDesignService,
    PodOrderDesignRepository,
    PodOrderSyncService,
    PodSyncOrchestratorService,
    PodOrderIngestionService,
    PodTiktokTokenService,
    PodOrderRepository,
    PodSyncLogRepository,
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
    PodTiktokAccountRepository,
    PodOrderRepository,
  ],
})
export class PodTiktokModule {}
