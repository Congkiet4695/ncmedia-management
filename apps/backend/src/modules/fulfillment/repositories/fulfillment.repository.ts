import { Injectable } from '@nestjs/common';
import {
  FulfillmentEventType,
  FulfillmentOrder,
  FulfillmentProvider,
  FulfillmentStatus,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { MappingWithDesigns } from '../services/fulfillment-readiness.service';

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

  /**
   * Xoá MỀM nhà cung cấp.
   *
   * Không xoá cứng: `fulfillment_orders` tham chiếu tới đây bằng RESTRICT, và lịch sử đơn
   * đã gửi phải tra ngược được về nhà cung cấp nào đã sản xuất. Kết nối TikTok đang trỏ
   * tới bản ghi này được gỡ liên kết trong CÙNG một giao dịch.
   */
  async softDeleteAccount(id: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.podTiktokAccount.updateMany({
        where: { fulfillmentAccountId: id, deletedAt: null },
        data: { fulfillmentAccountId: null, updatedBy: actorUserId },
      });
      return tx.fulfillmentAccount.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, updatedBy: actorUserId },
      });
    });
  }

  /**
   * Số kết nối TikTok theo từng nhà cung cấp, gom trong MỘT truy vấn.
   * Dùng cho màn hình danh sách — đếm trong vòng lặp sẽ thành N+1.
   */
  async countTiktokAccountsGroupedByProvider(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.podTiktokAccount.groupBy({
      by: ['fulfillmentAccountId'],
      where: { organizationId, deletedAt: null, fulfillmentAccountId: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      rows
        .filter((row): row is typeof row & { fulfillmentAccountId: string } =>
          Boolean(row.fulfillmentAccountId),
        )
        .map((row) => [row.fulfillmentAccountId, row._count._all]),
    );
  }

  /** Đếm kết nối TikTok đang trỏ tới nhà cung cấp — dùng để cảnh báo trước khi xoá. */
  countTiktokAccountsByProvider(organizationId: string, accountId: string) {
    return this.prisma.podTiktokAccount.count({
      where: { organizationId, fulfillmentAccountId: accountId, deletedAt: null },
    });
  }

  /** Đếm đơn đã gửi qua nhà cung cấp — dùng để cảnh báo trước khi xoá. */
  countOrdersByAccount(organizationId: string, accountId: string) {
    return this.prisma.fulfillmentOrder.count({
      where: { organizationId, accountId, deletedAt: null },
    });
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
  /**
   * Danh sách ánh xạ có lọc + phân trang (màn hình Product Mapping).
   *
   * `keyword` tìm đồng thời trên **Product ID, Seller SKU**, Fulfillment SKU và tên sản phẩm
   * nhà cung cấp — Product ID nằm trong đó vì nó là một nửa khoá nghiệp vụ, người dùng dán
   * thẳng từ TikTok vào ô tìm kiếm.
   *
   * ⚠️ KHÔNG nạp design ở đây được nữa: design đã tách khỏi ánh xạ và khoá theo
   * (Product ID + Seller SKU), không còn quan hệ Prisma để `include`. Service nạp design của
   * cả trang bằng MỘT truy vấn riêng rồi ghép theo khoá — vẫn không N+1.
   */
  async listMappingsPaged(params: {
    organizationId: string;
    accountId?: string;
    provider?: FulfillmentProvider;
    isActive?: boolean;
    keyword?: string;
    page: number;
    limit: number;
  }): Promise<{ items: MappingWithDesigns[]; total: number }> {
    const keyword = params.keyword?.trim();
    const where: Prisma.FulfillmentProductMappingWhereInput = {
      organizationId: params.organizationId,
      deletedAt: null,
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(keyword
        ? {
            OR: [
              { tiktokProductId: { contains: keyword, mode: 'insensitive' } },
              { sellerSku: { contains: keyword, mode: 'insensitive' } },
              { providerSku: { contains: keyword, mode: 'insensitive' } },
              { providerProductName: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.fulfillmentProductMapping.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.fulfillmentProductMapping.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Các SKU TikTok phân biệt đã từng xuất hiện trong đơn của tổ chức.
   *
   * Gom nhóm ở tầng DATABASE thay vì tải hết dòng hàng rồi lọc trong bộ nhớ — một tổ chức
   * chạy lâu có hàng chục nghìn dòng hàng nhưng chỉ vài chục SKU khác nhau.
   */
  async listDistinctTiktokSkus(
    organizationId: string,
    search?: string,
  ): Promise<
    Array<{
      productId: string | null;
      skuId: string | null;
      sellerSku: string | null;
      productName: string | null;
      skuName: string | null;
      productCategory: string | null;
      skuImage: string | null;
    }>
  > {
    const keyword = search?.trim();
    const like = keyword ? `%${keyword}%` : null;

    // 🔴 Gom theo ĐÚNG khoá nghiệp vụ (product_id, seller_sku) — một dòng cho mỗi sản phẩm
    // cần ánh xạ. Gom theo sku_id như trước sẽ hiện cùng một sản phẩm nhiều lần (mỗi shop
    // một sku_id), mời người dùng khai trùng đúng cái mà UNIQUE index sẽ từ chối.
    // Dòng hàng thiếu một trong hai khoá không thể ánh xạ ⇒ loại luôn.
    return this.prisma.$queryRaw`
      SELECT DISTINCT ON (i.product_id, i.seller_sku)
             i.product_id        AS "productId",
             i.sku_id            AS "skuId",
             i.seller_sku        AS "sellerSku",
             i.product_name      AS "productName",
             i.sku_name          AS "skuName",
             i.product_category  AS "productCategory",
             i.sku_image         AS "skuImage"
      FROM pod_order_items i
      WHERE i.organization_id = ${organizationId}::uuid
        AND i.deleted_at IS NULL
        AND i.product_id IS NOT NULL
        AND i.seller_sku IS NOT NULL
        AND (${like}::text IS NULL
             OR i.product_name ILIKE ${like}
             OR i.seller_sku   ILIKE ${like}
             OR i.product_id   ILIKE ${like}
             OR i.sku_name     ILIKE ${like})
      ORDER BY i.product_id, i.seller_sku, i.created_at DESC
      LIMIT 200`;
  }

  /**
   * Ánh xạ sản phẩm của một tài khoản, **kèm design đang hiệu lực**.
   *
   * 🔴 Nạp design ngay tại đây vì kiểm tra readiness luôn cần cả hai: có ánh xạ chưa, và
   * ánh xạ đó đã có file in chưa. Tách hai truy vấn chỉ tạo cơ hội cho một trong hai bị quên.
   */
  listMappings(organizationId: string, accountId: string): Promise<MappingWithDesigns[]> {
    return this.prisma.fulfillmentProductMapping.findMany({
      where: { organizationId, accountId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * MỌI ánh xạ đang bật của tổ chức, kèm design.
   *
   * 🔴 Phạm vi TỔ CHỨC chứ không phải tài khoản: danh tính của ánh xạ là (Product ID +
   * Seller SKU) trên toàn tổ chức, nên câu hỏi "sản phẩm này đã ánh xạ chưa" không phụ thuộc
   * đang xét nhà cung cấp nào.
   */
  listMappingsForOrganization(organizationId: string): Promise<MappingWithDesigns[]> {
    return this.prisma.fulfillmentProductMapping.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Design đang hiệu lực của MỘT tổ chức, tra theo (Product ID + Seller SKU).
   *
   * 🔴 MỘT truy vấn cho cả trang. Design không còn là quan hệ của ánh xạ nên không
   * `include` được; bù lại bằng một lượt đọc theo lô rồi ghép trong bộ nhớ — chi phí như cũ,
   * và đổi lại design đọc được cho cả sản phẩm CHƯA ánh xạ.
   *
   * `keys` bỏ trống ⇒ lấy toàn bộ design của tổ chức (dùng khi cần cả bảng, vd readiness
   * chạy cho nhiều đơn cùng lúc).
   */
  listProductDesigns(
    organizationId: string,
    keys?: Array<{ tiktokProductId: string; sellerSku: string }>,
  ) {
    return this.prisma.fulfillmentProductDesign.findMany({
      where: {
        organizationId,
        deletedAt: null,
        tiktokProductId: { not: null },
        sellerSku: { not: null },
        ...(keys && keys.length > 0 ? { OR: keys } : {}),
      },
      include: { storageFile: { include: { uploader: { select: { fullName: true } } } } },
      orderBy: { placement: 'asc' },
    });
  }

  findMappingById(organizationId: string, id: string): Promise<MappingWithDesigns | null> {
    return this.prisma.fulfillmentProductMapping.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  /**
   * Ánh xạ đã tồn tại cho cặp khoá (Product ID + Seller SKU) — chặn khai hai bộ Design cho
   * cùng một sản phẩm.
   *
   * 🔴 Phạm vi là TỔ CHỨC, không phải tài khoản nhà cung cấp. Nếu giới hạn theo tài khoản
   * thì hai nhà cung cấp vẫn khai được cùng một sản phẩm, và sản phẩm đó có hai bộ Design —
   * đúng thứ mà UNIQUE index ở migration `20260826170000` loại bỏ. Kiểm ở đây để người dùng
   * nhận thông báo nghiệp vụ rõ ràng thay vì lỗi ràng buộc thô của Postgres.
   */
  findConflictingMapping(
    organizationId: string,
    keys: { tiktokProductId: string; sellerSku: string },
    excludeId?: string,
  ) {
    return this.prisma.fulfillmentProductMapping.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        tiktokProductId: keys.tiktokProductId,
        sellerSku: keys.sellerSku,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  createMapping(
    data: Prisma.FulfillmentProductMappingUncheckedCreateInput,
  ): Promise<MappingWithDesigns> {
    return this.prisma.fulfillmentProductMapping.create({
      data,
    });
  }

  updateMapping(
    id: string,
    data: Prisma.FulfillmentProductMappingUncheckedUpdateInput,
  ): Promise<MappingWithDesigns> {
    return this.prisma.fulfillmentProductMapping.update({
      where: { id },
      data,
    });
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
  findByPodOrderIds(organizationId: string, podOrderIds: string[]): Promise<FulfillmentOrder[]> {
    if (podOrderIds.length === 0) return Promise.resolve([]);
    return this.prisma.fulfillmentOrder.findMany({
      where: { organizationId, podOrderId: { in: podOrderIds }, deletedAt: null },
    });
  }

  findById(organizationId: string, id: string): Promise<FulfillmentOrderWithRelations | null> {
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

  /**
   * Ghi lại danh sách item đã gửi (thay toàn bộ — mỗi lần gửi là một ảnh chụp mới).
   *
   * 🔴 `printFiles` và `baseCost` là ẢNH CHỤP: chúng ghi lại đơn này đã gửi ĐÚNG file nào và
   * với giá vốn nào. Design nay sống ở Product Mapping và có thể bị thay/xoá bất cứ lúc nào;
   * không có ảnh chụp thì đơn đã gửi mất luôn khả năng đối soát với xưởng in.
   */
  async replaceItems(
    fulfillmentOrderId: string,
    organizationId: string,
    items: Array<{
      podOrderItemId: string;
      providerSku: string;
      quantity: number;
      productionConfig: string | null;
      baseCost: number | null;
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
            // SUBMITTING = đơn đã có mã bên nhà cung cấp nhưng tiến trình chết giữa chừng
            // trước khi kịp ghi trạng thái. Không hỏi lại thì bản ghi kẹt vĩnh viễn.
            FulfillmentStatus.SUBMITTING,
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
