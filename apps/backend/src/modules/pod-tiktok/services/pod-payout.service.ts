import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import {
  PayoutReportFilter,
  PodPayoutReportRepository,
  type PayoutSortField,
  type PayoutSortOrder,
} from '../repositories/pod-payout-report.repository';
import {
  PaginatedPodPayoutAccountDto,
  PaginatedPodPayoutSellerDto,
  PodPayoutBreakdownQueryDto,
  PodPayoutFilterDto,
  PodPayoutSummaryDto,
  PodPayoutSyncResultDto,
  TriggerPayoutSyncDto,
} from '../dto/pod-payout.dto';
import { PodTiktokAccountNotFoundException } from '../exceptions/pod-tiktok.exceptions';
import { resolveDateRange } from '../utils/date-range.util';
import { PodPayoutSyncService } from './pod-payout-sync.service';
import { SyncShopTarget } from './pod-order-sync.service';

/**
 * PodPayoutService — nghiệp vụ báo cáo Payout TikTok.
 *
 * Trách nhiệm:
 *  - Quy đổi preset thời gian → khoảng UTC (tại backend, theo múi giờ vận hành).
 *  - Áp scope row-level: Admin xem toàn Organization, người khác chỉ xem account mình quản lý.
 *  - Gọi repository (đã aggregate sẵn bằng SQL) và đóng gói response.
 *
 * 🔴 KHÔNG tính toán số tiền tại đây. Mọi phép cộng nằm trong SQL; service chỉ định dạng.
 */
@Injectable()
export class PodPayoutService {
  private readonly logger = new Logger(PodPayoutService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reportRepo: PodPayoutReportRepository,
    private readonly accountRepo: PodTiktokAccountRepository,
    private readonly syncService: PodPayoutSyncService,
  ) {}

  /** Report Card — tổng payout của toàn bộ Account trong khoảng lọc. */
  async summary(
    organizationId: string,
    query: PodPayoutFilterDto,
    sellerScope?: string,
  ): Promise<PodPayoutSummaryDto> {
    const filter = this.buildFilter(organizationId, query, sellerScope);
    const [summary, currencies] = await Promise.all([
      this.reportRepo.summary(filter),
      this.reportRepo.distinctCurrencies(filter),
    ]);

    // Cộng dồn nhiều đơn vị tiền tệ là sai về nghiệp vụ — phải để lộ ra, không giấu.
    if (currencies.length > 1) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'payout.summary',
        organizationId,
        currencies,
        msg: 'Payout có nhiều đơn vị tiền tệ — tổng cộng dồn không có ý nghĩa tài chính',
      });
    }

    return {
      totalPayout: summary.totalPayout,
      currency: summary.currency,
      paymentCount: summary.paymentCount,
      accountCount: summary.accountCount,
      sellerCount: summary.sellerCount,
      orderCount: summary.orderCount,
      range: {
        from: filter.from?.toISOString() ?? null,
        to: filter.to?.toISOString() ?? null,
      },
      currencies,
    };
  }

  /** Bảng Seller — mặc định sắp xếp giảm dần theo Payout. */
  async sellerBreakdown(
    organizationId: string,
    query: PodPayoutBreakdownQueryDto,
    sellerScope?: string,
  ): Promise<PaginatedPodPayoutSellerDto> {
    const { page, pageSize, sortField, sortOrder } = this.paging(query);
    const { items, total } = await this.reportRepo.sellerBreakdown(
      this.buildFilter(organizationId, query, sellerScope),
      page,
      pageSize,
      sortField,
      sortOrder,
    );
    return { items, meta: this.meta(total, page, pageSize) };
  }

  /** Bảng Account — mặc định sắp xếp giảm dần theo Payout. */
  async accountBreakdown(
    organizationId: string,
    query: PodPayoutBreakdownQueryDto,
    sellerScope?: string,
  ): Promise<PaginatedPodPayoutAccountDto> {
    const { page, pageSize, sortField, sortOrder } = this.paging(query);
    const { items, total } = await this.reportRepo.accountBreakdown(
      this.buildFilter(organizationId, query, sellerScope),
      page,
      pageSize,
      sortField,
      sortOrder,
    );
    return { items, meta: this.meta(total, page, pageSize) };
  }

  /**
   * Đồng bộ payout thủ công.
   * Tenant-scoped: chỉ chạy cho shop thuộc Organization của người gọi.
   */
  async triggerSync(
    organizationId: string,
    dto: TriggerPayoutSyncDto,
  ): Promise<PodPayoutSyncResultDto> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + this.config.get<number>('tiktok.sync.runDeadlineMs', 240_000);

    let targets: SyncShopTarget[];
    if (dto.shopId) {
      const shop = await this.accountRepo.findShopForSync(organizationId, dto.shopId);
      if (!shop) throw new PodTiktokAccountNotFoundException();
      targets = [shop];
    } else {
      targets = await this.accountRepo.listShopsForSync(new Date(), organizationId);
    }

    const result: PodPayoutSyncResultDto = {
      shopsTotal: targets.length,
      shopsSucceeded: 0,
      shopsFailed: 0,
      paymentsCreated: 0,
      paymentsUpdated: 0,
      statementsCreated: 0,
      statementsUpdated: 0,
      statementsWithTransactions: 0,
      apiCalls: 0,
      durationMs: 0,
    };

    // Tuần tự: Finance API dùng chung quota với Order API, chạy song song dễ chạm rate limit.
    for (const target of targets) {
      const outcome = await this.syncService.syncShop(target, { deadlineAt, full: dto.full });
      if (outcome.ok) result.shopsSucceeded += 1;
      else result.shopsFailed += 1;
      result.paymentsCreated += outcome.paymentsCreated;
      result.paymentsUpdated += outcome.paymentsUpdated;
      result.statementsCreated += outcome.statementsCreated;
      result.statementsUpdated += outcome.statementsUpdated;
      result.statementsWithTransactions += outcome.transactionsStatements;
      result.apiCalls += outcome.apiCalls;
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildFilter(
    organizationId: string,
    query: PodPayoutFilterDto,
    sellerScope?: string,
  ): PayoutReportFilter {
    const offsetMinutes = this.config.get<number>('timezoneOffsetMinutes', 420);
    const range = resolveDateRange(query.datePreset, offsetMinutes, query.fromDate, query.toDate);
    return {
      organizationId,
      from: range.from,
      to: range.to,
      status: query.payoutStatus,
      sellerScope,
      search: query.search || undefined,
    };
  }

  private paging(query: PodPayoutBreakdownQueryDto): {
    page: number;
    pageSize: number;
    sortField: PayoutSortField;
    sortOrder: PayoutSortOrder;
  } {
    return {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      // Yêu cầu nghiệp vụ: mặc định sắp xếp GIẢM DẦN theo Payout.
      sortField: query.sortField ?? 'totalPayout',
      sortOrder: query.sortOrder ?? 'desc',
    };
  }

  /** Metadata phân trang theo ADR-023: khoá là `limit`, dù tham số vào tên `pageSize`. */
  private meta(total: number, page: number, pageSize: number) {
    return { total, page, limit: pageSize, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
  }
}
