import { Injectable } from '@nestjs/common';
import { TIKTOK_SEARCH_ORDERS_PATH } from '../constants/tiktok.constants';
import { TiktokApiClient } from './tiktok-api.client';
import {
  TiktokSearchOrdersBody,
  TiktokSearchOrdersData,
  TiktokSearchOrdersQuery,
} from '../types/tiktok-order.types';

/** Tham số một lần gọi Get Order List. */
export interface SearchOrdersParams {
  /** shop_cipher (plaintext) — bắt buộc với endpoint entity tag `Shop`. */
  shopCipher: string;
  accessToken: string;
  query: TiktokSearchOrdersQuery;
  body: TiktokSearchOrdersBody;
}

/** Một trang kết quả. */
export interface SearchOrdersPage {
  orders: TiktokSearchOrdersData['orders'];
  nextPageToken?: string;
  totalCount?: number;
  requestId?: string;
}

/**
 * TiktokOrderClient — nhóm Order API.
 *
 * Sprint 2 chỉ dùng **Get Order List** (`POST /order/202309/orders/search`).
 * Response của endpoint này đã chứa đầy đủ `payment`, `recipient_address`,
 * `line_items[]` (kể cả cờ POD) và `packages[]` ⇒ **không cần** gọi Get Order Detail,
 * tiết kiệm đáng kể quota (tài liệu Rate limits khuyến nghị "Fetch only what you need").
 */
@Injectable()
export class TiktokOrderClient {
  constructor(private readonly api: TiktokApiClient) {}

  /**
   * Gọi một trang Get Order List.
   *
   * Lưu ý ký request: body phải được serialize MỘT LẦN và dùng đúng chuỗi đó cho cả
   * việc ký lẫn việc gửi — `TiktokApiClient.callSigned` đảm bảo điều này.
   */
  async searchOrders(params: SearchOrdersParams): Promise<SearchOrdersPage> {
    const bodyJson = JSON.stringify(params.body);

    const result = await this.api.callSigned<TiktokSearchOrdersData>({
      path: TIKTOK_SEARCH_ORDERS_PATH,
      method: 'POST',
      query: {
        shop_cipher: params.shopCipher,
        page_size: params.query.page_size,
        page_token: params.query.page_token,
        sort_field: params.query.sort_field,
        sort_order: params.query.sort_order,
      },
      bodyJson,
      accessToken: params.accessToken,
      endpointLabel: 'GET_ORDER_LIST',
    });

    return {
      orders: result.data?.orders ?? [],
      // Chuỗi rỗng cũng nghĩa là hết trang → chuẩn hoá về undefined.
      nextPageToken: result.data?.next_page_token || undefined,
      totalCount: result.data?.total_count,
      requestId: result.requestId,
    };
  }
}
