import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PodShopSyncType,
  PodSyncStatus,
  PodSyncTrigger,
  PodTiktokAccountStatus,
  PodTiktokShopStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationOutboxService } from '../../notification/services/notification-outbox.service';
import type { NotificationEventInput } from '../../notification/types/notification-payload.types';
import { TIKTOK_ERROR_CODES, TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodShopSyncStatusRepository } from '../../pod-tiktok/repositories/pod-shop-sync-status.repository';
import {
  PodTiktokShopContextException,
  PodTiktokShopContextService,
} from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokReturnRefundApiService } from '../../tiktok-sdk/tiktok-return-refund-api.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_RETURN_ORDERS_PATH,
  POD_RETURN_REQUIRED_SCOPE,
  POD_RETURN_SYNC_ERROR_CODES,
  POD_RETURN_SYNC_GLOBAL_LOCK,
  POD_RETURN_SYNC_SHOP_LOCK_PREFIX,
  type PodReturnSyncErrorCode,
} from '../constants/pod-return.constants';
import { mapReturnOrder, sumPaidAmount, type MappedReturn } from '../mappers/pod-return.mapper';
import { PodReturnRepository } from '../repositories/pod-return.repository';

/** Một shop cần đồng bộ (đủ khoá tenant + watermark). */
export interface ReturnSyncShop {
  id: string;
  organizationId: string;
  accountId: string;
  name: string | null;
  lastReturnSyncCursor: bigint | null;
  /**
   * Kết nối có scope `seller.return_refund.basic` không, theo `granted_scopes` TikTok trả lúc uỷ quyền.
   * `false` ⇒ biết chắc thiếu ⇒ KHÔNG gọi TikTok; `null`/không có ⇒ chưa biết ⇒ vẫn gọi (TikTok trả 105005 nếu thiếu).
   */
  scopeGranted?: boolean | null;
}

export interface ReturnShopSyncResult {
  shopId: string;
  shopName: string | null;
  status: PodSyncStatus;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  notified: number;
  errorCode: PodReturnSyncErrorCode | null;
  errorMessage: string | null;
}

interface BatchContext {
  shop: ReturnSyncShop;
  now: Date;
  /** Có gửi thông báo cho yêu cầu MỚI trong lượt này không (không trong lượt nhập lịch sử). */
  notify: boolean;
  /** Chỉ yêu cầu TẠO trên TikTok từ mốc này mới là "mới" (chặn yêu cầu cũ lần đầu lọt vào cửa sổ). */
  notifyCreatedFrom: number;
  party: { sellerName: string | null; accountName: string | null; shopName: string | null } | null;
}

/**
 * PodReturnSyncService — đồng bộ yêu cầu Return/Refund TikTok vào `pod_return_requests`.
 *
 * ```
 *   (cron | Sync Now) ─▶ khoá Redis theo shop ─▶ pod_shop_sync_statuses (RETURN, RUNNING)
 *     ─▶ Search Returns 202602, update_time ≥ watermark − overlap, ASC, page_token tới hết (≤ trần)
 *        └─ mỗi trang: map ─▶ nối đơn / giá dòng ─▶ mỗi yêu cầu MỘT transaction ngắn:
 *             mới   ⇒ INSERT + dòng hàng + (sự kiện thông báo trong CÙNG transaction)
 *             đổi   ⇒ UPDATE + thay dòng hàng
 *             y hệt ⇒ chỉ chạm last_synced_at
 *     ─▶ watermark tiến CHỈ khi không có lỗi ─▶ ghi kết quả (SUCCESS | PARTIAL | FAILED)
 * ```
 *
 * 🔴 Không bao giờ giữ transaction trong lúc gọi TikTok: trang được tải xong rồi mới ghi.
 * 🔴 Chống trùng: UNIQUE (organization_id, tiktok_return_id) + khoá theo shop; thông báo có khoá
 *    idempotency ở outbox (một yêu cầu tối đa MỘT tin, dù cron / Sync Now / chạy lại).
 * 🔴 Một shop lỗi không ảnh hưởng shop khác; lỗi scope (105005) được ghi rõ, KHÔNG thành "0 yêu cầu".
 */
@Injectable()
export class PodReturnSyncService {
  private readonly logger = new Logger(PodReturnSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly repo: PodReturnRepository,
    private readonly api: TiktokReturnRefundApiService,
    private readonly shopContext: PodTiktokShopContextService,
    private readonly syncStatus: PodShopSyncStatusRepository,
    private readonly locks: DistributedLockService,
    private readonly notifications: NotificationOutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lượt cron (mọi tổ chức)
  // ---------------------------------------------------------------------------

  async runAll(): Promise<ReturnShopSyncResult[] | null> {
    const ttl = this.settings().lockTtlMs;
    const lock = await this.locks.acquire(POD_RETURN_SYNC_GLOBAL_LOCK, ttl);
    if (!lock) return null;
    const watchdog = this.keepAlive(lock, ttl);
    try {
      await this.syncStatus.failStaleRuns(PodShopSyncType.RETURN, new Date(Date.now() - 2 * ttl));
      const shops = await this.findEligibleShops();
      return await this.runShops(shops, PodSyncTrigger.CRON, null);
    } finally {
      clearInterval(watchdog);
      await this.locks.release(lock);
    }
  }

  /** Đồng bộ thủ công các shop ĐÃ được kiểm phạm vi ở tầng service. */
  async runForShops(organizationId: string, shopIds: string[] | undefined, userId: string) {
    await this.syncStatus.failStaleRuns(
      PodShopSyncType.RETURN,
      new Date(Date.now() - 2 * this.settings().lockTtlMs),
    );
    const shops = await this.findEligibleShops(organizationId, shopIds);
    return this.runShops(shops, PodSyncTrigger.MANUAL, userId);
  }

  // ---------------------------------------------------------------------------
  // Một shop
  // ---------------------------------------------------------------------------

  async syncShop(
    shop: ReturnSyncShop,
    trigger: PodSyncTrigger,
    triggeredBy: string | null,
  ): Promise<ReturnShopSyncResult> {
    const result: ReturnShopSyncResult = {
      shopId: shop.id,
      shopName: shop.name,
      status: PodSyncStatus.SUCCESS,
      fetched: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      notified: 0,
      errorCode: null,
      errorMessage: null,
    };
    const ttl = this.settings().lockTtlMs;
    const lock = await this.locks.acquire(`${POD_RETURN_SYNC_SHOP_LOCK_PREFIX}${shop.id}`, ttl);
    if (!lock) {
      return {
        ...result,
        status: PodSyncStatus.SKIPPED,
        errorCode: POD_RETURN_SYNC_ERROR_CODES.ALREADY_RUNNING,
        errorMessage: 'Shop đang có một lượt đồng bộ Return/Refund khác.',
      };
    }
    const watchdog = this.keepAlive(lock, ttl);
    const startedAt = new Date();
    const handle = await this.syncStatus.start({
      organizationId: shop.organizationId,
      accountId: shop.accountId,
      shopId: shop.id,
      syncType: PodShopSyncType.RETURN,
      trigger,
      triggeredBy,
      startedAt,
    });
    const details: Record<string, unknown> = {};

    try {
      await this.run(shop, startedAt, result, details);
    } catch (error) {
      const described = describeSyncError(error);
      result.errorCode = described.code;
      result.errorMessage = described.message;
      result.status = result.fetched > 0 ? PodSyncStatus.PARTIAL : PodSyncStatus.FAILED;
      if (described.requestId) details.tiktokRequestId = described.requestId;
      this.logger.error({
        module: 'pod-return',
        operation: 'return.sync.shop',
        organizationId: shop.organizationId,
        shopId: shop.id,
        errorCode: described.code,
        tiktokRequestId: described.requestId,
        msg: `RETURN_SYNC_FAILED: ${described.message}`,
      });
    } finally {
      clearInterval(watchdog);
      await this.syncStatus
        .finish(handle, {
          status: result.status,
          totalCount: result.fetched,
          createdCount: result.created,
          updatedCount: result.updated,
          skippedCount: result.unchanged,
          failedCount: result.failed,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          details: { ...details, notified: result.notified },
        })
        .catch(() => undefined);
      await this.locks.release(lock);
    }

    this.logger.log({
      module: 'pod-return',
      operation: 'return.sync.shop',
      organizationId: shop.organizationId,
      shopId: shop.id,
      trigger,
      status: result.status,
      fetched: result.fetched,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      failed: result.failed,
      notified: result.notified,
      durationMs: Date.now() - startedAt.getTime(),
      msg: 'RETURN_SYNC_COMPLETED',
    });
    return result;
  }

  private async run(
    shop: ReturnSyncShop,
    startedAt: Date,
    result: ReturnShopSyncResult,
    details: Record<string, unknown>,
  ): Promise<void> {
    const settings = this.settings();
    if (shop.scopeGranted === false) {
      // Biết chắc thiếu scope ⇒ không tiêu quota / không refresh token vô ích; ghi rõ lỗi cho giao diện.
      const described = describeSyncError(
        new TiktokClientError(TiktokErrorClass.AUTH, TIKTOK_ERROR_CODES.SCOPE_DENIED, 'scope not granted', 0),
      );
      result.status = PodSyncStatus.FAILED;
      result.errorCode = described.code;
      result.errorMessage = described.message;
      details.scopeCheck = 'GRANTED_SCOPES';
      return;
    }
    const ctx = await this.shopContext.resolve(shop.organizationId, shop.id);
    const nowSec = Math.floor(startedAt.getTime() / 1000);
    const initial = shop.lastReturnSyncCursor === null;
    const windowFrom = initial
      ? nowSec - settings.initialLookbackDays * 86_400
      : Math.max(0, Number(shop.lastReturnSyncCursor) - settings.overlapSeconds);
    // Cận trên CỐ ĐỊNH của lượt: yêu cầu cập nhật trong lúc đang đồng bộ để lượt sau (overlap bù).
    const windowTo = nowSec;
    Object.assign(details, { phase: initial ? 'INITIAL' : 'INCREMENTAL', windowFrom, windowTo });

    const batch: BatchContext = {
      shop,
      now: startedAt,
      notify: !initial && (await this.safeNotifyEnabled(shop.organizationId)),
      notifyCreatedFrom: windowFrom,
      party: null,
    };
    if (batch.notify) {
      batch.party = await this.repo.findNotificationParty(shop.organizationId, shop.accountId, shop.id);
    }

    let pageToken: string | undefined;
    let pages = 0;
    let maxSeenUpdate = 0;
    let completed = false;
    const seenTokens = new Set<string>();
    while (pages < settings.maxPagesPerRun) {
      const { data, requestId } = await this.api.searchReturns(ctx, {
        pageToken,
        filter: { updateTimeGe: windowFrom, updateTimeLt: windowTo },
      });
      pages += 1;
      details.lastRequestId = requestId;
      if (data.totalCount !== undefined) details.tiktokTotal = data.totalCount;

      for (const order of data.items) maxSeenUpdate = Math.max(maxSeenUpdate, order.updateTime ?? 0);
      await this.ingestPage(data.items, batch, result);

      if (!data.nextPageToken || data.items.length === 0) {
        completed = true;
        break;
      }
      // TikTok trả lại đúng token cũ ⇒ dừng thay vì lặp vô hạn.
      if (seenTokens.has(data.nextPageToken)) {
        completed = true;
        break;
      }
      seenTokens.add(data.nextPageToken);
      pageToken = data.nextPageToken;
    }
    details.pages = pages;

    if (!completed) {
      result.errorCode = POD_RETURN_SYNC_ERROR_CODES.PAGE_LIMIT;
      result.errorMessage = `Chạm trần ${settings.maxPagesPerRun} trang — phần còn lại đồng bộ ở lượt sau.`;
    }
    if (result.failed > 0) {
      result.status = PodSyncStatus.PARTIAL;
      result.errorCode ??= POD_RETURN_SYNC_ERROR_CODES.UNKNOWN;
      result.errorMessage ??= `${result.failed} yêu cầu không ghi được — watermark giữ nguyên để lượt sau thử lại.`;
      return;
    }
    // Watermark: đọc HẾT ⇒ cận trên của lượt; chạm trần trang ⇒ update_time lớn nhất đã ghi (danh
    // sách sắp ASC nên mọi yêu cầu trước mốc đó đã nằm trong DB).
    const cursor = completed ? windowTo : maxSeenUpdate;
    if (cursor > 0) {
      await this.prisma.podTiktokShop.updateMany({
        where: { id: shop.id, organizationId: shop.organizationId },
        data: { lastReturnSyncCursor: BigInt(cursor) },
      });
    }
    if (!completed) result.status = PodSyncStatus.PARTIAL;
  }

  /** Ghi MỘT trang. Lỗi của một yêu cầu không chặn các yêu cầu còn lại. */
  async ingestPage(
    items: Parameters<typeof mapReturnOrder>[0][],
    batch: BatchContext,
    result: ReturnShopSyncResult,
  ): Promise<void> {
    const { shop } = batch;
    result.fetched += items.length;
    const mapped: MappedReturn[] = [];
    for (const item of items) {
      const row = mapReturnOrder(item);
      if (row) mapped.push(row);
      else result.failed += 1;
    }
    if (mapped.length === 0) return;

    const [snapshots, orderIds] = await Promise.all([
      this.repo.findSnapshots(shop.organizationId, mapped.map((row) => row.tiktokReturnId)),
      this.repo.findOrderIds(shop.organizationId, shop.id, mapped.map((row) => row.tiktokOrderId)),
    ]);
    const prices = await this.repo.findLinePrices(
      shop.organizationId,
      [...orderIds.values()],
      mapped.flatMap((row) => row.items.map((item) => item.orderLineItemId ?? '')).filter(Boolean),
    );

    let enqueued = 0;
    for (const row of mapped) {
      const orderId = orderIds.get(row.tiktokOrderId) ?? null;
      const existing = snapshots.get(row.tiktokReturnId);
      // Hash TikTok y hệt và đơn đã nối như cũ ⇒ không ghi lại (chỉ chạm thời điểm đồng bộ).
      if (existing && existing.payloadHash === row.payloadHash && existing.orderId === orderId) {
        result.unchanged += 1;
        continue;
      }
      try {
        const sent = await this.writeOne(row, orderId, prices, batch, existing?.id ?? null);
        if (existing) result.updated += 1;
        else result.created += 1;
        enqueued += sent;
      } catch (error) {
        if (!existing && isUniqueViolation(error)) {
          // Tiến trình khác vừa tạo đúng yêu cầu này ⇒ lần sau sẽ là UPDATE; không tính là lỗi.
          result.unchanged += 1;
          continue;
        }
        result.failed += 1;
        this.logger.warn({
          module: 'pod-return',
          operation: 'return.sync.write',
          organizationId: shop.organizationId,
          shopId: shop.id,
          tiktokReturnId: row.tiktokReturnId,
          msg: `Không ghi được yêu cầu Return/Refund: ${(error as Error).message}`,
        });
      }
    }
    // Yêu cầu đã có (đổi hoặc không) ⇒ đánh dấu đã thấy trong lượt này.
    const existingIds = mapped
      .map((row) => snapshots.get(row.tiktokReturnId))
      .filter((snap): snap is NonNullable<typeof snap> => snap !== undefined)
      .map((snap) => snap.id);
    await this.repo.touchSynced(shop.organizationId, existingIds, batch.now);
    result.notified += enqueued;
    if (enqueued > 0) this.notifications.kick();
  }

  /** MỘT yêu cầu trong MỘT transaction ngắn (chỉ thao tác DB). Trả số sự kiện thông báo đã ghi. */
  private async writeOne(
    row: MappedReturn,
    orderId: string | null,
    prices: Map<string, Prisma.Decimal>,
    batch: BatchContext,
    existingId: string | null,
  ): Promise<number> {
    const { shop } = batch;
    const items = row.items.map((item) => ({
      ...item,
      paidAmount: orderId && item.orderLineItemId ? (prices.get(item.orderLineItemId) ?? null) : null,
    }));
    const data = {
      orderId,
      tiktokOrderId: row.tiktokOrderId,
      returnType: row.returnType,
      returnStatus: row.returnStatus,
      statusGroup: row.statusGroup,
      refundCompleted: row.refundCompleted,
      returnReason: row.returnReason,
      returnReasonText: row.returnReasonText,
      role: row.role,
      arbitrationStatus: row.arbitrationStatus,
      sellerProposedReturnType: row.sellerProposedReturnType,
      partialRefundAmount: row.partialRefundAmount,
      buyerRejectedPartialRefund: row.buyerRejectedPartialRefund,
      currency: row.currency,
      refundTotal: row.refundTotal,
      refundSubtotal: row.refundSubtotal,
      refundShippingFee: row.refundShippingFee,
      refundTax: row.refundTax,
      paidAmount: sumPaidAmount(items),
      itemQuantity: row.itemQuantity,
      returnTrackingNumber: row.returnTrackingNumber,
      returnProviderName: row.returnProviderName,
      tiktokCreateTime: row.tiktokCreateTime,
      tiktokUpdateTime: row.tiktokUpdateTime,
      requestedAt: row.requestedAt,
      tiktokUpdatedAt: row.tiktokUpdatedAt,
      rawPayload: row.rawPayload,
      payloadHash: row.payloadHash,
      lastSyncedAt: batch.now,
    };

    return this.prisma.$transaction(async (tx) => {
      if (existingId) {
        await this.repo.updateRequest(tx, existingId, data);
        await this.repo.replaceItems(tx, shop.organizationId, existingId, items);
        return 0;
      }
      const created = await this.repo.createRequest(tx, {
        ...data,
        organizationId: shop.organizationId,
        accountId: shop.accountId,
        shopId: shop.id,
        tiktokReturnId: row.tiktokReturnId,
      });
      await this.repo.replaceItems(tx, shop.organizationId, created.id, items);
      // 🔴 "Yêu cầu mới" = INSERT vừa thành công ở đây (không dựa trạng thái). Rollback ⇒ sự kiện cũng
      // rollback; UNIQUE ở outbox là hàng rào thứ hai (ON CONFLICT DO NOTHING).
      if (!batch.notify || Number(row.tiktokCreateTime) < batch.notifyCreatedFrom) return 0;
      return this.notifications.enqueueInTransaction(tx, [this.newRequestEvent(created.id, row, data.paidAmount, batch)]);
    });
  }

  private newRequestEvent(
    id: string,
    row: MappedReturn,
    paidAmount: Prisma.Decimal | null,
    batch: BatchContext,
  ): NotificationEventInput {
    const publicUrl = this.config.get<string>('app.publicUrl', '').replace(/\/+$/, '');
    const groups = new Map<string, { productName: string | null; sku: string | null; variant: string | null; quantity: number }>();
    for (const item of row.items) {
      const key = item.skuId ?? `${item.sellerSku ?? ''}|${item.productName ?? ''}|${item.skuName ?? ''}`;
      const group = groups.get(key);
      if (group) group.quantity += 1;
      else groups.set(key, { productName: item.productName, sku: item.sellerSku, variant: item.skuName, quantity: 1 });
    }
    return {
      organizationId: batch.shop.organizationId,
      eventType: 'RETURN_REFUND_REQUEST',
      entityType: 'POD_RETURN_REQUEST',
      entityId: id,
      payload: {
        tiktokReturnId: row.tiktokReturnId,
        tiktokOrderId: row.tiktokOrderId,
        sellerName: batch.party?.sellerName ?? null,
        accountName: batch.party?.accountName ?? null,
        shopName: batch.party?.shopName ?? batch.shop.name,
        returnType: row.returnType,
        reason: row.returnReasonText ?? row.returnReason,
        status: row.returnStatus,
        items: [...groups.values()],
        currency: row.currency,
        paidAmount: paidAmount?.toString() ?? null,
        requestedRefundAmount: row.refundTotal?.toString() ?? null,
        requestedAt: row.requestedAt.toISOString(),
        link: publicUrl ? `${publicUrl}${POD_RETURN_ORDERS_PATH}?search=${encodeURIComponent(row.tiktokOrderId)}` : null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Tiện ích
  // ---------------------------------------------------------------------------

  /** Lỗi khi đọc cấu hình thông báo không được làm hỏng đồng bộ — chỉ bỏ thông báo của lượt. */
  private async safeNotifyEnabled(organizationId: string): Promise<boolean> {
    try {
      return await this.notifications.isEnabled(organizationId, 'RETURN_REFUND_REQUEST');
    } catch (error) {
      this.logger.warn({
        module: 'pod-return',
        operation: 'RETURN_REFUND_REQUEST_NOTIFICATION',
        organizationId,
        msg: `Không đọc được cấu hình thông báo (bỏ thông báo lượt này): ${(error as Error).message}`,
      });
      return false;
    }
  }

  private async runShops(
    shops: ReturnSyncShop[],
    trigger: PodSyncTrigger,
    userId: string | null,
  ): Promise<ReturnShopSyncResult[]> {
    const results: ReturnShopSyncResult[] = [];
    const queue = [...shops];
    const workers = Array.from({ length: Math.min(this.settings().maxConcurrency, queue.length) }, async () => {
      for (let shop = queue.shift(); shop; shop = queue.shift()) {
        try {
          results.push(await this.syncShop(shop, trigger, userId));
        } catch (error) {
          // syncShop đã tự bắt lỗi nghiệp vụ; tới đây là lỗi hạ tầng (DB / Redis) — shop khác vẫn chạy.
          results.push({
            shopId: shop.id,
            shopName: shop.name,
            status: PodSyncStatus.FAILED,
            fetched: 0,
            created: 0,
            updated: 0,
            unchanged: 0,
            failed: 0,
            notified: 0,
            errorCode: POD_RETURN_SYNC_ERROR_CODES.UNKNOWN,
            errorMessage: (error as Error).message,
          });
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Shop đủ điều kiện — CÙNG điều kiện với đồng bộ đơn POD (`listShopsForSync`): đang bật đồng bộ, không
   * bị circuit breaker tạm dừng, kết nối ACTIVE; thêm: loại shop TikTok đã gỡ uỷ quyền (DEAUTHORIZED —
   * gọi API chắc chắn lỗi). Shop INACTIVE ("Die") VẪN đồng bộ: TikTok vẫn cho gọi API và yêu cầu hoàn
   * tiền của đơn cũ vẫn phát sinh / trừ vào quyết toán.
   */
  private async findEligibleShops(organizationId?: string, shopIds?: string[]): Promise<ReturnSyncShop[]> {
    const now = new Date();
    const rows = await this.prisma.podTiktokShop.findMany({
      where: {
        deletedAt: null,
        syncEnabled: true,
        ...(organizationId ? { organizationId } : {}),
        ...(shopIds ? { id: { in: shopIds } } : {}),
        OR: [{ syncPausedUntil: null }, { syncPausedUntil: { lte: now } }],
        status: { not: PodTiktokShopStatus.DEAUTHORIZED },
        account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
      },
      select: {
        id: true,
        organizationId: true,
        accountId: true,
        name: true,
        lastReturnSyncCursor: true,
        account: { select: { grantedScopes: true } },
      },
      orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ account, ...shop }) => ({ ...shop, scopeGranted: hasReturnScope(account.grantedScopes) }));
  }

  private keepAlive(lock: Parameters<DistributedLockService['renew']>[0], ttl: number): NodeJS.Timeout {
    const timer = setInterval(() => void this.locks.renew(lock, ttl), Math.max(10_000, Math.floor(ttl / 3)));
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  private settings() {
    return {
      initialLookbackDays: this.config.get<number>('tiktok.returnSync.initialLookbackDays', 90),
      overlapSeconds: this.config.get<number>('tiktok.returnSync.overlapSeconds', 600),
      maxPagesPerRun: this.config.get<number>('tiktok.returnSync.maxPagesPerRun', 40),
      maxConcurrency: this.config.get<number>('tiktok.returnSync.maxConcurrency', 3),
      lockTtlMs: this.config.get<number>('tiktok.returnSync.lockTtlMs', 600_000),
    };
  }

  /** Ngữ cảnh TikTok của MỘT shop (tenant-scoped) — dùng cho đọc lịch sử theo yêu cầu. */
  resolveContext(organizationId: string, shopId: string): Promise<TiktokShopContext> {
    return this.shopContext.resolve(organizationId, shopId);
  }
}

/** Lỗi ⇒ mã máy đọc được + thông điệp an toàn (không token, không secret). */
export function describeSyncError(error: unknown): {
  code: PodReturnSyncErrorCode;
  message: string;
  requestId?: string;
} {
  if (error instanceof PodTiktokShopContextException) {
    return error.reason === 'SHOP_NOT_FOUND'
      ? { code: POD_RETURN_SYNC_ERROR_CODES.SHOP_NOT_FOUND, message: error.message }
      : { code: POD_RETURN_SYNC_ERROR_CODES.REAUTH_REQUIRED, message: error.message };
  }
  if (error instanceof TiktokClientError) {
    const base = { requestId: error.requestId };
    if (error.tiktokCode === TIKTOK_ERROR_CODES.SCOPE_DENIED) {
      return {
        ...base,
        code: POD_RETURN_SYNC_ERROR_CODES.SCOPE_MISSING,
        message:
          'Ứng dụng chưa được cấp quyền Return & Refund (seller.return_refund.basic) cho shop này. ' +
          'Bật scope trong Partner Center rồi uỷ quyền lại kết nối TikTok.',
      };
    }
    switch (error.errorClass) {
      case TiktokErrorClass.RATE_LIMIT:
        return { ...base, code: POD_RETURN_SYNC_ERROR_CODES.RATE_LIMITED, message: 'TikTok giới hạn tần suất — thử lại sau.' };
      case TiktokErrorClass.TOKEN_EXPIRED:
      case TiktokErrorClass.AUTH:
        return { ...base, code: POD_RETURN_SYNC_ERROR_CODES.REAUTH_REQUIRED, message: `TikTok từ chối xác thực (${error.tiktokCode}) — cần uỷ quyền lại.` };
      case TiktokErrorClass.NETWORK:
      case TiktokErrorClass.SERVER:
        return { ...base, code: POD_RETURN_SYNC_ERROR_CODES.TIKTOK_UNAVAILABLE, message: `TikTok không phản hồi: ${error.tiktokMessage}` };
      default:
        return { ...base, code: POD_RETURN_SYNC_ERROR_CODES.UNKNOWN, message: `TikTok ${error.tiktokCode}: ${error.tiktokMessage}` };
    }
  }
  return { code: POD_RETURN_SYNC_ERROR_CODES.UNKNOWN, message: error instanceof Error ? error.message : 'Lỗi không xác định' };
}

/** `granted_scopes` (JSON mảng) ⇒ có scope Return không; không phải mảng / rỗng ⇒ chưa biết (null). */
export function hasReturnScope(grantedScopes: Prisma.JsonValue | null): boolean | null {
  if (!Array.isArray(grantedScopes) || grantedScopes.length === 0) return null;
  return grantedScopes.includes(POD_RETURN_REQUIRED_SCOPE);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
