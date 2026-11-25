import { Injectable } from '@nestjs/common';
import {
  TIKTOK_GET_ORDER_DETAIL_PATH,
  TIKTOK_ORDER_DETAIL_MAX_IDS,
  TIKTOK_SEARCH_ORDERS_PATH,
} from '../constants/tiktok.constants';
import { TiktokApiClient } from './tiktok-api.client';
import {
  TiktokOrder,
  TiktokOrderDetailData,
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

  /**
   * Get Order Detail — lấy lại ĐÚNG các đơn được chỉ định (`GET /order/202309/orders?ids=…`).
   *
   * 🔴 Tối đa {@link TIKTOK_ORDER_DETAIL_MAX_IDS} ID mỗi lời gọi — người gọi tự chia lô; vượt trần
   * thì ném lỗi ngay thay vì để TikTok trả lỗi tham số sau khi đã tốn quota.
   * Đơn không còn tồn tại / không thuộc shop này thì đơn giản là VẮNG trong `orders[]`.
   */
  async getOrderDetails(params: GetOrderDetailsParams): Promise<GetOrderDetailsResult> {
    if (params.ids.length === 0) return { orders: [] };
    if (params.ids.length > TIKTOK_ORDER_DETAIL_MAX_IDS) {
      throw new Error(
        `Get Order Detail nhận tối đa ${TIKTOK_ORDER_DETAIL_MAX_IDS} ID mỗi lần (nhận ${params.ids.length}).`,
      );
    }

    const result = await this.api.callSigned<TiktokOrderDetailData>({
      path: TIKTOK_GET_ORDER_DETAIL_PATH,
      method: 'GET',
      query: { shop_cipher: params.shopCipher, ids: params.ids.join(',') },
      accessToken: params.accessToken,
      endpointLabel: 'GET_ORDER_DETAIL',
    });

    return { orders: result.data?.orders ?? [], requestId: result.requestId };
  }
}

/** Tham số một lần gọi Get Order Detail. */
export interface GetOrderDetailsParams {
  /** shop_cipher (plaintext). */
  shopCipher: string;
  accessToken: string;
  /** TikTok order ID — tối đa {@link TIKTOK_ORDER_DETAIL_MAX_IDS}. */
  ids: string[];
}

export interface GetOrderDetailsResult {
  orders: TiktokOrder[];
  requestId?: string;
}
