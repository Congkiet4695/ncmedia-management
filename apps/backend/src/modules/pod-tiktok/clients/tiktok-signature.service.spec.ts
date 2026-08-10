import { TiktokSignatureService } from './tiktok-signature.service';

/**
 * Test đối chiếu TRỰC TIẾP với ví dụ trong tài liệu chính thức
 * "Sign your API request" (partner.tiktokshop.com/docv2/page/678e3a3d4ddec3030b238faf).
 *
 * Đây là bài test quan trọng nhất của module: sai chữ ký ⇒ TikTok trả `106001` và
 * toàn bộ business API không dùng được.
 */
describe('TiktokSignatureService', () => {
  let service: TiktokSignatureService;

  // Giá trị lấy nguyên văn từ tài liệu chính thức.
  const OFFICIAL_APP_SECRET = 'e59af819cc';
  const OFFICIAL_PATH = '/authorization/202309/shops';
  const OFFICIAL_QUERY = { app_key: '29a39d', timestamp: 1623812664 };
  const OFFICIAL_BASE_STRING = '/authorization/202309/shopsapp_key29a39dtimestamp1623812664';
  const OFFICIAL_SIGN = 'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8';

  beforeEach(() => {
    service = new TiktokSignatureService();
  });

  describe('buildBaseString', () => {
    it('khớp chuỗi mẫu trong tài liệu chính thức', () => {
      expect(service.buildBaseString({ path: OFFICIAL_PATH, query: OFFICIAL_QUERY })).toBe(
        OFFICIAL_BASE_STRING,
      );
    });

    it('sắp xếp key theo alphabet, không phụ thuộc thứ tự truyền vào', () => {
      const reversed = service.buildBaseString({
        path: OFFICIAL_PATH,
        query: { timestamp: 1623812664, app_key: '29a39d' },
      });
      expect(reversed).toBe(OFFICIAL_BASE_STRING);
    });

    it('LOẠI BỎ `sign` và `access_token` khỏi chuỗi ký', () => {
      const withExcluded = service.buildBaseString({
        path: OFFICIAL_PATH,
        query: {
          app_key: '29a39d',
          timestamp: 1623812664,
          sign: 'should-be-ignored',
          access_token: 'should-be-ignored',
        },
      });
      expect(withExcluded).toBe(OFFICIAL_BASE_STRING);
    });

    it('bỏ qua tham số undefined', () => {
      const withUndefined = service.buildBaseString({
        path: OFFICIAL_PATH,
        query: { app_key: '29a39d', timestamp: 1623812664, shop_cipher: undefined },
      });
      expect(withUndefined).toBe(OFFICIAL_BASE_STRING);
    });

    it('gồm cả shop_cipher khi endpoint yêu cầu (ví dụ Update Shop Webhook trong tài liệu)', () => {
      // Ví dụ chính thức:
      // /event/202309/webhooksapp_key68xu9ks5p4i8shop_cipherROW_xkMbgAAAeVAQra0eZWebFQq5aIKtimestamp1696909648{...}
      const body = '{"address":"https://partner.tiktokshop.com","event_type":"PACKAGE_UPDATE"}';
      const base = service.buildBaseString({
        path: '/event/202309/webhooks',
        query: {
          app_key: '68xu9ks5p4i8',
          shop_cipher: 'ROW_xkMbgAAAeVAQra0eZWebFQq5aIK',
          timestamp: 1696909648,
        },
        bodyJson: body,
      });
      expect(base).toBe(
        '/event/202309/webhooksapp_key68xu9ks5p4i8shop_cipherROW_xkMbgAAAeVAQra0eZWebFQq5aIKtimestamp1696909648' +
          body,
      );
    });

    it('KHÔNG nối body khi content-type là multipart/form-data', () => {
      const base = service.buildBaseString({
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
        bodyJson: '{"ignored":true}',
        contentType: 'multipart/form-data; boundary=----abc',
      });
      expect(base).toBe(OFFICIAL_BASE_STRING);
    });
  });

  describe('sign', () => {
    it('sinh đúng chữ ký mẫu của tài liệu chính thức', () => {
      const sign = service.sign(OFFICIAL_APP_SECRET, {
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
      });
      expect(sign).toBe(OFFICIAL_SIGN);
    });

    it('chữ ký là chuỗi hex 64 ký tự (HMAC-SHA256)', () => {
      const sign = service.sign(OFFICIAL_APP_SECRET, {
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
      });
      expect(sign).toMatch(/^[0-9a-f]{64}$/);
    });

    it('đổi app_secret thì chữ ký đổi', () => {
      const other = service.sign('another-secret', {
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
      });
      expect(other).not.toBe(OFFICIAL_SIGN);
    });

    it('đổi body thì chữ ký đổi (body tham gia ký)', () => {
      const a = service.sign(OFFICIAL_APP_SECRET, {
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
        bodyJson: '{"a":1}',
      });
      const b = service.sign(OFFICIAL_APP_SECRET, {
        path: OFFICIAL_PATH,
        query: OFFICIAL_QUERY,
        bodyJson: '{"a":2}',
      });
      expect(a).not.toBe(b);
    });
  });

  describe('currentTimestamp', () => {
    it('trả về Unix timestamp 10 chữ số (giây, không phải mili-giây)', () => {
      const ts = service.currentTimestamp();
      expect(Number.isInteger(ts)).toBe(true);
      expect(String(ts)).toHaveLength(10);
      expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1);
    });
  });
});
