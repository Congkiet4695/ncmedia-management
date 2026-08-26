import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TIKTOK_FINANCE_PAGE_SIZE_MAX } from '../constants/tiktok.constants';
import { TiktokFinanceClient } from '../clients/tiktok-finance.client';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodPayoutMapper } from '../mappers/pod-payout.mapper';
import { PodPayoutRepository, PayoutWriteContext } from '../repositories/pod-payout.repository';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { SyncShopTarget } from './pod-order-sync.service';

/** Kết quả đồng bộ payout của MỘT shop. */
export interface PayoutSyncOutcome {
  shopId: string;
  shopName: string;
  ok: boolean;
  apiCalls: number;
  paymentsCreated: number;
  paymentsUpdated: number;
  statementsCreated: number;
  statementsUpdated: number;
  statementsLinked: number;
  transactionsStatements: number;
  ordersCounted: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface PayoutSyncOptions {
  /** Kéo lại TOÀN BỘ lịch sử thay vì cửa sổ cuốn chiếu. */
  full?: boolean;
  /** Thời điểm phải dừng (deadline chung của lượt cron). */
  deadlineAt?: number;
}

const SECONDS_PER_DAY = 86_400;

/**
 * PodPayoutSyncService — kéo dữ liệu Payout từ Finance API về DB.
 *
 * Ba bước, đúng thứ tự khuyến nghị của "Finance API overview":
 *   1. Get Payments    → tiền thực nhận (định nghĩa "Payout")
 *   2. Get Statements  → đối soát theo ngày, mang `payment_id`
 *   3. Get Transactions by Statement → giao dịch cấp ĐƠN (nguồn Order Count)
 *
 * Chiến lược cửa sổ (KHÔNG cần watermark riêng):
 *  - Shop chưa có payment nào ⇒ kéo TOÀN BỘ lịch sử (bỏ trống `*_ge`, TikTok mặc định
 *    lấy từ "earliest shop time").
 *  - Đã có ⇒ chỉ quét lại `windowDays` gần nhất. Bắt buộc quét lại vì trạng thái chi trả
 *    CHUYỂN TIẾP theo thời gian (PROCESSING → PAID/FAILED) — bản ghi cũ vẫn có thể đổi.
 *  - Giao dịch cấp đơn chỉ kéo cho statement chưa kéo (`transactions_synced_at IS NULL`):
 *    statement đã chốt thì bất biến ⇒ chi phí các lượt sau gần bằng 0.
 *
 * Fail-soft: mọi lỗi được gói vào `PayoutSyncOutcome`, không ném ra ngoài để một shop
 * lỗi không làm dừng cả lượt (cùng nguyên tắc với đồng bộ đơn).
 */
@Injectable()
export class PodPayoutSyncService {
  private readonly logger = new Logger(PodPayoutSyncService.name);

  private static readonly LOCK_PREFIX = 'pod:tiktok:payout:shop:';

  constructor(
    private readonly config: ConfigService,
    private readonly financeClient: TiktokFinanceClient,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
    private readonly repo: PodPayoutRepository,
    private readonly mapper: PodPayoutMapper,
    private readonly lock: DistributedLockService,
  ) {}

  /** Đồng bộ payout cho một shop. KHÔNG ném lỗi ra ngoài. */
  async syncShop(
    target: SyncShopTarget,
    options: PayoutSyncOptions = {},
  ): Promise<PayoutSyncOutcome> {
    const outcome: PayoutSyncOutcome = {
      shopId: target.id,
      shopName: target.name,
      ok: false,
      apiCalls: 0,
      paymentsCreated: 0,
      paymentsUpdated: 0,
      statementsCreated: 0,
      statementsUpdated: 0,
      statementsLinked: 0,
      transactionsStatements: 0,
      ordersCounted: 0,
    };

    const lockTtl = this.config.get<number>('tiktok.sync.runDeadlineMs', 240_000);
    const acquired = await this.lock.acquire(
      `${PodPayoutSyncService.LOCK_PREFIX}${target.id}`,
      lockTtl,
    );
    if (!acquired) {
      outcome.errorCode = 'LOCKED';
      outcome.errorMessage = 'Đang có lượt đồng bộ payout khác cho shop này';
      return outcome;
    }

    try {
      await this.run(target, options, outcome);
      outcome.ok = true;
    } catch (error) {
      Object.assign(outcome, this.describeError(error));
      this.logger.error({
        module: 'pod-tiktok',
        operation: 'payout.sync',
        organizationId: target.organizationId,
        shopId: target.id,
        msg: `Đồng bộ payout thất bại: ${outcome.errorMessage}`,
      });
    } finally {
      await this.lock.release(acquired);
    }

    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async run(
    target: SyncShopTarget,
    options: PayoutSyncOptions,
    outcome: PayoutSyncOutcome,
  ): Promise<void> {
    const token = await this.tokenService.ensureValidAccessToken(target.account);
    if (!token.ok) {
      outcome.errorCode = token.reason;
      outcome.errorMessage = token.message;
      throw new Error(token.message);
    }

    const ctx: PayoutWriteContext = {
      organizationId: target.organizationId,
      accountId: target.accountId,
      shopId: target.id,
    };
    const shopCipher = this.encryption.decrypt(target.shopCipherEnc);
    const now = new Date();

    // Chưa có payment nào ⇒ lần đầu, kéo toàn bộ lịch sử.
    const existingPayments = await this.repo.countPayments(ctx.organizationId, ctx.shopId);
    const fullHistory = options.full === true || existingPayments === 0;
    const from = fullHistory ? undefined : this.windowStartSeconds();

    await this.syncPayments(ctx, shopCipher, token.accessToken, from, options, outcome, now);
    await this.syncStatements(ctx, shopCipher, token.accessToken, from, options, outcome, now);

    outcome.statementsLinked = await this.repo.linkStatementsToPayments(
      ctx.organizationId,
      ctx.shopId,
    );

    await this.syncStatementTransactions(ctx, shopCipher, token.accessToken, options, outcome, now);

    const summary = await this.repo.summarize(ctx.organizationId, ctx.shopId);
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'payout.sync',
      organizationId: ctx.organizationId,
      shopId: ctx.shopId,
      fullHistory,
      apiCalls: outcome.apiCalls,
      ...summary,
      msg: 'Hoàn tất đồng bộ payout cho shop',
    });
  }

  /** Bước 1 — Get Payments, phân trang tới hết. */
  private async syncPayments(
    ctx: PayoutWriteContext,
    shopCipher: string,
    accessToken: string,
    createTimeGe: number | undefined,
    options: PayoutSyncOptions,
    outcome: PayoutSyncOutcome,
    now: Date,
  ): Promise<void> {
    let pageToken: string | undefined;

    for (let page = 0; page < this.maxPages(); page += 1) {
      if (this.pastDeadline(options)) break;

      const result = await this.financeClient.getPayments({
        shopCipher,
        accessToken,
        query: {
          page_size: TIKTOK_FINANCE_PAGE_SIZE_MAX,
          page_token: pageToken,
          sort_field: 'create_time',
          sort_order: 'ASC',
          create_time_ge: createTimeGe,
        },
      });
      outcome.apiCalls += 1;

      const mapped = result.payments
        .map((payment) => this.mapper.mapPayment(payment))
        .filter((payment): payment is NonNullable<typeof payment> => payment !== null);

      const counters = await this.repo.upsertPayments(ctx, mapped, now);
      outcome.paymentsCreated += counters.created;
      outcome.paymentsUpdated += counters.updated;

      if (!result.nextPageToken || result.nextPageToken === pageToken) break;
      pageToken = result.nextPageToken;
    }
  }

  /** Bước 2 — Get Statements, phân trang tới hết. */
  private async syncStatements(
    ctx: PayoutWriteContext,
    shopCipher: string,
    accessToken: string,
    statementTimeGe: number | undefined,
    options: PayoutSyncOptions,
    outcome: PayoutSyncOutcome,
    now: Date,
  ): Promise<void> {
    let pageToken: string | undefined;

    for (let page = 0; page < this.maxPages(); page += 1) {
      if (this.pastDeadline(options)) break;

      const result = await this.financeClient.getStatements({
        shopCipher,
        accessToken,
        query: {
          page_size: TIKTOK_FINANCE_PAGE_SIZE_MAX,
          page_token: pageToken,
          sort_field: 'statement_time',
          sort_order: 'ASC',
          statement_time_ge: statementTimeGe,
        },
      });
      outcome.apiCalls += 1;

      const mapped = result.statements
        .map((statement) => this.mapper.mapStatement(statement))
        .filter((statement): statement is NonNullable<typeof statement> => statement !== null);

      const counters = await this.repo.upsertStatements(ctx, mapped, now);
      outcome.statementsCreated += counters.created;
      outcome.statementsUpdated += counters.updated;

      if (!result.nextPageToken || result.nextPageToken === pageToken) break;
      pageToken = result.nextPageToken;
    }
  }

  /**
   * Bước 3 — giao dịch cấp đơn cho các statement chưa kéo.
   *
   * Giới hạn số statement mỗi lượt (`statementsPerRun`) để không chiếm hết deadline cron;
   * phần còn lại tự động chạy ở lượt sau vì cờ `transactions_synced_at` vẫn NULL.
   */
  private async syncStatementTransactions(
    ctx: PayoutWriteContext,
    shopCipher: string,
    accessToken: string,
    options: PayoutSyncOptions,
    outcome: PayoutSyncOutcome,
    now: Date,
  ): Promise<void> {
    const limit = this.config.get<number>('tiktok.payout.statementsPerRun', 50);
    const pending = await this.repo.findStatementsNeedingTransactions(
      ctx.organizationId,
      ctx.shopId,
      limit,
    );

    for (const statement of pending) {
      if (this.pastDeadline(options)) break;

      const transactions = [];
      const orderIds = new Set<string>();
      let pageToken: string | undefined;

      for (let page = 0; page < this.maxPages(); page += 1) {
        const result = await this.financeClient.getStatementTransactions({
          statementId: statement.tiktokStatementId,
          shopCipher,
          accessToken,
          query: {
            page_size: TIKTOK_FINANCE_PAGE_SIZE_MAX,
            page_token: pageToken,
            sort_field: 'order_create_time',
            sort_order: 'ASC',
          },
        });
        outcome.apiCalls += 1;

        for (const raw of result.transactions) {
          const mapped = this.mapper.mapStatementTransaction(
            raw,
            result.currency ?? statement.currency,
          );
          if (!mapped) continue;
          transactions.push(mapped);
          // 🔴 CHỈ đếm dòng ORDER: dòng RESERVE trỏ lại chính đơn đó qua
          // `associated_order_id`, đếm cả hai sẽ nhân đôi số đơn.
          if (mapped.data.type === 'ORDER' && mapped.data.tiktokOrderId) {
            orderIds.add(mapped.data.tiktokOrderId);
          }
        }

        if (!result.nextPageToken || result.nextPageToken === pageToken) break;
        pageToken = result.nextPageToken;
      }

      if (transactions.length === 0) {
        await this.repo.markTransactionsSynced(statement.id, now);
      } else {
        await this.repo.replaceStatementTransactions(
          ctx,
          statement.id,
          transactions,
          orderIds.size,
          now,
        );
      }

      outcome.transactionsStatements += 1;
      outcome.ordersCounted += orderIds.size;
    }
  }

  /** Mốc bắt đầu của cửa sổ cuốn chiếu (Unix seconds). */
  private windowStartSeconds(): number {
    const days = this.config.get<number>('tiktok.payout.windowDays', 90);
    return Math.floor(Date.now() / 1000) - days * SECONDS_PER_DAY;
  }

  private maxPages(): number {
    return this.config.get<number>('tiktok.payout.maxPagesPerRun', 100);
  }

  private pastDeadline(options: PayoutSyncOptions): boolean {
    return options.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
  }

  private describeError(error: unknown): { errorCode: string; errorMessage: string } {
    if (error instanceof TiktokClientError) {
      return {
        errorCode: String(error.tiktokCode),
        errorMessage: `${error.errorClass}: ${error.tiktokMessage}`.slice(0, 1000),
      };
    }
    return {
      errorCode: 'INTERNAL',
      errorMessage: (error as Error).message?.slice(0, 1000) ?? 'Lỗi không xác định',
    };
  }
}
