import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TIKTOK_GRANT_TYPE_AUTHORIZED_CODE,
  TIKTOK_GRANT_TYPE_REFRESH_TOKEN,
  TIKTOK_TOKEN_GET_PATH,
  TIKTOK_TOKEN_REFRESH_PATH,
} from '../constants/tiktok.constants';
import { TiktokHttpService } from './tiktok-http.service';
import { TiktokTokenData } from '../types/tiktok-api.types';

/**
 * TiktokAuthClient — nhóm API uỷ quyền trên host `auth.tiktok-shops.com`.
 *
 * Đặc điểm (khác với business API):
 *  - KHÔNG cần chữ ký `sign`, KHÔNG cần `timestamp`.
 *  - `app_secret` đi thẳng trên query string ⇒ chỉ được gọi từ server-side.
 *
 * Nguồn: Authorization overview (doc 678e3a3292b0f40314a92d75),
 *        Connecting shops (doc 67da496835f1b904aea9f063).
 */
@Injectable()
export class TiktokAuthClient {
  constructor(
    private readonly config: ConfigService,
    private readonly http: TiktokHttpService,
  ) {}

  /**
   * Get Access Token — đổi `auth_code` lấy access/refresh token.
   * `GET {authBaseUrl}/api/v2/token/get?app_key&app_secret&auth_code&grant_type=authorized_code`
   *
   * ⚠️ `auth_code` chỉ dùng được MỘT LẦN và hết hạn sau 30 phút.
   */
  async getAccessToken(authCode: string): Promise<{ data: TiktokTokenData; requestId?: string }> {
    return this.http.request<TiktokTokenData>({
      url: this.buildUrl(TIKTOK_TOKEN_GET_PATH, {
        app_key: this.appKey,
        app_secret: this.appSecret,
        auth_code: authCode,
        grant_type: TIKTOK_GRANT_TYPE_AUTHORIZED_CODE,
      }),
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      endpoint: 'TOKEN_GET',
    });
  }

  /**
   * Get Refresh Token — lấy access token mới từ refresh token.
   * Response có SHAPE GIỐNG Get Access Token và trả về **refresh_token MỚI** (rotation).
   *
   * Khai báo sẵn ở Sprint 1 để Sprint "Token Lifecycle" dùng ngay; chưa được gọi ở Sprint này.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ data: TiktokTokenData; requestId?: string }> {
    return this.http.request<TiktokTokenData>({
      url: this.buildUrl(TIKTOK_TOKEN_REFRESH_PATH, {
        app_key: this.appKey,
        app_secret: this.appSecret,
        refresh_token: refreshToken,
        grant_type: TIKTOK_GRANT_TYPE_REFRESH_TOKEN,
      }),
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      endpoint: 'TOKEN_REFRESH',
    });
  }

  private get appKey(): string {
    return this.config.getOrThrow<string>('tiktok.appKey');
  }

  private get appSecret(): string {
    return this.config.getOrThrow<string>('tiktok.appSecret');
  }

  private buildUrl(path: string, query: Record<string, string>): string {
    const base = this.config.getOrThrow<string>('tiktok.authBaseUrl');
    const url = new URL(path, base);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }
}
