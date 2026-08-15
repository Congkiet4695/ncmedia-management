import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { callArg } from '../../testing/mock-call.util';
import { TiktokCallbackController } from './tiktok-callback.controller';

function build(redirectBase = '') {
  const config = {
    get: (_key: string, fallback?: string) => redirectBase || fallback,
  } as unknown as ConfigService;

  const redirect = jest.fn();
  const res = { redirect } as unknown as Response;

  return { controller: new TiktokCallbackController(config), res, redirect };
}

/** Request giả: chỉ hai thứ controller thực sự đọc là `url` và `query`. */
function request(url: string): Request {
  const queryString = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const query = Object.fromEntries(new URLSearchParams(queryString).entries());
  return { url, query } as unknown as Request;
}

describe('TiktokCallbackController', () => {
  describe('chuyển hướng', () => {
    it('chuyển sang trang hiển thị mã kèm NGUYÊN VĂN query string', () => {
      const { controller, res, redirect } = build();

      controller.callback(
        request('/api/v1/tiktok/callback?app_key=abc&auth_code=THE_CODE&state=xyz'),
        res,
      );

      expect(callArg<string>(redirect, 0, 0)).toBe(
        '/tiktok/link-success?app_key=abc&auth_code=THE_CODE&state=xyz',
      );
    });

    it('giữ nguyên tham số TikTok bổ sung sau này — không cần sửa code', () => {
      const { controller, res, redirect } = build();

      controller.callback(
        request('/api/v1/tiktok/callback?auth_code=X&shop_id=123&brand_new_param=hello'),
        res,
      );

      const target = callArg<string>(redirect, 0, 0);
      expect(target).toContain('shop_id=123');
      expect(target).toContain('brand_new_param=hello');
    });

    it('giữ nguyên giá trị đã mã hoá URL', () => {
      const { controller, res, redirect } = build();

      controller.callback(request('/api/v1/tiktok/callback?state=a%2Bb%20c&auth_code=X'), res);

      // Không tuần tự hoá lại ⇒ không có nguy cơ đổi %2B thành dấu cộng.
      expect(callArg<string>(redirect, 0, 0)).toContain('state=a%2Bb%20c');
    });

    it('không có query vẫn chuyển hướng hợp lệ (trang tự báo thiếu mã)', () => {
      const { controller, res, redirect } = build();

      controller.callback(request('/api/v1/tiktok/callback'), res);

      expect(callArg<string>(redirect, 0, 0)).toBe('/tiktok/link-success');
    });

    it('dùng base URL tuyệt đối khi frontend ở domain khác', () => {
      const { controller, res, redirect } = build('https://app.example.com/');

      controller.callback(request('/api/v1/tiktok/callback?auth_code=X'), res);

      // Dấu `/` thừa ở cuối base bị cắt để không sinh ra `//tiktok/...`.
      expect(callArg<string>(redirect, 0, 0)).toBe(
        'https://app.example.com/tiktok/link-success?auth_code=X',
      );
    });
  });

  describe('bảo mật', () => {
    it('🔴 KHÔNG ghi giá trị auth_code vào log', () => {
      const { controller, res } = build();
      // Logger là thuộc tính của INSTANCE, không nằm trên prototype của controller ⇒ theo dõi
      // ở `Logger.prototype` để bắt được mọi lần ghi log dù instance nào phát ra.
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      controller.callback(
        request('/api/v1/tiktok/callback?app_key=abc&auth_code=SUPER_SECRET_CODE'),
        res,
      );

      const serialized = JSON.stringify(logSpy.mock.calls);
      expect(serialized).not.toContain('SUPER_SECRET_CODE');
      // Vẫn phải biết tham số nào đã tới, để chẩn đoán khi TikTok đổi payload.
      expect(serialized).toContain('app_key');
      expect(serialized).toContain('auth_code=<redacted>');

      logSpy.mockRestore();
    });

    it('🔴 không đặt cookie và không ghi gì ngoài việc chuyển hướng', () => {
      const { controller, res, redirect } = build();
      const cookie = jest.fn();
      (res as unknown as { cookie: jest.Mock }).cookie = cookie;

      controller.callback(request('/api/v1/tiktok/callback?auth_code=X'), res);

      expect(cookie).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledTimes(1);
    });
  });
});
