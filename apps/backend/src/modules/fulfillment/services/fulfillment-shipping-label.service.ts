import { randomUUID } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
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
  /**
   * `false` ⇒ TikTok không cấp lại được file cho gói đã có (vd gói đã được lấy hàng), hệ thống trả
   * về nhãn ĐÃ LƯU của chính gói đó. `warning` nói lý do. Chỉ có ý nghĩa ngay sau khi lấy.
   */
  refreshed?: boolean;
  warning?: string | null;
}

/** Tuỳ chọn của một lượt lấy nhãn. */
export interface FetchTiktokLabelInput {
  /**
   * Dịch vụ vận chuyển người vận hành chọn — CHỈ dùng khi phải tạo gói và TikTok trả nhiều dịch vụ
   * mà không đánh dấu mặc định. Phải nằm trong danh sách TikTok trả về cho đơn này.
   */
  shippingServiceId?: string;
}

/**
 * Thời gian giữ khoá khi lấy nhãn. Một lượt gồm tối đa vài lời gọi TikTok (chi tiết đơn · dịch vụ ·
 * tạo gói · tài liệu, cộng đối soát sau timeout), mỗi lời gọi có giới hạn thời gian và số lần thử
 * lại — khoá phải sống LÂU HƠN cả lượt, nếu không một cú bấm thứ hai sẽ lọt vào giữa chừng.
 */
const LABEL_LOCK_MS = 5 * 60_000;

/**
 * Gói vừa tạo thường CHƯA có tài liệu ngay (TikTok còn xử lý). Hỏi lại vài lần, cách nhau ngắn,
 * trước khi báo "chưa có nhãn" — người dùng không phải bấm lại chỉ vì TikTok chậm vài giây.
 */
const DOCUMENT_READY_ATTEMPTS = 3;
const DOCUMENT_READY_DELAY_MS = 2_000;

/**
 * Tạo gói hỏng ở đường truyền (timeout / 5xx) ⇒ gói CÓ THỂ đã được tạo. Hỏi lại chi tiết đơn (đọc
 * thuần) vài lần để đối soát, TUYỆT ĐỐI không gửi lại lệnh tạo gói.
 */
const CREATE_RECONCILE_ATTEMPTS = 2;
const CREATE_RECONCILE_DELAY_MS = 3_000;

/** Kiểu vận chuyển TikTok Shipping (`shipping_type` của đơn) — chỉ kiểu này có nhãn do TikTok cấp. */
const TIKTOK_SHIPPING_TYPE = 'TIKTOK';

/**
 * Trạng thái đơn TikTok KHÔNG thể tạo gói (chưa thanh toán / đang giữ / đã huỷ). Chỉ dùng để chặn
 * TRƯỚC lệnh ghi; trạng thái khác (hoặc không rõ) để TikTok tự trả lời.
 */
const NOT_PACKABLE_ORDER_STATUSES = new Set(['UNPAID', 'ON_HOLD', 'CANCELLED']);

/** Mã lỗi của luồng lấy nhãn — frontend dịch theo mã (vi/en), thông điệp tiếng Việt là dự phòng. */
export const SHIPPING_LABEL_ERROR_CODES = {
  BUSY: 'SHIPPING_LABEL_BUSY',
  INTERNAL: 'SHIPPING_LABEL_INTERNAL_ERROR',
  AUTH: 'TIKTOK_SCOPE_MISSING',
  SHOP_CONTEXT: 'TIKTOK_SHOP_CONTEXT_UNAVAILABLE',
  RATE_LIMITED: 'TIKTOK_RATE_LIMITED',
  UNREACHABLE: 'TIKTOK_UNREACHABLE',
  ORDER_NOT_FOUND: 'TIKTOK_ORDER_NOT_FOUND',
  ORDER_NOT_PACKABLE: 'TIKTOK_ORDER_NOT_PACKABLE',
  NOT_TIKTOK_SHIPPING: 'TIKTOK_LABEL_NOT_TIKTOK_SHIPPING',
  NO_SHIPPING_SERVICE: 'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE',
  SERVICE_SELECTION_REQUIRED: 'TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED',
  SERVICE_INVALID: 'TIKTOK_SHIPPING_SERVICE_INVALID',
  PACKAGE_CREATE_FAILED: 'TIKTOK_PACKAGE_CREATE_FAILED',
  DOCUMENT_UNAVAILABLE: 'TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE',
  REJECTED: 'TIKTOK_SHIPPING_LABEL_UNAVAILABLE',
} as const;

/** Dịch vụ vận chuyển gửi kèm lỗi "phải chọn dịch vụ" — chỉ id, tên, nhà vận chuyển. */
export interface ShippingServiceChoice {
  id: string;
  name: string | null;
  shippingProviderName: string | null;
}

/** Chi tiết lỗi an toàn kèm theo mọi lỗi lấy nhãn — KHÔNG chứa token, chữ ký hay địa chỉ. */
export interface ShippingLabelErrorDetails {
  provider: 'TIKTOK';
  operation:
    | 'ORDER_DETAIL'
    | 'SHIPPING_SERVICES'
    | 'CREATE_PACKAGE'
    | 'SHIPPING_DOCUMENT'
    | 'SHOP_CONTEXT'
    | 'INTERNAL';
  providerCode: string | null;
  requestId: string | null;
  /** Thông điệp NGUYÊN VĂN của TikTok (không chứa token/PII) — để giao diện hiển thị lý do thật. */
  providerMessage?: string | null;
  /** Lỗi hệ thống: mã tham chiếu để đối chiếu với log máy chủ (nguyên nhân KHÔNG trả ra ngoài). */
  referenceId?: string | null;
  /** `TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED` / `…_INVALID`: các dịch vụ TikTok cho phép. */
  shippingServices?: ShippingServiceChoice[];
}

/** Đang có một lượt lấy nhãn khác chạy cho đúng đơn này. */
export class ShippingLabelBusyException extends ConflictException {
  constructor() {
    super({
      code: SHIPPING_LABEL_ERROR_CODES.BUSY,
      message:
        'Đang có một lượt lấy nhãn khác chạy cho đơn này. Chờ vài giây rồi thử lại — ' +
        'bấm liên tiếp KHÔNG tạo thêm gói hàng.',
    });
  }
}

/** TikTok không cấp được nhãn cho đơn này (kèm nguyên văn lý do của TikTok). */
export class ShippingLabelUnavailableException extends UnprocessableEntityException {
  constructor(
    message: string,
    code: string = SHIPPING_LABEL_ERROR_CODES.REJECTED,
    details: ShippingLabelErrorDetails | null = null,
  ) {
    super({ code, message, ...(details ? { details } : {}) });
  }

  /** Mã lỗi (`code` trong envelope). */
  get code(): string {
    return (this.getResponse() as { code: string }).code;
  }
}

type ShopContext = Awaited<ReturnType<PodTiktokShopContextService['resolve']>>;

/**
 * FulfillmentShippingLabelService — **nhãn vận chuyển TikTok của đơn POD**.
 *
 * ```
 *   Controller → FulfillmentShippingLabelService → TiktokFulfillmentApiService → SDK → TikTok
 * ```
 *
 * Vì sao tồn tại: TikTok che thông tin người nhận với đơn 4PL và đơn quá hạn hiển thị; và với
 * phương thức "By TikTok" xưởng in giao hàng bằng CHÍNH nhãn TikTok cấp. Nhãn này là của TikTok,
 * KHÔNG phụ thuộc nhà cung cấp fulfillment (Mango/Sellerwix) hay line sản xuất của họ.
 *
 * 🔴 **Không bao giờ tạo gói thứ hai.** Thứ tự bắt buộc:
 *
 * ```
 *   1. database đã biết gói (lượt trước / đồng bộ đơn)  → Get Package Shipping Document (đọc)
 *   2. Get Order Detail: TikTok đã có gói? (Seller Center, hoặc lượt trước timeout sau khi tạo)
 *        └─ có → Get Package Shipping Document
 *   3. Get Eligible Shipping Service → chọn dịch vụ hợp lệ (mặc định / duy nhất / người dùng chọn)
 *   4. Create Packages (KHÔNG retry) — hỏng đường truyền ⇒ ĐỐI SOÁT bằng Get Order Detail
 *   5. Get Package Shipping Document (hỏi lại vài lần khi TikTok chưa có file) → LƯU → trả về
 * ```
 *
 * Cộng thêm khoá phân tán theo đơn ⇒ bấm liên tiếp / hai người cùng bấm cũng không sinh hai gói.
 *
 * 🔴 **Không viết cứng dịch vụ vận chuyển / nhà vận chuyển.** Dịch vụ lấy từ chính phản hồi của
 * TikTok; nhiều dịch vụ mà TikTok không đánh dấu mặc định ⇒ người vận hành chọn (không đoán).
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
    private readonly accessScope: PodAccessScopeService,
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
   * Lấy nhãn từ TikTok — dùng lại gói đã có, chỉ tạo gói khi đơn chưa có gói nào (kể cả trên TikTok).
   */
  async fetchFromTiktok(
    organizationId: string,
    userId: string,
    podOrderId: string,
    input: FetchTiktokLabelInput,
    scope: PodAccessScope,
  ): Promise<ShippingLabelState> {
    const result = await this.guard('label.tiktok.fetch', { organizationId, podOrderId }, () =>
      this.lock.withLock(`fulfillment:label:${podOrderId}`, LABEL_LOCK_MS, () =>
        this.fetchLocked(organizationId, userId, podOrderId, input, scope),
      ),
    );
    if (!result) throw new ShippingLabelBusyException();
    return result;
  }

  /**
   * Hàng rào cuối: **không một lỗi nào được rơi ra ngoài dưới dạng `Error` thường.**
   *
   * 🔴 `Error` thường đi tới `AllExceptionsFilter` là thành `500 INTERNAL_ERROR` — ở production
   * chỉ còn câu "Internal server error", người vận hành không biết gì. Ở đây lỗi được GHI LẠI đầy
   * đủ (tên lỗi, thông điệp, stack, đơn, tổ chức) ở phía máy chủ kèm một **mã tham chiếu**; phía
   * giao diện chỉ nhận mã lỗi riêng + mã tham chiếu đó — KHÔNG nhận thông điệp kỹ thuật (lỗi
   * Prisma/Redis chứa tên bảng, host, câu truy vấn).
   */
  private async guard<T>(
    operation: string,
    context: { organizationId: string; podOrderId: string },
    task: () => Promise<T>,
  ): Promise<T> {
    try {
      return await task();
    } catch (error) {
      // Lỗi nghiệp vụ đã có mã + thông điệp ⇒ giữ nguyên, đừng bọc thêm một lớp mơ hồ.
      if (error instanceof HttpException) throw error;
      const referenceId = randomUUID();
      this.logger.error({
        module: 'fulfillment',
        operation,
        referenceId,
        organizationId: context.organizationId,
        podOrderId: context.podOrderId,
        errorName: error instanceof Error ? error.name : typeof error,
        msg: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new ShippingLabelUnavailableException(
        `Lỗi hệ thống khi xử lý nhãn vận chuyển (mã tham chiếu ${referenceId}). Thử lại sau ít ` +
          'phút; nếu vẫn lỗi, gửi mã tham chiếu này cho bộ phận kỹ thuật.',
        SHIPPING_LABEL_ERROR_CODES.INTERNAL,
        {
          provider: 'TIKTOK',
          operation: 'INTERNAL',
          providerCode: null,
          requestId: null,
          referenceId,
        },
      );
    }
  }

  /** Người vận hành tự dán URL nhãn — lưu XUỐNG DATABASE, không chỉ giữ ở giao diện. */
  async saveManualLabel(
    organizationId: string,
    userId: string,
    podOrderId: string,
    labelUrl: string,
    scope: PodAccessScope,
  ): Promise<ShippingLabelState> {
    return this.guard('label.manual.save', { organizationId, podOrderId }, () =>
      this.saveManualLabelUnguarded(organizationId, userId, podOrderId, labelUrl, scope),
    );
  }

  private async saveManualLabelUnguarded(
    organizationId: string,
    userId: string,
    podOrderId: string,
    labelUrl: string,
    scope: PodAccessScope,
  ): Promise<ShippingLabelState> {
    const order = await this.requireOrder(organizationId, podOrderId, scope);
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
  async clearLabel(
    organizationId: string,
    podOrderId: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const order = await this.requireOrder(organizationId, podOrderId, scope);
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
    input: FetchTiktokLabelInput,
    scope: PodAccessScope,
  ): Promise<ShippingLabelState> {
    // Kiểm phạm vi shop TRONG khoá, ngay trước mọi lời gọi TikTok (tạo gói là lệnh ghi thật).
    const order = await this.requireOrder(organizationId, podOrderId, scope);
    // Đơn người bán tự vận chuyển: TikTok KHÔNG cấp nhãn — nói thẳng, không gọi API một cách mù quáng.
    this.assertTiktokShipping(order.shippingType);
    const ctx = await this.resolveShopContext(organizationId, order);
    this.logger.log({
      module: 'fulfillment',
      operation: 'label.tiktok.start',
      organizationId,
      podOrderId,
      tiktokOrderId: order.tiktokOrderId,
      shopId: order.shopId,
      shippingType: order.shippingType,
      knownPackageId: order.shippingLabelPackageId ?? order.packages[0]?.tiktokPackageId ?? null,
      userId,
      msg: 'Bắt đầu lấy nhãn vận chuyển TikTok',
    });

    // ---- 1. Database đã biết gói? Dùng lại, TUYỆT ĐỐI không tạo gói thứ hai ----
    const existingPackageId =
      order.shippingLabelPackageId ?? order.packages[0]?.tiktokPackageId ?? null;
    if (existingPackageId) {
      return this.labelOfExistingPackage(organizationId, userId, order, ctx, existingPackageId);
    }

    // ---- 2. Hỏi CHÍNH TikTok: đơn có không, còn hợp lệ không, đã có gói chưa? ----
    // 🔴 Đây là chốt chống gói TRÙNG khi trình duyệt/máy chủ hết thời gian chờ: lượt trước có thể đã
    // tạo gói trên TikTok nhưng chưa kịp ghi xuống database. Không hỏi mà tạo luôn là shop có hai gói.
    const detail = await this.run('ORDER_DETAIL', () =>
      this.tiktok.getOrderFulfillmentInfo(ctx, order.tiktokOrderId),
    );
    if (!detail.data.found) {
      throw new ShippingLabelUnavailableException(
        'TikTok không trả về đơn này (đơn không tồn tại, đã bị xoá, hoặc không thuộc shop đang kết ' +
          'nối). Đồng bộ lại đơn từ TikTok rồi thử lại.',
        SHIPPING_LABEL_ERROR_CODES.ORDER_NOT_FOUND,
        this.details('ORDER_DETAIL', detail.requestId ?? null),
      );
    }
    this.assertTiktokShipping(detail.data.shippingType);
    const tiktokPackageId = detail.data.packageIds[0] ?? null;
    if (tiktokPackageId) {
      return this.labelOfExistingPackage(organizationId, userId, order, ctx, tiktokPackageId, {
        attempts: DOCUMENT_READY_ATTEMPTS,
      });
    }
    if (detail.data.status && NOT_PACKABLE_ORDER_STATUSES.has(detail.data.status.toUpperCase())) {
      throw new ShippingLabelUnavailableException(
        `Đơn đang ở trạng thái ${detail.data.status} trên TikTok — TikTok chỉ tạo gói/nhãn cho đơn ` +
          'đang chờ giao (AWAITING_SHIPMENT).',
        SHIPPING_LABEL_ERROR_CODES.ORDER_NOT_PACKABLE,
        this.details('ORDER_DETAIL', detail.requestId ?? null, { providerMessage: detail.data.status }),
      );
    }

    // ---- 3. Chưa có gói ở đâu cả: dịch vụ vận chuyển TikTok cho phép với đơn này ----
    const services = await this.run('SHIPPING_SERVICES', () =>
      this.tiktok.queryShippingServices(ctx, order.tiktokOrderId),
    );
    const service = this.pickService(
      services.data.shippingServices ?? [],
      input.shippingServiceId,
      services.requestId ?? null,
    );

    // ---- 4. Tạo gói (KHÔNG retry ở tầng SDK — xem TiktokFulfillmentApiService) ----
    const packageId = await this.createPackageOnce(ctx, order, service);

    // ---- 5. Lấy nhãn của gói vừa tạo (TikTok có thể cần vài giây) ----
    const document = await this.getDocument(ctx, packageId.id, DOCUMENT_READY_ATTEMPTS);
    return this.persist(organizationId, userId, order, {
      packageId: packageId.id,
      labelUrl: document.docUrl,
      trackingNumber: document.trackingNumber ?? null,
      shippingService: packageId.shippingService,
      reusedPackage: false,
    });
  }

  /**
   * Nhãn của một gói ĐÃ CÓ (không bao giờ tạo gói). Nhãn đã lưu của chính gói này mà TikTok không
   * cấp lại được file (vd gói đã được lấy hàng) ⇒ trả về nhãn đã lưu kèm cảnh báo, thay vì báo lỗi
   * — đơn đã có nhãn hợp lệ.
   */
  private async labelOfExistingPackage(
    organizationId: string,
    userId: string,
    order: PodOrderWithRelations,
    ctx: ShopContext,
    packageId: string,
    options: { attempts?: number } = {},
  ): Promise<ShippingLabelState> {
    let document: { docUrl: string; trackingNumber?: string };
    try {
      document = await this.getDocument(ctx, packageId, options.attempts ?? 1);
    } catch (error) {
      const stored = FulfillmentShippingLabelService.labelOf(order);
      const sameTiktokLabel =
        stored?.source === SHIPPING_LABEL_SOURCE.TIKTOK && stored.packageId === packageId;
      if (!(error instanceof ShippingLabelUnavailableException) || !sameTiktokLabel || !stored) {
        throw error;
      }
      this.logger.warn({
        module: 'fulfillment',
        operation: 'label.tiktok.stored',
        organizationId,
        podOrderId: order.id,
        tiktokOrderId: order.tiktokOrderId,
        packageId,
        errorCode: error.code,
        msg: 'TikTok không cấp lại được file nhãn — trả về nhãn đã lưu của cùng gói',
      });
      return { ...stored, reusedPackage: true, refreshed: false, warning: error.message };
    }
    return this.persist(organizationId, userId, order, {
      packageId,
      labelUrl: document.docUrl,
      trackingNumber: document.trackingNumber ?? null,
      shippingService: null,
      reusedPackage: true,
    });
  }

  /**
   * Chọn dịch vụ vận chuyển — theo đúng thứ tự, KHÔNG lấy phần tử đầu tiên vô điều kiện:
   *
   * 1. Người vận hành đã chọn ⇒ phải nằm trong danh sách TikTok trả về (không thì báo lỗi).
   * 2. TikTok chỉ trả MỘT dịch vụ ⇒ dùng nó.
   * 3. TikTok đánh dấu đúng MỘT dịch vụ `is_default` ⇒ dùng nó (TikTok biết shop đăng ký gói cước nào).
   * 4. Còn lại ⇒ dừng, trả danh sách để người vận hành chọn.
   *
   * 🔴 Không so giá, không đoán theo tên nhà vận chuyển: tự chọn "rẻ nhất" là âm thầm đổi dịch vụ
   * vận chuyển của người bán.
   */
  private pickService(
    services: TiktokShippingService[],
    requestedId: string | undefined,
    requestId: string | null,
  ): { id: string; name: string | null } {
    const valid = services.filter((entry): entry is TiktokShippingService & { id: string } =>
      Boolean(entry.id?.trim()),
    );
    const choices: ShippingServiceChoice[] = valid.map((entry) => ({
      id: entry.id,
      name: entry.name ?? null,
      shippingProviderName: entry.shippingProviderName ?? null,
    }));

    if (valid.length === 0) {
      throw new ShippingLabelUnavailableException(
        'TikTok không trả về dịch vụ vận chuyển nào cho đơn này — đơn có thể không thuộc diện ' +
          'TikTok Shipping, hoặc đã được đóng gói/vận chuyển bằng cách khác. Kiểm tra đơn trên ' +
          'Seller Center, hoặc dán URL nhãn vào ô "Nhãn vận chuyển".',
        SHIPPING_LABEL_ERROR_CODES.NO_SHIPPING_SERVICE,
        this.details('SHIPPING_SERVICES', requestId),
      );
    }

    const requested = requestedId?.trim();
    if (requested) {
      const match = valid.find((entry) => entry.id === requested);
      if (!match) {
        throw new ShippingLabelUnavailableException(
          'Dịch vụ vận chuyển đã chọn không còn nằm trong danh sách TikTok cho phép với đơn này. ' +
            'Chọn lại một dịch vụ trong danh sách.',
          SHIPPING_LABEL_ERROR_CODES.SERVICE_INVALID,
          this.details('SHIPPING_SERVICES', requestId, { shippingServices: choices }),
        );
      }
      return { id: match.id, name: match.name ?? null };
    }

    if (valid.length === 1) return { id: valid[0].id, name: valid[0].name ?? null };
    const defaults = valid.filter((entry) => entry.isDefault === true);
    if (defaults.length === 1) return { id: defaults[0].id, name: defaults[0].name ?? null };

    throw new ShippingLabelUnavailableException(
      `TikTok trả về ${valid.length} dịch vụ vận chuyển cho đơn này nhưng không đánh dấu dịch vụ mặc ` +
        'định. Chọn một dịch vụ để tạo gói hàng.',
      SHIPPING_LABEL_ERROR_CODES.SERVICE_SELECTION_REQUIRED,
      this.details('SHIPPING_SERVICES', requestId, { shippingServices: choices }),
    );
  }

  /**
   * Gửi lệnh tạo gói ĐÚNG MỘT LẦN.
   *
   * 🔴 Hỏng ở đường truyền (timeout / mất kết nối / 5xx) ⇒ gói CÓ THỂ đã được tạo. Không gửi lại;
   * hỏi Get Order Detail (đọc thuần) để đối soát: thấy gói ⇒ dùng gói đó; chắc chắn không có ⇒ báo
   * lỗi "bấm lại an toàn"; không đối soát được ⇒ báo lỗi, lượt bấm sau vẫn hỏi TikTok trước khi tạo.
   */
  private async createPackageOnce(
    ctx: ShopContext,
    order: PodOrderWithRelations,
    service: { id: string; name: string | null },
  ): Promise<{ id: string; shippingService: { id: string | null; name: string | null } }> {
    let created: Awaited<ReturnType<TiktokFulfillmentApiService['createPackage']>>;
    try {
      created = await this.run(
        'CREATE_PACKAGE',
        () =>
          this.tiktok.createPackage(ctx, {
            orderId: order.tiktokOrderId,
            shippingServiceId: service.id,
          }),
        { businessCode: SHIPPING_LABEL_ERROR_CODES.PACKAGE_CREATE_FAILED },
      );
    } catch (error) {
      if (
        !(error instanceof ShippingLabelUnavailableException) ||
        error.code !== SHIPPING_LABEL_ERROR_CODES.UNREACHABLE
      ) {
        throw error;
      }
      const recovered = await this.reconcileCreatedPackage(ctx, order);
      if (recovered.packageId) {
        this.logger.warn({
          module: 'fulfillment',
          operation: 'label.tiktok.reconcile',
          podOrderId: order.id,
          tiktokOrderId: order.tiktokOrderId,
          packageId: recovered.packageId,
          msg: 'Tạo gói hỏng đường truyền nhưng TikTok ĐÃ tạo gói — dùng gói đó, không tạo lại',
        });
        return { id: recovered.packageId, shippingService: { id: service.id, name: service.name } };
      }
      const details = (error.getResponse() as { details?: ShippingLabelErrorDetails }).details ?? null;
      throw new ShippingLabelUnavailableException(
        recovered.confirmedNone
          ? 'Không kết nối được TikTok khi tạo gói; đã kiểm tra lại và TikTok CHƯA tạo gói nào cho ' +
              'đơn này. Bấm lại để thử lần nữa.'
          : 'Không kết nối được TikTok khi tạo gói và chưa xác nhận được gói đã được tạo hay chưa. ' +
              'Bấm lại sau ít phút — hệ thống kiểm tra gói trên TikTok trước, không tạo gói trùng.',
        SHIPPING_LABEL_ERROR_CODES.UNREACHABLE,
        details,
      );
    }

    const packageId = created.data.packageId?.trim();
    if (!packageId) {
      throw new ShippingLabelUnavailableException(
        'TikTok nhận lệnh tạo gói nhưng không trả về `package_id`. Bấm lại — hệ thống kiểm tra gói ' +
          'trên TikTok trước, không tạo gói trùng.',
        SHIPPING_LABEL_ERROR_CODES.PACKAGE_CREATE_FAILED,
        this.details('CREATE_PACKAGE', created.requestId ?? null),
      );
    }
    return {
      id: packageId,
      shippingService: {
        id: created.data.shippingServiceInfo?.id ?? service.id,
        name: created.data.shippingServiceInfo?.name ?? service.name,
      },
    };
  }

  /** Đối soát sau khi tạo gói hỏng đường truyền: TikTok đã có gói cho đơn chưa? (đọc thuần) */
  private async reconcileCreatedPackage(
    ctx: ShopContext,
    order: PodOrderWithRelations,
  ): Promise<{ packageId: string | null; confirmedNone: boolean }> {
    let confirmedNone = false;
    for (let attempt = 1; attempt <= CREATE_RECONCILE_ATTEMPTS; attempt += 1) {
      await this.sleep(CREATE_RECONCILE_DELAY_MS);
      try {
        const detail = await this.tiktok.getOrderFulfillmentInfo(ctx, order.tiktokOrderId);
        const packageId = detail.data.packageIds[0] ?? null;
        if (packageId) return { packageId, confirmedNone: false };
        confirmedNone = detail.data.found;
      } catch (error) {
        confirmedNone = false;
        this.logger.warn({
          module: 'fulfillment',
          operation: 'label.tiktok.reconcile',
          podOrderId: order.id,
          tiktokOrderId: order.tiktokOrderId,
          attempt,
          errorName: error instanceof Error ? error.name : typeof error,
          msg: 'Chưa đối soát được gói sau khi tạo gói hỏng đường truyền',
        });
      }
    }
    return { packageId: null, confirmedNone };
  }

  /**
   * Tài liệu nhãn của một gói. `attempts > 1` ⇒ hỏi lại khi TikTok chưa có file (gói vừa tạo); đọc
   * thuần nên hỏi lại vô hại.
   */
  private async getDocument(
    ctx: ShopContext,
    packageId: string,
    attempts: number,
  ): Promise<{ docUrl: string; trackingNumber?: string }> {
    let requestId: string | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const document = await this.run('SHIPPING_DOCUMENT', () =>
        this.tiktok.getShippingDocument(ctx, packageId),
      );
      requestId = document.requestId ?? null;
      const docUrl = document.data.docUrl?.trim();
      if (docUrl) return { docUrl, trackingNumber: document.data.trackingNumber?.trim() || undefined };
      if (attempt < attempts) await this.sleep(DOCUMENT_READY_DELAY_MS);
    }
    throw new ShippingLabelUnavailableException(
      'TikTok chưa cấp được file nhãn cho gói này. Thường là gói vừa tạo và TikTok còn đang ' +
        'xử lý — chờ một lát rồi bấm lại (bấm lại KHÔNG tạo gói mới).',
      SHIPPING_LABEL_ERROR_CODES.DOCUMENT_UNAVAILABLE,
      this.details('SHIPPING_DOCUMENT', requestId),
    );
  }

  /** Chỉ đơn TikTok Shipping mới có nhãn do TikTok cấp. `undefined` (chưa đồng bộ) ⇒ để TikTok trả lời. */
  private assertTiktokShipping(shippingType: string | null | undefined): void {
    if (!shippingType || shippingType.toUpperCase() === TIKTOK_SHIPPING_TYPE) return;
    throw new ShippingLabelUnavailableException(
      `Đơn này không dùng TikTok Shipping (kiểu vận chuyển: ${shippingType}) — TikTok không cấp nhãn. ` +
        'Dán URL nhãn của đơn vị vận chuyển bạn dùng vào ô "Nhãn vận chuyển".',
      SHIPPING_LABEL_ERROR_CODES.NOT_TIKTOK_SHIPPING,
      this.details('ORDER_DETAIL', null, { providerMessage: shippingType }),
    );
  }

  private details(
    operation: ShippingLabelErrorDetails['operation'],
    requestId: string | null,
    extra: Partial<ShippingLabelErrorDetails> = {},
  ): ShippingLabelErrorDetails {
    return { provider: 'TIKTOK', operation, providerCode: null, requestId, ...extra };
  }

  /** Tách ra để test không phải chờ thật. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Ghi nhãn xuống database: bản ghi gói + nhãn hiệu lực của đơn (một transaction). */
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

    const storedService =
      input.shippingService?.name ??
      order.packages.find((entry) => entry.tiktokPackageId === input.packageId)
        ?.shippingServiceName ??
      null;

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
      shippingServiceName: storedService,
      obtainedAt: now.toISOString(),
      reusedPackage: input.reusedPackage,
      refreshed: true,
      warning: null,
    };
  }

  /**
   * Đơn của tổ chức (404 nếu không có). Truyền `scope` ⇒ đơn còn phải thuộc shop người gọi được
   * gán (403 nếu không) — mọi thao tác GHI đều truyền.
   */
  private async requireOrder(
    organizationId: string,
    podOrderId: string,
    scope?: PodAccessScope,
  ): Promise<PodOrderWithRelations> {
    const order = await this.podOrderRepo.findById(organizationId, podOrderId);
    if (!order) throw new FulfillmentOrderNotFoundException();
    if (scope) this.accessScope.assertShopAllowed(scope, order.shopId);
    return order;
  }

  private async resolveShopContext(
    organizationId: string,
    order: PodOrderWithRelations,
  ): Promise<ShopContext> {
    try {
      return await this.shopContext.resolve(organizationId, order.shopId);
    } catch (error) {
      if (error instanceof PodTiktokShopContextException) {
        throw new ShippingLabelUnavailableException(
          `Không gọi được API TikTok cho shop của đơn này: ${error.message}`,
          SHIPPING_LABEL_ERROR_CODES.SHOP_CONTEXT,
          this.details('SHOP_CONTEXT', null),
        );
      }
      throw error;
    }
  }

  /**
   * Gọi TikTok và dịch lỗi sang thông điệp người vận hành HIỂU ĐƯỢC.
   *
   * 🔴 Không gộp mọi lỗi thành một câu chung: "thiếu quyền" và "đơn không đủ điều kiện" là hai việc
   * phải làm khác hẳn nhau. Chi tiết kỹ thuật (endpoint, mã lỗi, request id) ghi vào log máy chủ;
   * giao diện nhận mã lỗi + thông điệp an toàn của TikTok.
   */
  private async run<T>(
    operation: ShippingLabelErrorDetails['operation'],
    call: () => Promise<{ data: T; requestId?: string }>,
    options: { businessCode?: string } = {},
  ): Promise<{
    data: T;
    requestId?: string;
  }> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof TiktokClientError)) throw error;
      const details: ShippingLabelErrorDetails = {
        provider: 'TIKTOK',
        operation,
        providerCode: String(error.tiktokCode),
        requestId: error.requestId ?? null,
        providerMessage: error.tiktokMessage,
      };

      this.logger.error({
        module: 'fulfillment',
        operation: 'label.tiktok.error',
        step: operation,
        endpoint: error.endpoint,
        httpStatus: error.httpStatus,
        tiktokCode: error.tiktokCode,
        tiktokRequestId: error.requestId,
        errorClass: error.errorClass,
        msg: error.tiktokMessage,
      });

      if (error.errorClass === TiktokErrorClass.AUTH) {
        throw new ShippingLabelUnavailableException(
          'Xác thực TikTok thất bại: kết nối của shop này chưa có quyền Fulfillment/Logistics hoặc ' +
            'uỷ quyền đã hết hạn. Kết nối lại TikTok Shop với đủ quyền rồi thử lại.',
          SHIPPING_LABEL_ERROR_CODES.AUTH,
          details,
        );
      }
      if (error.errorClass === TiktokErrorClass.RATE_LIMIT) {
        throw new ShippingLabelUnavailableException(
          'TikTok đang giới hạn tần suất gọi API. Chờ một lát rồi bấm lại.',
          SHIPPING_LABEL_ERROR_CODES.RATE_LIMITED,
          details,
        );
      }
      if (error.errorClass === TiktokErrorClass.NETWORK || error.errorClass === TiktokErrorClass.SERVER) {
        // Lời gọi đọc đã được thử lại có kiểm soát ở tầng SDK; lệnh tạo gói thì KHÔNG (xem
        // `createPackageOnce` — nó tự đối soát trước khi báo lỗi này).
        throw new ShippingLabelUnavailableException(
          `Không kết nối được TikTok (${error.tiktokMessage}). Bấm lại sau ít phút — hệ thống kiểm ` +
            'tra gói đã có trên TikTok trước, không tạo gói trùng.',
          SHIPPING_LABEL_ERROR_CODES.UNREACHABLE,
          details,
        );
      }
      // Lỗi nghiệp vụ: giữ NGUYÊN VĂN thông điệp của TikTok — đó là thứ nói đúng nhất vì sao đơn
      // này không lấy được nhãn.
      const prefix =
        options.businessCode === SHIPPING_LABEL_ERROR_CODES.PACKAGE_CREATE_FAILED
          ? 'TikTok không tạo được gói hàng'
          : 'TikTok từ chối yêu cầu lấy nhãn';
      throw new ShippingLabelUnavailableException(
        `${prefix} (mã ${error.tiktokCode}): ${error.tiktokMessage}`,
        options.businessCode ?? SHIPPING_LABEL_ERROR_CODES.REJECTED,
        details,
      );
    }
  }
}
