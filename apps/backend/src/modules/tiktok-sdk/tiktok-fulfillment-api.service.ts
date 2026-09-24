import { Injectable } from '@nestjs/common';
import { TikTokSdkService } from './tiktok-sdk.service';
import {
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

  /** **Get Package Detail** — trạng thái gói (để biết gói cũ còn dùng được không). */
  getPackage(
    ctx: TiktokShopContext,
    packageId: string,
  ): Promise<TiktokSdkResult<TiktokPackageDetail>> {
    return this.sdk.execute<TiktokPackageDetail>({
      endpoint: 'FULFILLMENT_PACKAGE_DETAIL',
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
