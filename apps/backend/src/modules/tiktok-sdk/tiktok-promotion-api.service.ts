import { Injectable, Logger } from '@nestjs/common';
import {
  TIKTOK_ACTIVITY_DURATION_TYPE,
  TIKTOK_ACTIVITY_MAX_PAGES_PER_RUN,
  TIKTOK_ACTIVITY_SEARCH_PAGE_SIZE,
  TIKTOK_SDK_CONTENT_TYPE,
} from './tiktok-sdk.constants';
import { TikTokSdkService } from './tiktok-sdk.service';
import type {
  TiktokActivityDetail,
  TiktokActivityProductInput,
  TiktokActivitySearchFilter,
  TiktokActivitySummary,
  TiktokCreateActivityRequest,
  TiktokCreateActivityResult,
  TiktokUpdateActivityProductsResult,
  TiktokUpdateActivityRequest,
} from './types/tiktok-promotion.types';
import type {
  TiktokPage,
  TiktokSdkResult,
  TiktokShopContext,
} from './types/tiktok-shop-context.type';

/**
 * TiktokPromotionApiService — lớp bọc nhóm API **Promotion (Activity)** của TikTok Shop.
 *
 * Cùng khuôn với `TiktokProductApiService`: module nghiệp vụ (`pod-flash-sale`) chỉ gọi
 * service này và chỉ thấy kiểu của `types/tiktok-promotion.types.ts`. Không service nghiệp
 * vụ nào biết tên lớp SDK, version API hay `shop_cipher` đặt ở tham số thứ mấy.
 *
 * Version đang dùng: **202309** cho toàn bộ Activity API (xem `TIKTOK_PROMOTION_API_VERSIONS`
 * — SDK không có bản nào khác cho nhóm này).
 *
 * ```
 *   createActivity ──▶ activityId ──▶ updateActivityProducts ──▶ getActivity
 *                                     removeActivityProducts    deactivateActivity
 * ```
 *
 * 🔴 Service này KHÔNG có nghiệp vụ: không kiểm giá, không chia lô, không quyết trạng thái.
 * Chia lô 300 dòng và mọi luật của Flash Sale nằm ở `PodFlashSalePublisherService` — ranh
 * giới đó giữ cho lớp bọc SDK dùng lại được cho module Promotion của sprint sau.
 */
@Injectable()
export class TiktokPromotionApiService {
  private readonly logger = new Logger(TiktokPromotionApiService.name);

  constructor(private readonly sdk: TikTokSdkService) {}

  /**
   * Create Activity — tạo hoạt động khuyến mãi RỖNG (chưa có sản phẩm).
   *
   * 🔴 TikTok tách làm hai bước cố ý: hoạt động sinh ra trước để có `activity_id`, sản phẩm
   * gắn vào sau bằng `updateActivityProducts`. Không có endpoint nào tạo cả hai một lượt,
   * nên đường publish của Flash Sale bắt buộc là hai lời gọi.
   *
   * `duration_type` luôn `NORMAL`: `INDEFINITE` chỉ hợp lệ với `SHIPPING_DISCOUNT`.
   */
  async createActivity(
    ctx: TiktokShopContext,
    request: TiktokCreateActivityRequest,
  ): Promise<TiktokSdkResult<TiktokCreateActivityResult>> {
    const result = await this.sdk.execute<{ activityId?: string; status?: string }>({
      endpoint: 'PROMOTION_ACTIVITY_CREATE',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          {
            title: request.title,
            activityType: request.activityType,
            productLevel: request.productLevel,
            durationType: TIKTOK_ACTIVITY_DURATION_TYPE.NORMAL,
            beginTime: request.beginTime,
            endTime: request.endTime,
          },
        ),
    });

    // `activity_id` là thứ DUY NHẤT khiến lời gọi này có giá trị: thiếu nó thì mọi bước sau
    // (gắn sản phẩm, đọc trạng thái, huỷ) đều không có địa chỉ để trỏ tới. Ném ngay thay vì
    // để `undefined` trôi xuống và chết ở một chỗ khó truy nguyên.
    if (!result.data.activityId) {
      throw new Error(
        'TikTok tạo hoạt động khuyến mãi thành công nhưng KHÔNG trả về activity_id — ' +
          `request_id=${result.requestId ?? 'không có'}`,
      );
    }

    return {
      data: { activityId: result.data.activityId, status: result.data.status },
      requestId: result.requestId,
    };
  }

  /** Update Activity — sửa tên và/hoặc khung giờ của hoạt động đã tạo. */
  async updateActivity(
    ctx: TiktokShopContext,
    activityId: string,
    request: TiktokUpdateActivityRequest,
  ): Promise<TiktokSdkResult<TiktokActivityDetail>> {
    const result = await this.sdk.execute<TiktokActivityDetail>({
      endpoint: 'PROMOTION_ACTIVITY_UPDATE',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesActivityIdPut(
          activityId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          {
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(request.productLevel === undefined ? {} : { productLevel: request.productLevel }),
            ...(request.beginTime === undefined ? {} : { beginTime: request.beginTime }),
            ...(request.endTime === undefined ? {} : { endTime: request.endTime }),
            durationType: TIKTOK_ACTIVITY_DURATION_TYPE.NORMAL,
          },
        ),
    });
    return { data: result.data ?? {}, requestId: result.requestId };
  }

  /**
   * Update Activity Products — gắn/sửa sản phẩm, giá deal và giới hạn mua.
   *
   * 🔴 Nơi gọi phải tự bảo đảm KHÔNG vượt 300 sản phẩm **và** 300 SKU cho MỘT lần gọi
   * (`TIKTOK_ACTIVITY_MAX_*_PER_CALL`). Service này không chia lô hộ: chia lô kéo theo câu
   * hỏi "lô nào hỏng thì trạng thái đợt sale ra sao" — đó là quyết định nghiệp vụ.
   */
  async updateActivityProducts(
    ctx: TiktokShopContext,
    activityId: string,
    products: TiktokActivityProductInput[],
  ): Promise<TiktokSdkResult<TiktokUpdateActivityProductsResult>> {
    const result = await this.sdk.execute<TiktokUpdateActivityProductsResult>({
      endpoint: 'PROMOTION_ACTIVITY_PRODUCTS_UPDATE',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesActivityIdProductsPut(
          activityId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          { activityId, products },
        ),
    });
    return { data: result.data ?? {}, requestId: result.requestId };
  }

  /** Remove Activity Products — gỡ sản phẩm/SKU khỏi hoạt động đang chạy. */
  async removeActivityProducts(
    ctx: TiktokShopContext,
    activityId: string,
    target: { productIds?: string[]; skuIds?: string[] },
  ): Promise<TiktokSdkResult<{ activityId?: string }>> {
    const result = await this.sdk.execute<{ activityId?: string }>({
      endpoint: 'PROMOTION_ACTIVITY_PRODUCTS_REMOVE',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesActivityIdProductsDelete(
          activityId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          {
            ...(target.productIds?.length ? { productIds: target.productIds } : {}),
            ...(target.skuIds?.length ? { skuIds: target.skuIds } : {}),
          },
        ),
    });
    return { data: result.data ?? {}, requestId: result.requestId };
  }

  /** Get Activity — bản đầy đủ (trạng thái, khung giờ, danh sách sản phẩm đã nhận). */
  async getActivity(
    ctx: TiktokShopContext,
    activityId: string,
  ): Promise<TiktokSdkResult<TiktokActivityDetail>> {
    const result = await this.sdk.execute<TiktokActivityDetail>({
      endpoint: 'PROMOTION_ACTIVITY_GET',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesActivityIdGet(
          activityId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
        ),
    });
    return { data: result.data ?? {}, requestId: result.requestId };
  }

  /** Deactivate Activity — huỷ hoạt động trên sàn (không xoá, TikTok chuyển DEACTIVATED). */
  async deactivateActivity(
    ctx: TiktokShopContext,
    activityId: string,
  ): Promise<TiktokSdkResult<{ activityId?: string; status?: string }>> {
    const result = await this.sdk.execute<{ activityId?: string; status?: string }>({
      endpoint: 'PROMOTION_ACTIVITY_DEACTIVATE',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesActivityIdDeactivatePost(
          activityId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
        ),
    });
    return { data: result.data ?? {}, requestId: result.requestId };
  }

  /** Search Activities — MỘT trang. Phân trang bằng `page_token` do TikTok cấp. */
  async searchActivities(
    ctx: TiktokShopContext,
    params: {
      pageSize?: number;
      pageToken?: string;
      filter?: TiktokActivitySearchFilter;
    } = {},
  ): Promise<TiktokSdkResult<TiktokPage<TiktokActivitySummary>>> {
    const result = await this.sdk.execute<{
      activities?: TiktokActivitySummary[];
      nextPageToken?: string;
      totalCount?: number;
    }>({
      endpoint: 'PROMOTION_ACTIVITY_SEARCH',
      invoke: () =>
        this.sdk.api.PromotionV202309Api.ActivitiesSearchPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          {
            pageSize: params.pageSize ?? TIKTOK_ACTIVITY_SEARCH_PAGE_SIZE,
            // TikTok quy định trang đầu là chuỗi RỖNG, không phải bỏ trống tham số.
            pageToken: params.pageToken ?? '',
            ...(params.filter ?? {}),
          },
        ),
    });

    return {
      data: {
        items: result.data.activities ?? [],
        // TikTok trả `""` ở trang cuối — quy về `undefined` để nơi gọi chỉ phải kiểm một thứ.
        nextPageToken: result.data.nextPageToken || undefined,
        totalCount: result.data.totalCount,
      },
      requestId: result.requestId,
    };
  }

  /**
   * Search Activities — đi HẾT mọi trang.
   *
   * Cùng ba điều kiện dừng của `searchAllProducts`: hết `next_page_token`, trang rỗng, hoặc
   * chạm trần số trang. Chạm trần ⇒ ghi CẢNH BÁO, không im lặng cắt dữ liệu.
   */
  async searchAllActivities(
    ctx: TiktokShopContext,
    filter: TiktokActivitySearchFilter = {},
  ): Promise<TiktokActivitySummary[]> {
    const all: TiktokActivitySummary[] = [];
    let pageToken: string | undefined;

    for (let pageIndex = 0; pageIndex < TIKTOK_ACTIVITY_MAX_PAGES_PER_RUN; pageIndex++) {
      const { data } = await this.searchActivities(ctx, { pageToken, filter });
      if (data.items.length === 0) return all;

      all.push(...data.items);
      if (!data.nextPageToken) return all;
      pageToken = data.nextPageToken;
    }

    this.logger.warn({
      module: 'tiktok-sdk',
      operation: 'promotion.searchAll',
      organizationId: ctx.organizationId,
      shopId: ctx.shopId,
      maxPages: TIKTOK_ACTIVITY_MAX_PAGES_PER_RUN,
      collected: all.length,
      msg: 'Chạm trần số trang khi quét hoạt động khuyến mãi — dữ liệu có thể chưa đủ',
    });
    return all;
  }
}
