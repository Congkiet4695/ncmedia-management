import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentTrigger } from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentProviderGateway } from './fulfillment-provider.gateway';

/** Tổng hợp kết quả một lượt đồng bộ. */
export interface FulfillmentSyncResult {
  ordersChecked: number;
  ordersUpdated: number;
  ordersFailed: number;
  apiCalls: number;
  durationMs: number;
  skippedByLock: boolean;
}

/**
 * FulfillmentSyncService — đồng bộ trạng thái đơn từ nhà cung cấp về NCMedia.
 *
 * Là LƯỚI AN TOÀN cho webhook: webhook có thể mất (Mango tự tắt sau 10 lần lỗi liên tiếp),
 * nên vẫn phải chủ động hỏi lại trạng thái theo lịch.
 *
 * Chỉ hỏi những đơn CHƯA ở trạng thái kết thúc và ưu tiên đơn lâu chưa đồng bộ nhất
 * ⇒ chi phí không tăng theo tổng số đơn lịch sử.
 */
@Injectable()
export class FulfillmentSyncService {
  private readonly logger = new Logger(FulfillmentSyncService.name);

  private static readonly LOCK_KEY = 'fulfillment:sync:global';

  constructor(
    private readonly config: ConfigService,
    private readonly repo: FulfillmentRepository,
    private readonly gateway: FulfillmentProviderGateway,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Chạy một lượt đồng bộ.
   * `organizationId` có giá trị ⇒ chỉ trong phạm vi tổ chức đó (kích hoạt thủ công).
   */
  async runAll(
    trigger: FulfillmentTrigger = FulfillmentTrigger.CRON,
    organizationId?: string,
    triggeredBy?: string,
  ): Promise<FulfillmentSyncResult> {
    const startedAt = Date.now();
    const deadlineMs = this.config.get<number>('fulfillment.sync.runDeadlineMs', 240_000);
    const lockKey = organizationId
      ? `${FulfillmentSyncService.LOCK_KEY}:org:${organizationId}`
      : FulfillmentSyncService.LOCK_KEY;

    const acquired = await this.lock.acquire(lockKey, deadlineMs);
    if (!acquired) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'sync.run-all',
        msg: 'Lượt đồng bộ trước chưa xong — bỏ qua lượt này',
      });
      return {
        ordersChecked: 0,
        ordersUpdated: 0,
        ordersFailed: 0,
        apiCalls: 0,
        durationMs: Date.now() - startedAt,
        skippedByLock: true,
      };
    }

    const batchSize = this.config.get<number>('fulfillment.sync.batchSize', 100);
    const result: FulfillmentSyncResult = {
      ordersChecked: 0,
      ordersUpdated: 0,
      ordersFailed: 0,
      apiCalls: 0,
      durationMs: 0,
      skippedByLock: false,
    };

    try {
      const orders = await this.repo.findOrdersToSync(batchSize, organizationId);
      if (orders.length === 0) {
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      // Nạp tài khoản MỘT lần cho mỗi accountId — nhiều đơn dùng chung một tài khoản
      // nên nếu đọc trong vòng lặp sẽ thành N+1.
      const accountCache = new Map<string, Awaited<ReturnType<typeof this.repo.findAccountById>>>();
      // Tài khoản vừa bị nhà cung cấp trả 429 ⇒ bỏ các đơn còn lại của tài khoản đó tới lượt sau.
      // Hỏi tiếp chỉ đốt thêm hạn mức và ghi thêm hàng loạt dòng RATE_LIMIT vô nghĩa lên timeline.
      const rateLimitedAccounts = new Set<string>();
      const deadlineAt = startedAt + deadlineMs;
      const startedDate = new Date(startedAt);
      // MỘT nhật ký cho MỖI nhà cung cấp có mặt trong lượt — số liệu đối soát không trộn Mango với
      // Sellerwix (hai trần tần suất, hai nguồn lỗi khác nhau).
      const perProvider = new Map<
        FulfillmentProvider,
        { logId: string; checked: number; updated: number; failed: number; apiCalls: number }
      >();
      for (const provider of new Set(orders.map((order) => order.provider))) {
        const log = await this.repo.startSyncLog({
          organizationId: organizationId ?? orders[0].organizationId,
          provider,
          trigger,
          triggeredBy: triggeredBy ?? null,
          startedAt: startedDate,
        });
        perProvider.set(provider, { logId: log.id, checked: 0, updated: 0, failed: 0, apiCalls: 0 });
      }

      for (const order of orders) {
        if (Date.now() >= deadlineAt) {
          this.logger.warn({
            module: 'fulfillment',
            operation: 'sync.run-all',
            msg: 'Chạm deadline — phần còn lại xử lý ở lượt sau',
          });
          break;
        }

        const cacheKey = `${order.organizationId}:${order.accountId}`;
        if (!accountCache.has(cacheKey)) {
          accountCache.set(
            cacheKey,
            await this.repo.findAccountById(order.organizationId, order.accountId),
          );
        }
        const account = accountCache.get(cacheKey);
        const stats = perProvider.get(order.provider);
        if (!account || !account.isActive || !this.gateway.isSupported(order.provider)) {
          result.ordersFailed += 1;
          if (stats) stats.failed += 1;
          continue;
        }

        if (rateLimitedAccounts.has(cacheKey)) continue;

        result.ordersChecked += 1;
        // syncOne KHÔNG ném lỗi (fail-soft) — một đơn hỏng không được dừng cả lượt. Adapter chọn
        // theo nhà cung cấp CỦA BẢN GHI: đơn Sellerwix không bao giờ được hỏi bằng client Mango.
        const outcome = await this.gateway.syncOne(order, account, trigger);
        if (outcome.rateLimited) {
          rateLimitedAccounts.add(cacheKey);
          this.logger.warn({
            module: 'fulfillment',
            operation: 'sync.run-all',
            provider: order.provider,
            accountId: order.accountId,
            msg: 'Nhà cung cấp trả RATE_LIMIT — tạm dừng tài khoản này tới lượt đồng bộ sau',
          });
        }
        result.apiCalls += outcome.apiCalls;
        if (outcome.changed) result.ordersUpdated += 1;
        if (stats) {
          stats.checked += 1;
          stats.apiCalls += outcome.apiCalls;
          if (outcome.changed) stats.updated += 1;
        }
      }

      result.durationMs = Date.now() - startedAt;
      for (const stats of perProvider.values()) {
        await this.repo.finishSyncLog(stats.logId, startedDate, {
          status: 'SUCCESS',
          ordersChecked: stats.checked,
          ordersUpdated: stats.updated,
          ordersFailed: stats.failed,
          apiCalls: stats.apiCalls,
        });
      }

      this.logger.log({
        module: 'fulfillment',
        operation: 'sync.run-all',
        ...result,
        msg: 'Hoàn tất đồng bộ trạng thái fulfillment',
      });
      return result;
    } finally {
      await this.lock.release(acquired);
    }
  }
}
