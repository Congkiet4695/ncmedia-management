import { Injectable } from '@nestjs/common';
import { TikTokSdkService } from './tiktok-sdk.service';
import {
  TIKTOK_FULFILLMENT_MAX_RETRY,
  TIKTOK_FULFILLMENT_TIMEOUT_MS,
  TIKTOK_SDK_CONTENT_TYPE,
  TIKTOK_SHIPPING_DOCUMENT_FORMAT,
  TIKTOK_SHIPPING_DOCUMENT_SIZE,
  TIKTOK_SHIPPING_DOCUMENT_TYPE,
  type TiktokShippingDocumentType,
} from './tiktok-sdk.constants';
import type { TiktokSdkResult, TiktokShopContext } from './types/tiktok-shop-context.type';
import type {
  TiktokCreatePackageRequest,
  TiktokCreatedPackage,
  TiktokEligibleShippingServices,
  TiktokOrderFulfillmentInfo,
  TiktokPackageDetail,
  TiktokShippingDocument,
} from './types/tiktok-fulfillment.types';

/**
 * TiktokFulfillmentApiService — nhóm **Fulfillment / Shipping** của TikTok Shop (bản 202309).
 *
 * ```
 *   FulfillmentShippingLabelService → TiktokFulfillmentApiService → TikTokSdkService → SDK
 * ```
 *
 * Luồng lấy nhãn vận chuyển theo đúng tài liệu TikTok:
 *
 * ```
 *   1. POST /fulfillment/202309/orders/{order_id}/shipping_services/query   (dịch vụ khả dụng)
 *   2. POST /fulfillment/202309/packages                                     (tạo gói)
 *   3. GET  /fulfillment/202309/packages/{package_id}/shipping_documents     (lấy nhãn)
 * ```
 *
 * 🔴 Bước 1 và 3 đọc dữ liệu nên retry được. Bước 2 **KHÔNG**: gửi lại lệnh tạo gói là shop có
 * thêm một gói thật, và nhãn thừa đó vẫn bị tính phí vận chuyển. Xem `TiktokSdkCall.retry`.
 *
 * 🔴 Không viết cứng dịch vụ vận chuyển, nhà vận chuyển hay tên dịch vụ: mọi giá trị đều lấy
 * từ chính phản hồi của TikTok (mỗi shop/mỗi đơn một danh sách khác nhau).
 */
/** Lời gọi ĐỌC: có giới hạn thời gian, thử lại có kiểm soát (mạng / 5xx / rate limit). */
const READ_CALL = {
  timeoutMs: TIKTOK_FULFILLMENT_TIMEOUT_MS,
  maxRetries: TIKTOK_FULFILLMENT_MAX_RETRY,
} as const;

@Injectable()
export class TiktokFulfillmentApiService {
  constructor(private readonly sdk: TikTokSdkService) {}

  /**
   * **Get Eligible Shipping Service** — những dịch vụ vận chuyển TikTok cho phép với đơn này.
   *
   * Body để trống: kích thước/khối lượng gói là tuỳ chọn, và hệ thống không đo gói hàng POD —
   * xưởng in mới là nơi đóng gói. Gửi số liệu bịa ra chỉ làm sai phí ước tính.
   */
  queryShippingServices(
    ctx: TiktokShopContext,
    tiktokOrderId: string,
  ): Promise<TiktokSdkResult<TiktokEligibleShippingServices>> {
    return this.sdk.execute<TiktokEligibleShippingServices>({
      endpoint: 'FULFILLMENT_SHIPPING_SERVICES',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.FulfillmentV202309Api.OrdersOrderIdShippingServicesQueryPost(
          tiktokOrderId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          {},
        ),
    });
  }

  /**
   * **Create Packages** — tạo gói hàng (mua nhãn) cho đơn.
   *
   * 🔴 `retry: false`. Đây là lệnh GHI không có khoá idempotency: mỗi lần gọi là một gói mới.
   * Nơi gọi phải tự bảo đảm chỉ gọi khi đơn CHƯA có gói nào — xem
   * `FulfillmentShippingLabelService`.
   */
  createPackage(
    ctx: TiktokShopContext,
    request: TiktokCreatePackageRequest,
  ): Promise<TiktokSdkResult<TiktokCreatedPackage>> {
    return this.sdk.execute<TiktokCreatedPackage>({
      endpoint: 'FULFILLMENT_CREATE_PACKAGE',
      retry: false,
      timeoutMs: TIKTOK_FULFILLMENT_TIMEOUT_MS,
      invoke: () =>
        this.sdk.api.FulfillmentV202309Api.PackagesPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          request,
        ),
    });
  }

  /**
   * **Get Package Shipping Document** — nhãn vận chuyển của một gói.
   *
   * Đọc thuần: gọi lại bao nhiêu lần cũng không tạo thêm gì, nên đây là đường AN TOÀN cho nút
   * "Lấy nhãn từ TikTok" khi đơn đã có gói.
   */
  getShippingDocument(
    ctx: TiktokShopContext,
    packageId: string,
    options: { documentType?: TiktokShippingDocumentType; documentSize?: string } = {},
  ): Promise<TiktokSdkResult<TiktokShippingDocument>> {
    const documentType = options.documentType ?? TIKTOK_SHIPPING_DOCUMENT_TYPE.SHIPPING_LABEL;
    return this.sdk.execute<TiktokShippingDocument>({
      endpoint: 'FULFILLMENT_SHIPPING_DOCUMENT',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.FulfillmentV202309Api.PackagesPackageIdShippingDocumentsGet(
          packageId,
          documentType,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          options.documentSize ?? TIKTOK_SHIPPING_DOCUMENT_SIZE,
          TIKTOK_SHIPPING_DOCUMENT_FORMAT,
          undefined,
          ctx.shopCipher,
        ),
    });
  }

  /**
   * **Get Order Detail** (`GET /order/202309/orders`) — chỉ lấy gói hiện có, kiểu vận chuyển và
   * trạng thái của MỘT đơn. Đọc thuần.
   *
   * 🔴 Dùng TRƯỚC khi tạo gói: đơn có thể đã có gói mà database chưa biết (gói tạo trên Seller
   * Center, hoặc lượt lấy nhãn trước đã tạo gói nhưng trình duyệt hết thời gian chờ). Tạo thêm lúc
   * đó là shop có hai gói thật.
   */
  async getOrderFulfillmentInfo(
    ctx: TiktokShopContext,
    tiktokOrderId: string,
  ): Promise<TiktokSdkResult<TiktokOrderFulfillmentInfo>> {
    const result = await this.sdk.execute<{
      orders?: Array<{ status?: string; shippingType?: string; packages?: Array<{ id?: string }> }>;
    }>({
      endpoint: 'ORDER_DETAIL',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.OrderV202309Api.OrdersGet(
          [tiktokOrderId],
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
        ),
    });
    const order = result.data?.orders?.[0];
    return {
      data: {
        found: Boolean(order),
        status: order?.status,
        shippingType: order?.shippingType,
        packageIds: (order?.packages ?? [])
          .map((entry) => entry.id?.trim())
          .filter((id): id is string => Boolean(id)),
      },
      requestId: result.requestId,
    };
  }

  /** **Get Package Detail** — trạng thái gói (để biết gói cũ còn dùng được không). */
  getPackage(
    ctx: TiktokShopContext,
    packageId: string,
  ): Promise<TiktokSdkResult<TiktokPackageDetail>> {
    return this.sdk.execute<TiktokPackageDetail>({
      endpoint: 'FULFILLMENT_PACKAGE_DETAIL',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.FulfillmentV202309Api.PackagesPackageIdGet(
          packageId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
        ),
    });
  }
}
