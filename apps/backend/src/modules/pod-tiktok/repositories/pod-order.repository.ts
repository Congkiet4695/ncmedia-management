import { Injectable } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { accountScopeFilter, shopScopeFilter } from '../shared/shop-scope';
import { POD_ORDER_INCLUDE, PodOrderWithRelations } from '../types/pod-order-with-relations.type';

/** Ảnh chụp tối thiểu của đơn đã có trong DB — dùng để so sánh, KHÔNG tải nguyên bản ghi. */
export interface ExistingOrderSnapshot {
  id: string;
  tiktokOrderId: string;
  tiktokUpdateTime: bigint;
  payloadHash: string;
  recipientMasked: boolean;
  syncVersion: number;
}

/**
 * Bộ lọc đơn — phần dùng CHUNG giữa danh sách và thống kê.
 *
 * 🔴 Tách riêng khỏi phân trang/sắp xếp có chủ đích: thống kê cần đúng bộ lọc này và KHÔNG
 * cần `page`/`sortBy`. Tách ra khiến việc "thẻ thống kê phải lọc giống danh sách" trở thành
 * điều kiểu dữ liệu tự bảo đảm, thay vì một quy ước dễ quên.
 */
export interface PodOrderFilterParams {
  search?: string;
  status?: string;
  shopId?: string;
  accountId?: string;
  /**
   * 🔴 Phạm vi shop của người dùng. `undefined` = không giới hạn (`pod.shop.all`);
   * mảng RỖNG = chưa được gán shop nào ⇒ không thấy đơn nào.
   *
   * Đặt trong `PodOrderFilterParams` (chứ không ở `FindManyParams`) là có chủ đích: danh
   * sách VÀ thẻ thống kê dùng chung kiểu này, nên không thể lọc một bên mà quên bên kia.
   */
  shopScope?: string[];
  accountScope?: string[];
  orderType?: string;
  hasPodItem?: boolean;
  /**
   * `true` = MỌI sản phẩm trong đơn đều đã có design; `false` = còn ít nhất một sản phẩm thiếu.
   * Xem `buildDesignCondition` để biết vì sao không thể là một cột trên đơn.
   */
  hasDesign?: boolean;
  /** `false` = chưa đẩy sang xưởng in; `true` = đã đẩy. Xem `buildFulfillmentCondition`. */
  pushedToFulfillment?: boolean;
  /** ID **Employee** phụ trách (qua `pod_tiktok_accounts.seller_id`). */
  sellerId?: string;
  orderedFrom?: Date;
  orderedTo?: Date;
}

/**
 * Cặp khoá (Product ID → các Seller SKU) ĐÃ có design, của một tổ chức.
 *
 * 🔴 Gom theo Product ID chứ không để phẳng thành danh sách cặp: một sản phẩm thường có hàng
 * chục SKU, và `OR` phẳng sẽ sinh ra một mệnh đề SQL dài bằng số cặp. Gom lại thì số nhánh
 * `OR` chỉ còn bằng số SẢN PHẨM, mỗi nhánh một `IN` — cùng kết quả, SQL nhỏ hơn hẳn.
 */
export type DesignKeyIndex = Map<string, string[]>;

/**
 * Trạng thái fulfillment vẫn còn gửi lại được ⇒ đơn tính là **CHƯA đẩy**.
 *
 * 🔴 Giữ ĐÚNG danh sách của `MangoFulfillmentService.RESUBMITTABLE_STATUSES`. Hai nơi trả lời
 * khác nhau nghĩa là bộ lọc hiện một đơn dưới nhãn "chưa đẩy Fulfill" rồi người dùng bấm
 * Fulfill và nhận `FULFILLMENT_ALREADY_SUBMITTED`.
 *
 * ⚠️ `CANCELLED` KHÔNG nằm ở đây — theo luật hiện hành, đơn đã huỷ ở xưởng in không gửi lại
 * được, nên nó tính là ĐÃ đẩy. Xem phần ghi chú của báo cáo.
 */
export const FULFILLMENT_NOT_PUSHED_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
];

export interface PodOrderFindManyParams extends PodOrderFilterParams {
  page: number;
  limit: number;
  sortBy: 'orderedAt' | 'tiktokUpdatedAt' | 'totalAmount' | 'status' | 'lastSyncedAt';
  sortOrder: 'asc' | 'desc';
}

/**
 * PodOrderRepository — data access cho aggregate đơn TikTok.
 *
 * Tenant isolation (ADR-004): mọi method nghiệp vụ nhận `organizationId`.
 * Tối ưu hiệu năng: đọc snapshot theo LÔ (tránh N+1), ghi theo transaction.
 */
@Injectable()
export class PodOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Đọc snapshot của nhiều đơn trong MỘT query (chống N+1).
   * Trả Map để service tra cứu O(1) khi so sánh.
   */
  async findSnapshotsByTiktokOrderIds(
    organizationId: string,
    tiktokOrderIds: string[],
  ): Promise<Map<string, ExistingOrderSnapshot>> {
    if (tiktokOrderIds.length === 0) return new Map();
    const rows = await this.prisma.podOrder.findMany({
      where: { organizationId, tiktokOrderId: { in: tiktokOrderIds } },
      select: {
        id: true,
        tiktokOrderId: true,
        tiktokUpdateTime: true,
        payloadHash: true,
        recipientMasked: true,
        syncVersion: true,
      },
    });
    return new Map(rows.map((row) => [row.tiktokOrderId, row]));
  }

  /** Hash hiện tại của toàn bộ item thuộc các đơn (chống N+1 khi so sánh item). */
  async findItemHashesByOrderIds(orderIds: string[]): Promise<Map<string, Map<string, string>>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.podOrderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, tiktokLineItemId: true, payloadHash: true },
    });
    const result = new Map<string, Map<string, string>>();
    for (const row of rows) {
      let inner = result.get(row.orderId);
      if (!inner) {
        inner = new Map<string, string>();
        result.set(row.orderId, inner);
      }
      inner.set(row.tiktokLineItemId, row.payloadHash);
    }
    return result;
  }

  createOrder(
    tx: Prisma.TransactionClient,
    data: Prisma.PodOrderUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return tx.podOrder.create({ data, select: { id: true } });
  }

  async updateOrder(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.PodOrderUncheckedUpdateInput,
  ): Promise<void> {
    await tx.podOrder.update({ where: { id }, data });
  }

  /** Chỉ chạm `last_synced_at` khi đơn KHÔNG đổi — không tăng `updated_at` nghiệp vụ. */
  async touchLastSynced(tiktokOrderIds: string[], organizationId: string, at: Date): Promise<void> {
    if (tiktokOrderIds.length === 0) return;
    await this.prisma.podOrder.updateMany({
      where: { organizationId, tiktokOrderId: { in: tiktokOrderIds } },
      data: { lastSyncedAt: at },
    });
  }

  async upsertItem(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderId: string,
    data: Omit<Prisma.PodOrderItemUncheckedCreateInput, 'orderId' | 'organizationId'>,
  ): Promise<void> {
    await tx.podOrderItem.upsert({
      where: {
        orderId_tiktokLineItemId: { orderId, tiktokLineItemId: data.tiktokLineItemId },
      },
      create: { ...data, orderId, organizationId },
      update: { ...data, organizationId },
    });
  }

  /**
   * Đồng bộ packages của một đơn.
   * KHÔNG xoá package cũ nếu TikTok không còn trả về — chỉ thêm/giữ (nguyên tắc
   * "không xoá dữ liệu khi TikTok không yêu cầu").
   */
  async upsertPackages(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderId: string,
    tiktokPackageIds: string[],
  ): Promise<void> {
    if (tiktokPackageIds.length === 0) return;
    await tx.podOrderPackage.createMany({
      data: tiktokPackageIds.map((tiktokPackageId) => ({
        organizationId,
        orderId,
        tiktokPackageId,
      })),
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------
  // Truy vấn phục vụ API
  // -------------------------------------------------------------------------

  findById(organizationId: string, id: string): Promise<PodOrderWithRelations | null> {
    return this.prisma.podOrder.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: POD_ORDER_INCLUDE,
    });
  }

  /**
   * Điều kiện lọc đơn — dùng CHUNG cho danh sách và cho thống kê.
   *
   * 🔴 Một hàm, một nơi. Trước đây danh sách có bộ lọc còn `countByStatus` thì không, nên các
   * thẻ thống kê luôn hiện số liệu TOÀN HỆ THỐNG trong khi bảng bên dưới đã lọc — hai con số
   * mâu thuẫn nhau trên cùng một màn hình. Tách thành hai bản sao là mời lỗi đó quay lại ngay
   * lần thêm bộ lọc tiếp theo.
   */
  /**
   * Cặp khoá sản phẩm ĐÃ có design của tổ chức, gom theo Product ID.
   *
   * 🔴 Vì sao phải nạp ra bộ nhớ thay vì lọc thẳng trong một câu SQL: design KHÔNG có khoá
   * ngoại tới order item. Chúng nối với nhau bằng GIÁ TRỊ của cặp (Product ID + Seller SKU)
   * — xem `mapping-match.ts`, luật dùng chung của cả `FulfillmentReadinessService` lẫn
   * `PodOrderDesignResolver`. Prisma không diễn đạt được phép nối theo giá trị giữa hai bảng
   * trong `where`.
   *
   * Không phát sinh chi phí đọc mới: mọi lần mở danh sách đơn, `PodOrderDesignResolver` vốn
   * đã nạp toàn bộ design của tổ chức để hiển thị. Ở đây chỉ nạp phần KHOÁ (hai cột), và chỉ
   * khi bộ lọc design thực sự được dùng.
   */
  async loadDesignKeys(organizationId: string): Promise<DesignKeyIndex> {
    const rows = await this.prisma.fulfillmentProductDesign.findMany({
      where: {
        organizationId,
        deletedAt: null,
        tiktokProductId: { not: null },
        sellerSku: { not: null },
      },
      distinct: ['tiktokProductId', 'sellerSku'],
      select: { tiktokProductId: true, sellerSku: true },
    });

    const index: DesignKeyIndex = new Map();
    for (const row of rows) {
      // `trim` để khớp đúng `mappingKeyOf` — dữ liệu nhập tay hay dính khoảng trắng.
      // KHÔNG đổi hoa/thường: Seller SKU của TikTok phân biệt hoa thường.
      const product = row.tiktokProductId?.trim();
      const sku = row.sellerSku?.trim();
      if (!product || !sku) continue;
      const list = index.get(product) ?? [];
      list.push(sku);
      index.set(product, list);
    }
    return index;
  }

  /**
   * Điều kiện "line item này ĐÃ có design".
   *
   * `null` = tổ chức chưa có design nào ⇒ không line item nào khớp được.
   */
  private buildItemHasDesign(keys: DesignKeyIndex): Prisma.PodOrderItemWhereInput | null {
    if (keys.size === 0) return null;
    return {
      OR: [...keys.entries()].map(([productId, skus]) => ({
        productId,
        sellerSku: { in: skus },
      })),
    };
  }

  /**
   * Điều kiện lọc theo DESIGN ở cấp ĐƠN.
   *
   * 🔴 Quy tắc lấy từ `FulfillmentReadinessService`: đơn chỉ "đủ design" khi **mọi** sản phẩm
   * trong đơn đều có file in — chỉ cần một dòng thiếu là `DESIGN_MISSING` và đơn không gửi
   * được. Vì vậy:
   *
   *   đã có design  = KHÔNG tồn tại item nào thiếu design  (và đơn phải có ít nhất một item)
   *   chưa có design = TỒN TẠI ít nhất một item thiếu design
   *
   * Hai vế là phủ định của nhau đúng như yêu cầu, chứ không phải "có ít nhất một item có
   * design" — cách hiểu đó sẽ xếp một đơn 3 sản phẩm mới upload được 1 file vào nhóm "đã có
   * design", rồi người vận hành bấm Fulfill và bị từ chối.
   *
   * 🔴 Đơn KHÔNG có sản phẩm nào bị loại khỏi "đã có design": `none` đúng về mặt logic với
   * tập rỗng, nhưng một đơn trống hiện dưới nhãn "đã có design" là nói dối người đọc.
   */
  private buildDesignCondition(
    hasDesign: boolean,
    keys: DesignKeyIndex,
  ): Prisma.PodOrderWhereInput {
    const itemHasDesign = this.buildItemHasDesign(keys);

    // Chưa có design nào trong tổ chức ⇒ mọi item đều thiếu.
    if (!itemHasDesign) {
      return hasDesign ? { id: { in: [] } } : { items: { some: {} } };
    }

    return hasDesign
      ? { items: { some: {}, none: { NOT: itemHasDesign } } }
      : { items: { some: { NOT: itemHasDesign } } };
  }

  /**
   * Điều kiện lọc theo việc ĐÃ ĐẨY sang xưởng in.
   *
   * Fulfillment được theo dõi ở cấp ĐƠN (`fulfillment_orders.pod_order_id`), không phải cấp
   * line item — nên không có chuyện "một phần đơn đã đẩy" để phải phân xử.
   *
   * `deletedAt: null` không được quên: bản ghi đã xoá mềm không còn chặn việc gửi lại, nên
   * tính nó là "đã đẩy" sẽ giấu mất những đơn thực ra đang chờ xử lý.
   */
  private buildFulfillmentCondition(pushed: boolean): Prisma.PodOrderWhereInput {
    const pushedRecord: Prisma.FulfillmentOrderWhereInput = {
      deletedAt: null,
      status: { notIn: [...FULFILLMENT_NOT_PUSHED_STATUSES] },
    };
    return pushed
      ? { fulfillmentOrders: { some: pushedRecord } }
      : { fulfillmentOrders: { none: pushedRecord } };
  }

  private buildWhere(
    organizationId: string,
    params: PodOrderFilterParams,
    /** Khoá design của tổ chức — chỉ cần khi `params.hasDesign` được dùng. */
    designKeys: DesignKeyIndex = new Map(),
  ): Prisma.PodOrderWhereInput {
    // 🔴 GIAO phạm vi được gán với bộ lọc người dùng chọn — không bao giờ gán đè. Gán đè là
    // bug bảo mật: chỉ cần gửi `?shopId=<shop người khác>` là đọc được đơn của shop đó.
    const shopFilter = shopScopeFilter(params.shopScope, params.shopId);
    const accountFilter = accountScopeFilter(params.accountScope, params.accountId);

    return {
      organizationId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(shopFilter === undefined ? {} : { shopId: shopFilter }),
      ...(accountFilter === undefined ? {} : { accountId: accountFilter }),
      ...(params.orderType ? { orderType: params.orderType } : {}),
      ...(params.hasPodItem !== undefined ? { hasPodItem: params.hasPodItem } : {}),
      // 🔴 Nhân viên phụ trách nằm ở KẾT NỐI, không phải ở đơn: `pod_tiktok_accounts.seller_id`
      // là nguồn duy nhất xác định seller của mọi dữ liệu POD (xem chú thích của cột đó).
      // Lọc qua quan hệ nên đổi người phụ trách là bộ lọc đổi theo ngay, không có bản sao cũ.
      ...(params.sellerId ? { account: { sellerId: params.sellerId } } : {}),
      ...(params.hasDesign !== undefined
        ? this.buildDesignCondition(params.hasDesign, designKeys)
        : {}),
      ...(params.pushedToFulfillment !== undefined
        ? this.buildFulfillmentCondition(params.pushedToFulfillment)
        : {}),
      ...(params.orderedFrom || params.orderedTo
        ? {
            orderedAt: {
              ...(params.orderedFrom ? { gte: params.orderedFrom } : {}),
              ...(params.orderedTo ? { lte: params.orderedTo } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { tiktokOrderId: { contains: params.search, mode: 'insensitive' } },
              { trackingNumber: { contains: params.search, mode: 'insensitive' } },
              { buyerEmail: { contains: params.search, mode: 'insensitive' } },
              { buyerNickname: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    organizationId: string,
    params: PodOrderFindManyParams,
  ): Promise<{ items: PodOrderWithRelations[]; total: number }> {
    const where = this.buildWhere(
      organizationId,
      params,
      params.hasDesign === undefined ? undefined : await this.loadDesignKeys(organizationId),
    );

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podOrder.findMany({
        where,
        include: POD_ORDER_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podOrder.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Thống kê cho các thẻ ở đầu màn hình danh sách (một query GROUP BY, không N+1).
   *
   * 🔴 Nhận CÙNG bộ lọc với `findMany` và dựng WHERE bằng CÙNG một hàm. Thẻ "Completed" phải
   * đếm đúng những đơn mà bảng bên dưới đang hiển thị — nếu không, người dùng nhìn thấy
   * "1.240 đơn hoàn thành" ngay phía trên một bảng có 3 dòng.
   */
  async countByStatus(organizationId: string, params: PodOrderFilterParams = {}) {
    // Thẻ thống kê phải đếm ĐÚNG tập mà bảng đang hiển thị ⇒ cũng cần khoá design.
    const designKeys =
      params.hasDesign === undefined ? undefined : await this.loadDesignKeys(organizationId);

    return this.prisma.podOrder.groupBy({
      by: ['status'],
      where: this.buildWhere(organizationId, params, designKeys),
      _count: { _all: true },
    });
  }
}
