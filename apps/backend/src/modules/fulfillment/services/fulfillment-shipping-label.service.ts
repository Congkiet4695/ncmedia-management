import { Injectable, Logger } from '@nestjs/common';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  PodTiktokShopContextException,
  PodTiktokShopContextService,
} from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokFulfillmentApiService } from '../../tiktok-sdk/tiktok-fulfillment-api.service';
import type { TiktokShippingService } from '../../tiktok-sdk/types/tiktok-fulfillment.types';
import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import { FulfillmentOrderNotFoundException } from '../exceptions/fulfillment.exceptions';

/** Nguồn của nhãn đang gắn với đơn. */
export const SHIPPING_LABEL_SOURCE = { TIKTOK: 'TIKTOK', MANUAL: 'MANUAL' } as const;
export type ShippingLabelSource =
  (typeof SHIPPING_LABEL_SOURCE)[keyof typeof SHIPPING_LABEL_SOURCE];

/** Nhãn vận chuyển đang gắn với một đơn POD. */
export interface ShippingLabelState {
  labelUrl: string;
  source: ShippingLabelSource;
  packageId: string | null;
  trackingNumber: string | null;
  shippingServiceName: string | null;
  obtainedAt: string | null;
  /** Lần lấy vừa rồi DÙNG LẠI gói đã có (không tạo gói mới). Chỉ có ý nghĩa ngay sau khi lấy. */
  reusedPackage?: boolean;
}

/** Thời gian giữ khoá khi lấy nhãn — đủ cho 3 lời gọi TikTok liên tiếp. */
const LABEL_LOCK_MS = 60_000;

/** Đang có một lượt lấy nhãn khác chạy cho đúng đơn này. */
export class ShippingLabelBusyException extends ConflictException {
  constructor() {
    super({
      code: 'SHIPPING_LABEL_BUSY',
      message:
        'Đang có một lượt lấy nhãn khác chạy cho đơn này. Chờ vài giây rồi thử lại — ' +
        'bấm liên tiếp KHÔNG tạo thêm gói hàng.',
    });
  }
}

/** TikTok không cấp được nhãn cho đơn này (kèm nguyên văn lý do của TikTok). */
export class ShippingLabelUnavailableException extends UnprocessableEntityException {
  constructor(message: string, code = 'TIKTOK_SHIPPING_LABEL_UNAVAILABLE') {
    super({ code, message });
  }
}

/**
 * FulfillmentShippingLabelService — **nhãn vận chuyển của đơn POD**.
 *
 * ```
 *   Controller → FulfillmentShippingLabelService → TiktokFulfillmentApiService → SDK → TikTok
 * ```
 *
 * Vì sao tồn tại: TikTok che thông tin người nhận với đơn 4PL và đơn quá hạn hiển thị. Khi
 * KHÔNG còn địa chỉ đọc được, thứ hợp lệ để gửi sản xuất là **nhãn vận chuyển do TikTok cấp**
 * — xưởng in chỉ cần in nhãn đó dán lên hộp, địa chỉ thật nằm trên nhãn.
 *
 * 🔴 **Không bao giờ tạo gói thứ hai.** Thứ tự bắt buộc:
 *
 * ```
 *   đơn đã có package (đồng bộ từ TikTok, hoặc do chính hệ thống tạo)
 *        ├─ có  → CHỈ gọi Get Package Shipping Document cho gói đó (đọc thuần, lặp vô hại)
 *        └─ không → Get Eligible Shipping Service → chọn dịch vụ TikTok trả về → Create Packages
 *                   → Get Package Shipping Document
 * ```
 *
 * Bấm nhiều lần chỉ lặp lại nhánh trên. Cộng thêm khoá phân tán theo đơn ⇒ hai người bấm cùng
 * lúc cũng không sinh ra hai gói.
 *
 * 🔴 **Không viết cứng dịch vụ vận chuyển / nhà vận chuyển.** Dịch vụ lấy từ chính phản hồi
 * của TikTok: ưu tiên cái TikTok đánh dấu `isDefault`, không có thì lấy phần tử đầu tiên.
 */
@Injectable()
export class FulfillmentShippingLabelService {
  private readonly logger = new Logger(FulfillmentShippingLabelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly podOrderRepo: PodOrderRepository,
    private readonly shopContext: PodTiktokShopContextService,
    private readonly tiktok: TiktokFulfillmentApiService,
    private readonly lock: DistributedLockService,
  ) {}

  /** Nhãn đang lưu của một đơn — `null` khi chưa có. */
  static labelOf(order: {
    shippingLabelUrl: string | null;
    shippingLabelSource: string | null;
    shippingLabelPackageId: string | null;
    shippingLabelTrackingNumber: string | null;
    shippingLabelAt: Date | null;
  }): ShippingLabelState | null {
    const url = order.shippingLabelUrl?.trim();
    if (!url) return null;
    return {
      labelUrl: url,
      source:
        order.shippingLabelSource === SHIPPING_LABEL_SOURCE.TIKTOK
          ? SHIPPING_LABEL_SOURCE.TIKTOK
          : SHIPPING_LABEL_SOURCE.MANUAL,
      packageId: order.shippingLabelPackageId,
      trackingNumber: order.shippingLabelTrackingNumber,
      shippingServiceName: null,
      obtainedAt: order.shippingLabelAt?.toISOString() ?? null,
    };
  }

  /** Nhãn đang lưu (đọc từ database — KHÔNG phải state của giao diện). */
  async current(organizationId: string, podOrderId: string): Promise<ShippingLabelState | null> {
    const order = await this.requireOrder(organizationId, podOrderId);
    const label = FulfillmentShippingLabelService.labelOf(order);
    if (!label) return null;
    const pkg = order.packages.find(
      (entry) => entry.tiktokPackageId === order.shippingLabelPackageId,
    );
    return { ...label, shippingServiceName: pkg?.shippingServiceName ?? null };
  }

  /**
   * Lấy nhãn từ TikTok — dùng lại gói đã có, chỉ tạo gói khi đơn chưa có gói nào.
   */
  async fetchFromTiktok(
    organizationId: string,
    userId: string,
    podOrderId: string,
  ): Promise<ShippingLabelState> {
    const result = await this.lock.withLock(
      `fulfillment:label:${podOrderId}`,
      LABEL_LOCK_MS,
      () => this.fetchLocked(organizationId, userId, podOrderId),
    );
    if (!result) throw new ShippingLabelBusyException();
    return result;
  }

  /** Người vận hành tự dán URL nhãn — lưu XUỐNG DATABASE, không chỉ giữ ở giao diện. */
  async saveManualLabel(
    organizationId: string,
    userId: string,
    podOrderId: string,
    labelUrl: string,
  ): Promise<ShippingLabelState> {
    const order = await this.requireOrder(organizationId, podOrderId);
    const url = labelUrl.trim();

    await this.prisma.podOrder.update({
      where: { id: order.id },
      data: {
        shippingLabelUrl: url,
        shippingLabelSource: SHIPPING_LABEL_SOURCE.MANUAL,
        // Nhãn dán tay không đi kèm gói nào của TikTok — không giữ lại package/tracking cũ để
        // khỏi gán nhầm mã vận đơn của một nhãn khác cho nhãn này. Bản ghi gói vẫn nằm
        // nguyên ở `pod_order_packages`, không mất dữ liệu.
        shippingLabelPackageId: null,
        shippingLabelTrackingNumber: null,
        shippingLabelAt: new Date(),
      },
    });

    this.logger.log({
      module: 'fulfillment',
      operation: 'label.manual.save',
      organizationId,
      podOrderId,
      tiktokOrderId: order.tiktokOrderId,
      userId,
      // KHÔNG log URL: nhãn chứa thông tin người nhận.
      msg: 'Đã lưu nhãn vận chuyển do người vận hành cung cấp',
    });

    return {
      labelUrl: url,
      source: SHIPPING_LABEL_SOURCE.MANUAL,
      packageId: null,
      trackingNumber: null,
      shippingServiceName: null,
      obtainedAt: new Date().toISOString(),
    };
  }

  /** Gỡ nhãn khỏi đơn (người vận hành dán nhầm). */
  async clearLabel(organizationId: string, podOrderId: string): Promise<void> {
    const order = await this.requireOrder(organizationId, podOrderId);
    await this.prisma.podOrder.update({
      where: { id: order.id },
      data: {
        shippingLabelUrl: null,
        shippingLabelSource: null,
        shippingLabelPackageId: null,
        shippingLabelTrackingNumber: null,
        shippingLabelAt: null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async fetchLocked(
    organizationId: string,
    userId: string,
    podOrderId: string,
  ): Promise<ShippingLabelState> {
    const order = await this.requireOrder(organizationId, podOrderId);
    const ctx = await this.resolveShopContext(organizationId, order);

    // ---- 1. Đơn đã có gói? Dùng lại, TUYỆT ĐỐI không tạo gói thứ hai ----
    const existingPackageId =
      order.shippingLabelPackageId ?? order.packages[0]?.tiktokPackageId ?? null;

    if (existingPackageId) {
      const document = await this.getDocument(ctx, existingPackageId);
      return this.persist(organizationId, userId, order, {
        packageId: existingPackageId,
        labelUrl: document.docUrl as string,
        trackingNumber: document.trackingNumber ?? null,
        shippingService: null,
        reusedPackage: true,
      });
    }

    // ---- 2. Chưa có gói: hỏi TikTok những dịch vụ vận chuyển khả dụng ----
    const services = await this.run(() =>
      this.tiktok.queryShippingServices(ctx, order.tiktokOrderId),
    );
    const service = this.pickService(services.data.shippingServices ?? []);
    if (!service?.id) {
      throw new ShippingLabelUnavailableException(
        'TikTok không trả về dịch vụ vận chuyển nào cho đơn này — đơn có thể không thuộc ' +
          'diện TikTok Shipping, hoặc đã được đóng gói/vận chuyển bằng cách khác. ' +
          'Kiểm tra đơn trên Seller Center, hoặc dán URL nhãn vào ô "Nhãn vận chuyển".',
        'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE',
      );
    }

    // ---- 3. Tạo gói (KHÔNG retry ở tầng SDK — xem TiktokFulfillmentApiService) ----
    const created = await this.run(() =>
      this.tiktok.createPackage(ctx, {
        orderId: order.tiktokOrderId,
        shippingServiceId: service.id,
      }),
    );
    const packageId = created.data.packageId;
    if (!packageId) {
      throw new ShippingLabelUnavailableException(
        'TikTok nhận lệnh tạo gói nhưng không trả về `package_id`. Kiểm tra đơn trên Seller ' +
          'Center trước khi thử lại để tránh tạo gói trùng.',
      );
    }

    // ---- 4. Lấy nhãn của gói vừa tạo ----
    const document = await this.getDocument(ctx, packageId);
    return this.persist(organizationId, userId, order, {
      packageId,
      labelUrl: document.docUrl as string,
      trackingNumber: document.trackingNumber ?? null,
      shippingService: {
        id: created.data.shippingServiceInfo?.id ?? service.id ?? null,
        name: created.data.shippingServiceInfo?.name ?? service.name ?? null,
      },
      reusedPackage: false,
    });
  }

  /**
   * Chọn dịch vụ vận chuyển: ưu tiên cái TikTok đánh dấu mặc định.
   *
   * 🔴 Không so giá, không đoán theo tên nhà vận chuyển: TikTok đã biết shop đăng ký gói cước
   * nào và đánh dấu `is_default` theo đó. Tự chọn "rẻ nhất" là âm thầm đổi dịch vụ vận chuyển
   * của người bán.
   */
  private pickService(services: TiktokShippingService[]): TiktokShippingService | null {
    if (services.length === 0) return null;
    return services.find((entry) => entry.isDefault && entry.id) ?? services[0] ?? null;
  }

  private async getDocument(
    ctx: Awaited<ReturnType<PodTiktokShopContextService['resolve']>>,
    packageId: string,
  ): Promise<{ docUrl?: string; trackingNumber?: string }> {
    const document = await this.run(() => this.tiktok.getShippingDocument(ctx, packageId));
    if (!document.data.docUrl) {
      throw new ShippingLabelUnavailableException(
        'TikTok chưa cấp được file nhãn cho gói này. Thường là gói vừa tạo và TikTok còn đang ' +
          'xử lý — chờ một lát rồi bấm lại (bấm lại KHÔNG tạo gói mới).',
        'TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE',
      );
    }
    return document.data;
  }

  /** Ghi nhãn xuống database: bản ghi gói + nhãn hiệu lực của đơn. */
  private async persist(
    organizationId: string,
    userId: string,
    order: PodOrderWithRelations,
    input: {
      packageId: string;
      labelUrl: string;
      trackingNumber: string | null;
      shippingService: { id: string | null; name: string | null } | null;
      reusedPackage: boolean;
    },
  ): Promise<ShippingLabelState> {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.podOrderPackage.upsert({
        where: {
          orderId_tiktokPackageId: { orderId: order.id, tiktokPackageId: input.packageId },
        },
        create: {
          organizationId,
          orderId: order.id,
          tiktokPackageId: input.packageId,
          shippingServiceId: input.shippingService?.id ?? null,
          shippingServiceName: input.shippingService?.name ?? null,
          trackingNumber: input.trackingNumber,
          shippingDocumentUrl: input.labelUrl,
          documentFetchedAt: now,
        },
        update: {
          // Dịch vụ chỉ ghi khi lần này biết — gói đồng bộ từ TikTok không kèm thông tin đó.
          ...(input.shippingService?.id ? { shippingServiceId: input.shippingService.id } : {}),
          ...(input.shippingService?.name
            ? { shippingServiceName: input.shippingService.name }
            : {}),
          ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
          shippingDocumentUrl: input.labelUrl,
          documentFetchedAt: now,
        },
      });

      await tx.podOrder.update({
        where: { id: order.id },
        data: {
          shippingLabelUrl: input.labelUrl,
          shippingLabelSource: SHIPPING_LABEL_SOURCE.TIKTOK,
          shippingLabelPackageId: input.packageId,
          shippingLabelTrackingNumber: input.trackingNumber,
          shippingLabelAt: now,
        },
      });
    });

    this.logger.log({
      module: 'fulfillment',
      operation: 'label.tiktok.fetch',
      organizationId,
      podOrderId: order.id,
      tiktokOrderId: order.tiktokOrderId,
      packageId: input.packageId,
      reusedPackage: input.reusedPackage,
      hasTrackingNumber: Boolean(input.trackingNumber),
      userId,
      // KHÔNG log `doc_url`: URL đã ký của TikTok mở ra là thấy thông tin người nhận.
      msg: input.reusedPackage
        ? 'Đã lấy lại nhãn của gói đã có trên TikTok'
        : 'Đã tạo gói và lấy nhãn từ TikTok',
    });

    return {
      labelUrl: input.labelUrl,
      source: SHIPPING_LABEL_SOURCE.TIKTOK,
      packageId: input.packageId,
      trackingNumber: input.trackingNumber,
      shippingServiceName: input.shippingService?.name ?? null,
      obtainedAt: now.toISOString(),
      reusedPackage: input.reusedPackage,
    };
  }

  private async requireOrder(
    organizationId: string,
    podOrderId: string,
  ): Promise<PodOrderWithRelations> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    return order;
  }

  private async resolveShopContext(
    organizationId: string,
    order: PodOrderWithRelations,
  ): Promise<Awaited<ReturnType<PodTiktokShopContextService['resolve']>>> {
    try {
      return await this.shopContext.resolve(organizationId, order.shopId);
    } catch (error) {
      if (error instanceof PodTiktokShopContextException) {
        throw new ShippingLabelUnavailableException(
          `Không gọi được API TikTok cho shop của đơn này: ${error.message}`,
          'TIKTOK_SHOP_CONTEXT_UNAVAILABLE',
        );
      }
      throw error;
    }
  }

  /**
   * Gọi TikTok và dịch lỗi sang thông điệp người vận hành HIỂU ĐƯỢC.
   *
   * 🔴 Không gộp mọi lỗi thành một câu chung: "thiếu scope" và "đơn không đủ điều kiện" là hai
   * việc phải làm khác hẳn nhau. Chi tiết kỹ thuật (mã lỗi, request id) ghi vào log máy chủ.
   */
  private async run<T>(call: () => Promise<{ data: T; requestId?: string }>): Promise<{
    data: T;
    requestId?: string;
  }> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof TiktokClientError)) throw error;

      this.logger.error({
        module: 'fulfillment',
        operation: 'label.tiktok.error',
        endpoint: error.endpoint,
        tiktokCode: error.tiktokCode,
        tiktokRequestId: error.requestId,
        errorClass: error.errorClass,
        msg: error.tiktokMessage,
      });

      if (error.errorClass === TiktokErrorClass.AUTH) {
        throw new ShippingLabelUnavailableException(
          'Kết nối TikTok của shop này chưa có quyền Fulfillment/Logistics (hoặc uỷ quyền đã ' +
            'hết hạn). Kết nối lại TikTok Shop với đủ quyền rồi thử lại.',
          'TIKTOK_SCOPE_MISSING',
        );
      }
      if (error.errorClass === TiktokErrorClass.RATE_LIMIT) {
        throw new ShippingLabelUnavailableException(
          'TikTok đang giới hạn tần suất gọi API. Chờ một lát rồi bấm lại.',
          'TIKTOK_RATE_LIMITED',
        );
      }
      // Lỗi nghiệp vụ/mạng: giữ NGUYÊN VĂN thông điệp của TikTok — đó là thứ nói đúng nhất
      // vì sao đơn này không lấy được nhãn.
      throw new ShippingLabelUnavailableException(
        `TikTok từ chối yêu cầu lấy nhãn (mã ${error.tiktokCode}): ${error.tiktokMessage}`,
      );
    }
  }
}
