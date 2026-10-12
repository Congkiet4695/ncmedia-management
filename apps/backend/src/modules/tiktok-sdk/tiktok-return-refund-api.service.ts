import { Injectable } from '@nestjs/common';
import {
  TIKTOK_RETURN_REASON_LOCALE,
  TIKTOK_RETURN_REFUND_MAX_RETRY,
  TIKTOK_RETURN_REFUND_TIMEOUT_MS,
  TIKTOK_RETURN_SEARCH_PAGE_SIZE,
  TIKTOK_SDK_CONTENT_TYPE,
} from './tiktok-sdk.constants';
import { TikTokSdkService } from './tiktok-sdk.service';
import type {
  TiktokReturnOrder,
  TiktokReturnRecord,
  TiktokReturnSearchFilter,
} from './types/tiktok-return-refund.types';
import type { TiktokPage, TiktokSdkResult, TiktokShopContext } from './types/tiktok-shop-context.type';

/** Lời gọi ĐỌC: có giới hạn thời gian, thử lại có kiểm soát (mạng / 5xx / rate limit). */
const READ_CALL = {
  timeoutMs: TIKTOK_RETURN_REFUND_TIMEOUT_MS,
  maxRetries: TIKTOK_RETURN_REFUND_MAX_RETRY,
} as const;

/**
 * TiktokReturnRefundApiService — lớp bọc nhóm API **Return & Refund** (scope
 * `seller.return_refund.basic`). Chỉ ĐỌC — hệ thống không duyệt / từ chối yêu cầu thay seller.
 *
 * ```
 *   POST /return_refund/202602/returns/search               ──▶ searchReturns (một trang, page_token)
 *   GET  /return_refund/202309/returns/{return_id}/records  ──▶ getReturnRecords (lịch sử của MỘT yêu cầu)
 * ```
 *
 * 🔴 Scope chưa được cấp ⇒ TikTok trả 105005 ⇒ `TiktokClientError` lớp `AUTH` (không thử lại). Nơi gọi
 * phải báo lỗi rõ ràng — KHÔNG được nuốt lỗi thành danh sách rỗng.
 */
@Injectable()
export class TiktokReturnRefundApiService {
  constructor(private readonly sdk: TikTokSdkService) {}

  /** Search Returns — MỘT trang, sắp xếp `update_time` tăng dần (đồng bộ tăng dần theo watermark). */
  async searchReturns(
    ctx: TiktokShopContext,
    params: { pageToken?: string; pageSize?: number; filter?: TiktokReturnSearchFilter } = {},
  ): Promise<TiktokSdkResult<TiktokPage<TiktokReturnOrder>>> {
    const result = await this.sdk.execute<{
      returnOrders?: TiktokReturnOrder[];
      nextPageToken?: string;
      totalCount?: number;
    }>({
      endpoint: 'RETURN_REFUND_SEARCH_RETURNS',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.ReturnRefundV202602Api.ReturnsSearchPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          'update_time',
          'ASC',
          // Tham số `page_size` của nhóm này là chuỗi trong SDK.
          String(params.pageSize ?? TIKTOK_RETURN_SEARCH_PAGE_SIZE),
          params.pageToken || undefined,
          ctx.shopCipher,
          { locale: TIKTOK_RETURN_REASON_LOCALE, ...(params.filter ?? {}) },
        ),
    });

    return {
      data: {
        items: result.data?.returnOrders ?? [],
        // TikTok trả `""` ở trang cuối — quy về `undefined`.
        nextPageToken: result.data?.nextPageToken || undefined,
        totalCount: result.data?.totalCount,
      },
      requestId: result.requestId,
    };
  }

  /** Get Return Records — lịch sử xử lý của MỘT yêu cầu, đúng như TikTok trả (không dựng thêm). */
  async getReturnRecords(
    ctx: TiktokShopContext,
    returnId: string,
  ): Promise<TiktokSdkResult<TiktokReturnRecord[]>> {
    const result = await this.sdk.execute<{ records?: TiktokReturnRecord[] }>({
      endpoint: 'RETURN_REFUND_GET_RECORDS',
      ...READ_CALL,
      invoke: () =>
        this.sdk.api.ReturnRefundV202309Api.ReturnsReturnIdRecordsGet(
          returnId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          TIKTOK_RETURN_REASON_LOCALE,
          ctx.shopCipher,
        ),
    });
    return { data: result.data?.records ?? [], requestId: result.requestId };
  }
}
