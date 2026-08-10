import { Injectable } from '@nestjs/common';
import {
  FulfillmentEventType,
  FulfillmentOrder,
  FulfillmentProductMapping,
  FulfillmentProvider,
  FulfillmentStatus,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Include chuẩn khi đọc một bản ghi fulfillment (kèm items + tài khoản). */
export const FULFILLMENT_ORDER_INCLUDE = {
  items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  account: { select: { id: true, name: true, provider: true } },
} as const satisfies Prisma.FulfillmentOrderInclude;

export type FulfillmentOrderWithRelations = Prisma.FulfillmentOrderGetPayload<{
  include: typeof FULFILLMENT_ORDER_INCLUDE;
}>;

/** Dữ liệu ghi một dòng nhật ký (append-only). */
export interface HistoryEntry {
  organizationId: string;
  fulfillmentOrderId: string;
  eventType: FulfillmentEventType;
  trigger: FulfillmentTrigger;
  fromStatus?: FulfillmentStatus | null;
  toStatus?: FulfillmentStatus | null;
  providerStatus?: string | null;
  success?: boolean;
  message?: string | null;
  payload?: Prisma.InputJsonValue;
  durationMs?: number | null;
  requestId?: string | null;
  performedBy?: string | null;
}

/**
 * FulfillmentRepository — data access cho toàn module.
 *
 * Tenant isolation (ADR-004): mọi method nghiệp vụ nhận `organizationId`.
 * Nhật ký (`history`, `errorLog`, `webhookLog`) chỉ có INSERT — không sửa, không xoá.
 */
@Injectable()
export class FulfillmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  /** Tài khoản đang dùng cho một nhà cung cấp: ưu tiên bản đánh dấu mặc định. */
  findActiveAccount(organizationId: string, provider: FulfillmentProvider) {
    return this.prisma.fulfillmentAccount.findFirst({
      where: { organizationId, provider, isActive: true, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  findAccountById(organizationId: string, id: string) {
    return this.prisma.fulfillmentAccount.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  /** Mọi tài khoản có cấu hình secret webhook — dùng để xác thực request gọi về. */
  findAccountsWithWebhookSecret() {
    return this.prisma.fulfillmentAccount.findMany({
      where: { deletedAt: null, isActive: true, webhookSecretEnc: { not: null } },
    });
  }

  listAccounts(organizationId: string) {
    return this.prisma.fulfillmentAccount.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createAccount(data: Prisma.FulfillmentAccountUncheckedCreateInput) {
    return this.prisma.fulfillmentAccount.create({ data });
  }

  updateAccount(id: string, data: Prisma.FulfillmentAccountUncheckedUpdateInput) {
    return this.prisma.fulfillmentAccount.update({ where: { id }, data });
  }

  async touchAccountUsed(id: string, error?: { message: string } | null): Promise<void> {
    await this.prisma.fulfillmentAccount.update({
      where: { id },
      data: error
        ? { lastErrorAt: new Date(), lastErrorMsg: error.message.slice(0, 1000) }
        : { lastUsedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Product mapping
  // ---------------------------------------------------------------------------

  /**
   * Toàn bộ ánh xạ đang hiệu lực của một tài khoản.
   * Nạp MỘT lần rồi khớp trong bộ nhớ ⇒ kiểm N đơn vẫn chỉ một truy vấn (không N+1).
   */
  listMappings(organizationId: string, accountId: string): Promise<FulfillmentProductMapping[]> {
    return this.prisma.fulfillmentProductMapping.findMany({
      where: { organizationId, accountId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMappingById(organizationId: string, id: string) {
    return this.prisma.fulfillmentProductMapping.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  /** Ánh xạ trùng khoá TikTok trong cùng tài khoản (chặn khai báo mâu thuẫn). */
  findConflictingMapping(
    organizationId: string,
    accountId: string,
    keys: { tiktokSkuId?: string | null; sellerSku?: string | null; tiktokProductId?: string | null },
    excludeId?: string,
  ) {
    const conditions: Prisma.FulfillmentProductMappingWhereInput[] = [];
    if (keys.tiktokSkuId) conditions.push({ tiktokSkuId: keys.tiktokSkuId });
    if (keys.sellerSku) conditions.push({ sellerSku: keys.sellerSku });
    if (keys.tiktokProductId) conditions.push({ tiktokProductId: keys.tiktokProductId });
    if (conditions.length === 0) return Promise.resolve(null);

    return this.prisma.fulfillmentProductMapping.findFirst({
      where: {
        organizationId,
        accountId,
        deletedAt: null,
        OR: conditions,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  createMapping(data: Prisma.FulfillmentProductMappingUncheckedCreateInput) {
    return this.prisma.fulfillmentProductMapping.create({ data });
  }

  updateMapping(id: string, data: Prisma.FulfillmentProductMappingUncheckedUpdateInput) {
    return this.prisma.fulfillmentProductMapping.update({ where: { id }, data });
  }

  async softDeleteMapping(id: string, actorUserId: string): Promise<void> {
    await this.prisma.fulfillmentProductMapping.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
  }

  // ---------------------------------------------------------------------------
  // Fulfillment order
  // ---------------------------------------------------------------------------

  findByPodOrder(
    organizationId: string,
    podOrderId: string,
    provider: FulfillmentProvider,
  ): Promise<FulfillmentOrderWithRelations | null> {
    return this.prisma.fulfillmentOrder.findFirst({
      where: { organizationId, podOrderId, provider, deletedAt: null },
      include: FULFILLMENT_ORDER_INCLUDE,
    });
  }

  /**
   * Bản ghi fulfillment của NHIỀU đơn POD — dùng cho màn hình danh sách.
   * Một truy vấn cho cả trang ⇒ không N+1.
   */
  findByPodOrderIds(
    organizationId: string,
    podOrderIds: string[],
  ): Promise<FulfillmentOrder[]> {
    if (podOrderIds.length === 0) return Promise.resolve([]);
    return this.prisma.fulfillmentOrder.findMany({
      where: { organizationId, podOrderId: { in: podOrderIds }, deletedAt: null },
    });
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<FulfillmentOrderWithRelations | null> {
    return this.prisma.fulfillmentOrder.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: FULFILLMENT_ORDER_INCLUDE,
    });
  }

  /** Tìm theo `order_id` đã gửi sang nhà cung cấp — dùng khi nhận webhook. */
  findByExternalOrderId(externalOrderId: string): Promise<FulfillmentOrder | null> {
    return this.prisma.fulfillmentOrder.findFirst({
      where: { externalOrderId, deletedAt: null },
    });
  }

  /**
   * Tạo bản ghi ở trạng thái DRAFT trước khi gọi API.
   * UNIQUE `(podOrderId, provider)` là hàng rào DB chống gửi trùng khi hai người
   * bấm Fulfill cùng lúc — bản thua sẽ nhận lỗi P2002 và được service xử lý.
   */
  createDraft(data: {
    organizationId: string;
    accountId: string;
    provider: FulfillmentProvider;
    podOrderId: string;
    externalOrderId: string;
    productionLine?: string | null;
    shippingMethod?: string | null;
    facility?: string | null;
    createdBy: string;
  }): Promise<FulfillmentOrder> {
    return this.prisma.fulfillmentOrder.create({
      data: { ...data, status: FulfillmentStatus.DRAFT },
    });
  }

  updateOrder(
    id: string,
    data: Prisma.FulfillmentOrderUncheckedUpdateInput,
  ): Promise<FulfillmentOrder> {
    return this.prisma.fulfillmentOrder.update({ where: { id }, data });
  }

  /** Ghi lại danh sách item đã gửi (thay toàn bộ — mỗi lần gửi là một ảnh chụp mới). */
  async replaceItems(
    fulfillmentOrderId: string,
    organizationId: string,
    items: Array<{
      podOrderItemId: string;
      providerSku: string;
      quantity: number;
      productionConfig: string | null;
      printFiles: Prisma.InputJsonValue;
    }>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.fulfillmentOrderItem.deleteMany({ where: { fulfillmentOrderId } }),
      this.prisma.fulfillmentOrderItem.createMany({
        data: items.map((item) => ({ ...item, fulfillmentOrderId, organizationId })),
      }),
    ]);
  }

  /**
   * Các đơn cần đồng bộ trạng thái: đã gửi đi và chưa ở trạng thái kết thúc.
   * Ưu tiên đơn lâu chưa đồng bộ nhất.
   */
  findOrdersToSync(limit: number, organizationId?: string): Promise<FulfillmentOrder[]> {
    return this.prisma.fulfillmentOrder.findMany({
      where: {
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
        providerOrderId: { not: null },
        status: {
          in: [
            FulfillmentStatus.SUBMITTED,
            FulfillmentStatus.IN_PRODUCTION,
            FulfillmentStatus.ON_HOLD,
            FulfillmentStatus.SHIPPED,
            FulfillmentStatus.UNKNOWN,
          ],
        },
      },
      orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }],
      take: limit,
    });
  }

  // ---------------------------------------------------------------------------
  // Nhật ký (chỉ INSERT)
  // ---------------------------------------------------------------------------

  async addHistory(entry: HistoryEntry): Promise<void> {
    await this.prisma.fulfillmentHistory.create({
      data: {
        organizationId: entry.organizationId,
        fulfillmentOrderId: entry.fulfillmentOrderId,
        eventType: entry.eventType,
        trigger: entry.trigger,
        fromStatus: entry.fromStatus ?? null,
        toStatus: entry.toStatus ?? null,
        providerStatus: entry.providerStatus ?? null,
        success: entry.success ?? true,
        message: entry.message?.slice(0, 2000) ?? null,
        payload: entry.payload,
        durationMs: entry.durationMs ?? null,
        requestId: entry.requestId ?? null,
        performedBy: entry.performedBy ?? null,
      },
    });
  }

  listHistory(organizationId: string, fulfillmentOrderId: string, limit = 100) {
    return this.prisma.fulfillmentHistory.findMany({
      where: { organizationId, fulfillmentOrderId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async addErrorLog(data: {
    organizationId: string;
    fulfillmentOrderId?: string | null;
    provider: FulfillmentProvider;
    operation: string;
    errorClass: string;
    httpStatus?: number | null;
    providerCode?: string | null;
    message: string;
    validationErrors?: Prisma.InputJsonValue;
    rawError?: Prisma.InputJsonValue;
    requestId?: string | null;
    retryable: boolean;
  }): Promise<void> {
    await this.prisma.fulfillmentErrorLog.create({
      data: { ...data, message: data.message.slice(0, 2000) },
    });
  }

  listErrors(organizationId: string, fulfillmentOrderId: string, limit = 20) {
    return this.prisma.fulfillmentErrorLog.findMany({
      where: { organizationId, fulfillmentOrderId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook & sync log
  // ---------------------------------------------------------------------------

  /** Lưu webhook NGAY khi nhận, trước khi xử lý — không bao giờ mất sự kiện. */
  createWebhookLog(data: {
    provider: FulfillmentProvider;
    eventType: string;
    externalOrderId?: string | null;
    payload: Prisma.InputJsonValue;
    headers?: Prisma.InputJsonValue;
    verified: boolean;
    organizationId?: string | null;
    accountId?: string | null;
  }) {
    return this.prisma.fulfillmentWebhookLog.create({ data });
  }

  async markWebhookProcessed(
    id: string,
    data: {
      processed: boolean;
      fulfillmentOrderId?: string | null;
      organizationId?: string | null;
      errorMessage?: string | null;
      deadLetter?: boolean;
    },
  ): Promise<void> {
    await this.prisma.fulfillmentWebhookLog.update({
      where: { id },
      data: {
        processed: data.processed,
        processedAt: data.processed ? new Date() : null,
        fulfillmentOrderId: data.fulfillmentOrderId ?? undefined,
        organizationId: data.organizationId ?? undefined,
        errorMessage: data.errorMessage?.slice(0, 2000) ?? null,
        deadLetter: data.deadLetter ?? false,
        attemptCount: { increment: 1 },
      },
    });
  }

  /** Webhook chưa xử lý được — hàng đợi thử lại cho scheduler. */
  findPendingWebhooks(limit: number, maxAttempts: number) {
    return this.prisma.fulfillmentWebhookLog.findMany({
      where: { processed: false, deadLetter: false, attemptCount: { lt: maxAttempts } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  startSyncLog(data: {
    organizationId: string;
    accountId?: string | null;
    provider: FulfillmentProvider;
    trigger: FulfillmentTrigger;
    triggeredBy?: string | null;
    startedAt: Date;
  }) {
    return this.prisma.fulfillmentSyncLog.create({
      data: { ...data, status: 'RUNNING' },
      select: { id: true },
    });
  }

  async finishSyncLog(
    id: string,
    startedAt: Date,
    data: {
      status: string;
      ordersChecked: number;
      ordersUpdated: number;
      ordersFailed: number;
      apiCalls: number;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.fulfillmentSyncLog.update({
      where: { id },
      data: {
        ...data,
        errorMessage: data.errorMessage?.slice(0, 2000) ?? null,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });
  }

  listSyncLogs(organizationId: string, limit = 20) {
    return this.prisma.fulfillmentSyncLog.findMany({
      where: { organizationId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }
}
