import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationOutboxService } from '../../notification/services/notification-outbox.service';
import { groupOrderLines } from '../../notification/shared/order-items';
import type { NotificationEventInput } from '../../notification/types/notification-payload.types';
import { PodOrderMapper, MappedOrder } from '../mappers/pod-order.mapper';
import { ExistingOrderSnapshot, PodOrderRepository } from '../repositories/pod-order.repository';
import { TiktokOrder } from '../types/tiktok-order.types';

/** Ngữ cảnh ghi dữ liệu — xác định tenant và nguồn ghi. */
export interface IngestionContext {
  organizationId: string;
  accountId: string;
  shopId: string;
  source: 'CRON' | 'MANUAL' | 'BACKFILL';
  /** Bỏ qua so sánh hash và ghi đè tất cả (dùng khi sửa mapping). */
  force?: boolean;
}

/** Kết quả ingest một lô đơn. */
export interface IngestionResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** `update_time` lớn nhất đã xử lý thành công — dùng cho watermark. */
  maxUpdateTime: bigint;
}

/** Ngữ cảnh thông báo NEW ORDER của một lô — `null` ⇒ lô này không phát thông báo. */
interface NewOrderNotifyContext {
  sellerName: string | null;
  accountName: string | null;
  shopName: string | null;
  fulfillmentProvider: string | null;
}

/**
 * PodOrderIngestionService — ghi đơn TikTok vào DB một cách **idempotent**.
 *
 * Quy tắc so sánh (Compare Logic):
 *   1. Chưa tồn tại                              → CREATE
 *   2. Đã tồn tại, `update_time` mới hơn         → UPDATE
 *   3. Đã tồn tại, `update_time` bằng, hash khác → UPDATE
 *      (TikTok có thể đổi field mà không bump `update_time`)
 *   4. Còn lại                                   → SKIP (chỉ chạm `last_synced_at`)
 *
 * Đây là cửa ghi DUY NHẤT cho đơn TikTok — cron, sync thủ công và (sau này) webhook
 * đều đi qua đây, nhờ vậy không thể tạo đơn trùng dù chạy song song.
 */
@Injectable()
export class PodOrderIngestionService {
  private readonly logger = new Logger(PodOrderIngestionService.name);

  /** Số đơn ghi trong một transaction — cân bằng giữa tốc độ và thời gian giữ khoá DB. */
  private static readonly WRITE_BATCH_SIZE = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PodOrderRepository,
    private readonly mapper: PodOrderMapper,
    private readonly notifications: NotificationOutboxService,
  ) {}

  /** Ingest một lô đơn (thường là một trang kết quả từ TikTok). */
  async ingestBatch(orders: TiktokOrder[], ctx: IngestionContext): Promise<IngestionResult> {
    const result: IngestionResult = {
      total: orders.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      maxUpdateTime: 0n,
    };
    if (orders.length === 0) return result;

    const mapped = orders.map((order) => this.mapper.map(order));

    // Một query duy nhất lấy toàn bộ snapshot đang có (chống N+1).
    const snapshots = await this.repo.findSnapshotsByTiktokOrderIds(
      ctx.organizationId,
      mapped.map((m) => m.tiktokOrderId),
    );

    const toCreate: MappedOrder[] = [];
    const toUpdate: Array<{ mapped: MappedOrder; existing: ExistingOrderSnapshot }> = [];
    const toSkip: string[] = [];

    for (const item of mapped) {
      const existing = snapshots.get(item.tiktokOrderId);
      if (!existing) {
        toCreate.push(item);
      } else if (ctx.force || this.hasChanged(item, existing)) {
        toUpdate.push({ mapped: item, existing });
      } else {
        toSkip.push(item.tiktokOrderId);
      }
    }

    // Hash của item hiện có — một query cho toàn bộ đơn sẽ update.
    const itemHashes = await this.repo.findItemHashesByOrderIds(
      toUpdate.map((entry) => entry.existing.id),
    );

    const now = new Date();
    const notify = await this.newOrderNotifyContext(ctx, toCreate.length);
    let notificationsEnqueued = 0;

    // --- CREATE (theo lô, mỗi lô một transaction) ---
    for (const batch of this.chunk(toCreate, PodOrderIngestionService.WRITE_BATCH_SIZE)) {
      for (const item of batch) {
        try {
          notificationsEnqueued += await this.prisma.$transaction((tx) =>
            this.createOrder(tx, item, ctx, now, notify),
          );
          result.created += 1;
          result.maxUpdateTime = this.max(result.maxUpdateTime, item.tiktokUpdateTime);
        } catch (error) {
          // Đơn đã được tiến trình khác tạo giữa chừng → chuyển sang update, không tính lỗi.
          if (this.isUniqueViolation(error)) {
            const retry = await this.recoverFromRaceCondition(item, ctx, now);
            if (retry) {
              result.updated += 1;
              result.maxUpdateTime = this.max(result.maxUpdateTime, item.tiktokUpdateTime);
              continue;
            }
          }
          result.failed += 1;
          this.logFailure(item.tiktokOrderId, ctx, error);
        }
      }
    }

    // Sự kiện đã commit cùng đơn ⇒ đánh thức worker (gửi bất đồng bộ, không chờ Telegram).
    if (notificationsEnqueued > 0) this.notifications.kick();

    // --- UPDATE --- (không bao giờ phát NEW ORDER: đơn đã tồn tại, kể cả khi đổi trạng thái)
    for (const batch of this.chunk(toUpdate, PodOrderIngestionService.WRITE_BATCH_SIZE)) {
      for (const entry of batch) {
        try {
          await this.prisma.$transaction((tx) =>
            this.updateOrder(tx, entry.mapped, entry.existing, ctx, now, itemHashes),
          );
          result.updated += 1;
          result.maxUpdateTime = this.max(result.maxUpdateTime, entry.mapped.tiktokUpdateTime);
        } catch (error) {
          result.failed += 1;
          this.logFailure(entry.mapped.tiktokOrderId, ctx, error);
        }
      }
    }

    // --- SKIP: chỉ cập nhật last_synced_at bằng MỘT lệnh updateMany ---
    if (toSkip.length > 0) {
      await this.repo.touchLastSynced(toSkip, ctx.organizationId, now);
      result.skipped = toSkip.length;
      for (const id of toSkip) {
        const item = mapped.find((m) => m.tiktokOrderId === id);
        if (item) result.maxUpdateTime = this.max(result.maxUpdateTime, item.tiktokUpdateTime);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Có thay đổi thật sự hay không.
   * `update_time` là tín hiệu chính (tài liệu khuyến nghị dùng để tối ưu sync);
   * hash là lưới an toàn cho trường hợp TikTok đổi nội dung mà không bump `update_time`.
   */
  private hasChanged(mapped: MappedOrder, existing: ExistingOrderSnapshot): boolean {
    if (mapped.tiktokUpdateTime > existing.tiktokUpdateTime) return true;
    return mapped.payloadHash !== existing.payloadHash;
  }

  /**
   * Lô này có phát thông báo NEW ORDER không — quyết định MỘT lần cho cả lô.
   *
   * - Pha BACKFILL (kéo lịch sử khi mới kết nối / kéo lại toàn bộ) KHÔNG phát: mỗi đơn lịch sử đều là
   *   INSERT lần đầu, phát ra là spam hàng trăm tin (quyết định của PO).
   * - Tổ chức chưa bật Telegram ⇒ không ghi sự kiện (không sinh dòng thừa cho mọi đơn).
   * - Lỗi khi đọc ngữ cảnh ⇒ bỏ thông báo của lô, KHÔNG làm hỏng việc ghi đơn.
   */
  private async newOrderNotifyContext(
    ctx: IngestionContext,
    createCount: number,
  ): Promise<NewOrderNotifyContext | null> {
    if (createCount === 0 || ctx.source === 'BACKFILL') return null;
    try {
      if (!(await this.notifications.isEnabled(ctx.organizationId, 'ORDER_CREATED'))) return null;
      const context = await this.repo.findNotificationContext(
        ctx.organizationId,
        ctx.accountId,
        ctx.shopId,
      );
      return context ?? { sellerName: null, accountName: null, shopName: null, fulfillmentProvider: null };
    } catch (error) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'ORDER_CREATED_NOTIFICATION',
        organizationId: ctx.organizationId,
        shopId: ctx.shopId,
        msg: `Không chuẩn bị được thông báo đơn mới (bỏ qua, đồng bộ vẫn chạy): ${(error as Error).message}`,
      });
      return null;
    }
  }

  /** Tạo đơn; trả số sự kiện thông báo đã ghi (0 hoặc 1) trong CÙNG transaction. */
  private async createOrder(
    tx: Prisma.TransactionClient,
    mapped: MappedOrder,
    ctx: IngestionContext,
    now: Date,
    notify: NewOrderNotifyContext | null = null,
  ): Promise<number> {
    const created = await this.repo.createOrder(tx, {
      ...mapped.data,
      organizationId: ctx.organizationId,
      accountId: ctx.accountId,
      shopId: ctx.shopId,
      payloadHash: mapped.payloadHash,
      syncSource: ctx.source,
      syncVersion: 0,
      lastSyncedAt: now,
    });

    for (const item of mapped.items) {
      await this.repo.upsertItem(tx, ctx.organizationId, created.id, item.data);
    }
    await this.repo.upsertPackages(tx, ctx.organizationId, created.id, mapped.packageIds);

    if (!notify) return 0;
    // 🔴 NEW ORDER = đúng thời điểm này: INSERT vừa thành công trong transaction. Không dựa vào trạng
    // thái đơn / create_time của TikTok. Transaction rollback (vd đơn bị tiến trình khác tạo trước ⇒
    // P2002) thì sự kiện cũng rollback; UNIQUE ở outbox là hàng rào thứ hai (ON CONFLICT DO NOTHING).
    return this.notifications.enqueueInTransaction(tx, [
      this.newOrderEvent(created.id, mapped, ctx, notify),
    ]);
  }

  /** Ảnh chụp dữ liệu cho tin NEW ORDER — KHÔNG gồm địa chỉ / email / SĐT người mua. */
  private newOrderEvent(
    orderId: string,
    mapped: MappedOrder,
    ctx: IngestionContext,
    notify: NewOrderNotifyContext,
  ): NotificationEventInput {
    const { totalAmount, currency, tiktokCreateTime } = mapped.data;
    const createSeconds =
      tiktokCreateTime === undefined || tiktokCreateTime === null ? null : Number(tiktokCreateTime);
    return {
      organizationId: ctx.organizationId,
      eventType: 'ORDER_CREATED',
      entityType: 'POD_ORDER',
      entityId: orderId,
      payload: {
        tiktokOrderId: mapped.tiktokOrderId,
        sellerName: notify.sellerName,
        accountName: notify.accountName,
        shopName: notify.shopName,
        items: groupOrderLines(
          mapped.items.map((item) => ({
            skuId: item.data.skuId,
            sellerSku: item.data.sellerSku,
            productName: item.data.productName,
            skuName: item.data.skuName,
          })),
        ),
        totalAmount:
          totalAmount === null || totalAmount === undefined
            ? null
            : new Prisma.Decimal(totalAmount as Prisma.Decimal.Value).toString(),
        currency: currency ?? null,
        orderCreatedAt:
          createSeconds && Number.isFinite(createSeconds)
            ? new Date(createSeconds * 1000).toISOString()
            : null,
        fulfillmentProvider: notify.fulfillmentProvider,
        syncSource: ctx.source,
      },
    };
  }

  private async updateOrder(
    tx: Prisma.TransactionClient,
    mapped: MappedOrder,
    existing: ExistingOrderSnapshot,
    ctx: IngestionContext,
    now: Date,
    itemHashes: Map<string, Map<string, string>>,
  ): Promise<void> {
    const patch: Prisma.PodOrderUncheckedUpdateInput = {
      ...mapped.data,
      payloadHash: mapped.payloadHash,
      syncSource: ctx.source,
      syncVersion: { increment: 1 },
      lastSyncedAt: now,
    };

    // 🔴 Masking-safe write: KHÔNG ghi đè PII thật bằng giá trị đã bị che.
    // Đơn cũ (>30 ngày sau COMPLETED) hoặc đơn 4PL sẽ trả recipient đã che;
    // ghi đè sẽ làm MẤT dữ liệu thật vĩnh viễn.
    if (mapped.recipientMasked && !existing.recipientMasked) {
      delete patch.recipientEnc;
      delete patch.recipientPostalCode;
      delete patch.recipientRegionCode;
      // Vẫn ghi nhận rằng TikTok đã bắt đầu che dữ liệu này.
      patch.recipientMasked = true;
    }

    await this.repo.updateOrder(tx, existing.id, patch);

    // Chỉ ghi item khi hash đổi (hoặc item mới) — tránh update thừa.
    const currentHashes = itemHashes.get(existing.id) ?? new Map<string, string>();
    for (const item of mapped.items) {
      if (currentHashes.get(item.tiktokLineItemId) === item.payloadHash && !ctx.force) continue;
      await this.repo.upsertItem(tx, ctx.organizationId, existing.id, item.data);
    }
    // KHÔNG xoá item cũ khi TikTok không còn trả về (yêu cầu nghiệp vụ Sprint 2).
    await this.repo.upsertPackages(tx, ctx.organizationId, existing.id, mapped.packageIds);
  }

  /** Xử lý race: đơn vừa được tiến trình khác tạo giữa lúc ta đang INSERT. */
  private async recoverFromRaceCondition(
    mapped: MappedOrder,
    ctx: IngestionContext,
    now: Date,
  ): Promise<boolean> {
    const snapshots = await this.repo.findSnapshotsByTiktokOrderIds(ctx.organizationId, [
      mapped.tiktokOrderId,
    ]);
    const existing = snapshots.get(mapped.tiktokOrderId);
    if (!existing) return false;

    const itemHashes = await this.repo.findItemHashesByOrderIds([existing.id]);
    await this.prisma.$transaction((tx) =>
      this.updateOrder(tx, mapped, existing, ctx, now, itemHashes),
    );
    this.logger.warn({
      module: 'pod-tiktok',
      operation: 'order.ingest',
      organizationId: ctx.organizationId,
      tiktokOrderId: mapped.tiktokOrderId,
      msg: 'Phát hiện tạo trùng đồng thời — đã chuyển sang cập nhật',
    });
    return true;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private logFailure(tiktokOrderId: string, ctx: IngestionContext, error: unknown): void {
    this.logger.error({
      module: 'pod-tiktok',
      operation: 'order.ingest',
      organizationId: ctx.organizationId,
      shopId: ctx.shopId,
      tiktokOrderId,
      msg: `Ghi đơn thất bại: ${(error as Error).message}`,
    });
  }

  private chunk<T>(list: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
    return result;
  }

  private max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
  }
}
