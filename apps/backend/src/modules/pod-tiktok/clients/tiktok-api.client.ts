import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TIKTOK_ACCESS_TOKEN_HEADER,
  TIKTOK_GET_AUTHORIZED_SHOPS_PATH,
} from '../constants/tiktok.constants';
import { TiktokHttpService } from './tiktok-http.service';
import { TiktokSignatureService } from './tiktok-signature.service';
import {
  TiktokAuthorizedShopsData,
  TiktokShopItem,
  TiktokSignedRequestOptions,
} from '../types/tiktok-api.types';

/**
 * TiktokApiClient — nhóm business API trên host `open-api.tiktokglobalshop.com`.
 *
 * Mọi request đều được ký HMAC-SHA256 và mang access token ở header
 * `x-tts-access-token` (API version 202309 trở lên).
 *
 * Phương thức `callSigned` là hạ tầng dùng chung cho các Sprint sau
 * (Get Order List, Get Order Detail, Get Pod Detail, Ship Package...).
 */
@Injectable()
export class TiktokApiClient {
  private static readonly JSON_CONTENT_TYPE = 'application/json';

  constructor(
    private readonly config: ConfigService,
    private readonly http: TiktokHttpService,
    private readonly signature: TiktokSignatureService,
  ) {}

  /**
   * Get Authorized Shops — `GET /authorization/202309/shops` (entity tag `Seller`).
   * Trả về danh sách shop mà seller đã uỷ quyền cho app, kèm `cipher` (shop_cipher).
   *
   * ⚠️ Một access token có thể ứng với NHIỀU shop (seller CROSS_BORDER) —
   * luôn xử lý theo mảng, không giả định chỉ có một shop.
   */
  async getAuthorizedShops(
    accessToken: string,
  ): Promise<{ shops: TiktokShopItem[]; requestId?: string }> {
    const result = await this.callSigned<TiktokAuthorizedShopsData>({
      path: TIKTOK_GET_AUTHORIZED_SHOPS_PATH,
      method: 'GET',
      accessToken,
    });
    return { shops: result.data?.shops ?? [], requestId: result.requestId };
  }

  /**
   * Gọi một business API đã ký đầy đủ.
   *
   * Thứ tự bắt buộc (theo tài liệu "Sign your API request"):
   *  1. Dựng query gồm `app_key` + `timestamp` + query nghiệp vụ (vd `shop_cipher`).
   *  2. Ký trên query đó + path + **đúng chuỗi body sẽ gửi**.
   *  3. Gắn `sign` vào query rồi mới gửi.
   *
   * `bodyJson` được serialize MỘT LẦN ở caller và dùng chung cho cả ký lẫn gửi —
   * tài liệu cảnh báo re-serialize sẽ làm sai chữ ký.
   */
  async callSigned<T>(
    options: TiktokSignedRequestOptions & { endpointLabel?: string },
  ): Promise<{ data: T; requestId?: string }> {
    const { path, method, query = {}, bodyJson, accessToken } = options;

    const signedQuery: Record<string, string | number | undefined> = {
      ...query,
      app_key: this.config.getOrThrow<string>('tiktok.appKey'),
      timestamp: this.signature.currentTimestamp(),
    };

    const sign = this.signature.sign(this.config.getOrThrow<string>('tiktok.appSecret'), {
      path,
      query: signedQuery,
      bodyJson,
      contentType: TiktokApiClient.JSON_CONTENT_TYPE,
    });

    const url = new URL(path, this.config.getOrThrow<string>('tiktok.apiBaseUrl'));
    Object.entries(signedQuery).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });
    url.searchParams.set('sign', sign);

    const headers: Record<string, string> = { 'content-type': TiktokApiClient.JSON_CONTENT_TYPE };
    if (accessToken) headers[TIKTOK_ACCESS_TOKEN_HEADER] = accessToken;

    return this.http.request<T>({
      url: url.toString(),
      method,
      headers,
      bodyJson,
      endpoint: options.endpointLabel ?? `${method} ${path}`,
    });
  }
}
