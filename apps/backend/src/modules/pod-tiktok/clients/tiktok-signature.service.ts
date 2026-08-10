import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { TIKTOK_SIGN_EXCLUDED_QUERY_KEYS } from '../constants/tiktok.constants';

/** Tham số để tính chữ ký một request TikTok. */
export interface TiktokSignInput {
  /** Path đầy đủ sau host, gồm cả category/version/resource. VD `/authorization/202309/shops`. */
  path: string;
  /** Query params (KHÔNG gồm `sign`). Giá trị undefined sẽ bị bỏ qua. */
  query: Record<string, string | number | undefined>;
  /**
   * Body ĐÃ serialize — phải là ĐÚNG chuỗi sẽ gửi đi.
   * Tài liệu: "Use the exact body bytes that are sent in the HTTP request. Do not parse and
   * re-serialize or reformat the body for signing."
   */
  bodyJson?: string;
  /** Content-Type của request; `multipart/form-data` thì KHÔNG nối body vào chuỗi ký. */
  contentType?: string;
}

/**
 * TiktokSignatureService — sinh chữ ký HMAC-SHA256 cho TikTok Shop Open API.
 *
 * Thuật toán chính thức ("Sign your API request" — doc 678e3a3d4ddec3030b238faf):
 *   1. Lấy toàn bộ query params, LOẠI BỎ `sign` và `access_token`.
 *   2. Sắp xếp key theo thứ tự alphabet.
 *   3. Nối chuỗi theo định dạng `{key}{value}`.
 *   4. Prefix bằng request path (đã gồm category/version/resource).
 *   5. Nếu content-type KHÁC `multipart/form-data` → nối thêm raw body.
 *   6. Bọc hai đầu bằng app_secret: `app_secret + input + app_secret`.
 *   7. sign = hex(HMAC-SHA256(chuỗi bước 6, key = app_secret)).
 *
 * Service này KHÔNG phụ thuộc HTTP client hay module nghiệp vụ ⇒ mọi Sprint sau
 * (Sync Orders, Products, Fulfillment, Webhook) tái sử dụng trực tiếp.
 */
@Injectable()
export class TiktokSignatureService {
  private static readonly MULTIPART_CONTENT_TYPE = 'multipart/form-data';

  /**
   * Sinh chữ ký. `appSecret` được truyền vào (không đọc config ở đây) để service
   * thuần tuý, dễ test và dùng lại được cho nhiều app/môi trường.
   */
  sign(appSecret: string, input: TiktokSignInput): string {
    return createHmac('sha256', appSecret)
      .update(`${appSecret}${this.buildBaseString(input)}${appSecret}`, 'utf8')
      .digest('hex');
  }

  /**
   * Chuỗi gốc trước khi bọc app_secret (bước 1→5). Tách riêng để unit test
   * từng bước và để debug khi TikTok trả `106001 Invalid sign`.
   */
  buildBaseString({ path, query, bodyJson, contentType }: TiktokSignInput): string {
    const excluded = new Set<string>(TIKTOK_SIGN_EXCLUDED_QUERY_KEYS);

    // Bước 1+2: loại `sign`/`access_token`, bỏ undefined, sắp xếp alphabet.
    const concatenated = Object.keys(query)
      .filter((key) => !excluded.has(key) && query[key] !== undefined)
      .sort()
      // Bước 3: nối `{key}{value}`.
      .reduce((acc, key) => `${acc}${key}${String(query[key])}`, '');

    // Bước 4: prefix bằng path.
    let base = `${path}${concatenated}`;

    // Bước 5: nối raw body nếu content-type khác multipart/form-data.
    const isMultipart =
      contentType?.toLowerCase().includes(TiktokSignatureService.MULTIPART_CONTENT_TYPE) ?? false;
    if (!isMultipart && bodyJson) {
      base += bodyJson;
    }

    return base;
  }

  /**
   * Timestamp Unix 10 chữ số (giây) cho tham số `timestamp`.
   * Tài liệu: "Do not send a millisecond-level timestamp.
   * Valid range: [current time - 5 mins, current time + 30 secs]".
   */
  currentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }
}
