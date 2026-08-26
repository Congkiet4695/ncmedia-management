import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { callArg } from '../../testing/mock-call.util';
import { PodTiktokOAuthService } from './services/pod-tiktok-oauth.service';
import { TiktokCallbackController } from './tiktok-callback.controller';

const IP = '203.0.113.10';

const APP_KEY = 'app-key-123';

function build(redirectBase = '') {
  const config = {
    get: (key: string, fallback?: string) => {
      if (key === 'tiktok.appKey') return APP_KEY;
      return redirectBase || fallback;
    },
  } as unknown as ConfigService;

  const handleCallback = jest
    .fn()
    .mockResolvedValue({ success: true, resultToken: 'RESULT_TOKEN' });
  const getLinkResult = jest.fn();
  const oauth = { handleCallback, getLinkResult } as unknown as PodTiktokOAuthService;

  const redirect = jest.fn();
  const res = { redirect } as unknown as Response;

  return {
    controller: new TiktokCallbackController(config, oauth),
    res,
    redirect,
    handleCallback,
    getLinkResult,
  };
}

/** Request giả: controller chỉ đọc `query`. */
function request(url: string): Request {
  const queryString = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const query = Object.fromEntries(new URLSearchParams(queryString).entries());
  return { url, query } as unknown as Request;
}

interface CallbackParams {
  authorizationCode?: string;
  state?: string;
  error?: string;
}

describe('TiktokCallbackController', () => {
  describe('luồng tự động', () => {
    it('đọc `code` + `state` rồi giao cho service xử lý — không cần người dùng thao tác', async () => {
      const { controller, res, handleCallback } = build();

      await controller.callback(
        request('/api/v1/tiktok/callback?app_key=abc&code=THE_CODE&state=THE_STATE'),
        res,
        IP,
        'jest-agent',
      );

      const params = callArg<CallbackParams>(handleCallback, 0, 0);
      expect(params).toEqual({
        authorizationCode: 'THE_CODE',
        state: 'THE_STATE',
        error: undefined,
      });
    });

    it('chấp nhận bí danh `auth_code` khi TikTok dùng tên đó', async () => {
      const { controller, res, handleCallback } = build();

      await controller.callback(
        request('/api/v1/tiktok/callback?auth_code=THE_CODE&state=S'),
        res,
        IP,
      );

      expect(callArg<CallbackParams>(handleCallback, 0, 0).authorizationCode).toBe('THE_CODE');
    });

    it('thành công → chuyển tới trang success kèm ĐÚNG vé đọc kết quả', async () => {
      const { controller, res, redirect } = build();

      await controller.callback(request('/api/v1/tiktok/callback?code=C&state=S'), res, IP);

      expect(callArg<string>(redirect, 0, 0)).toBe('/tiktok/link-success?ref=RESULT_TOKEN');
    });

    it('thất bại → chuyển tới trang link-failed kèm vé để hiển thị nguyên nhân', async () => {
      const { controller, res, redirect, handleCallback } = build();
      handleCallback.mockResolvedValue({
        success: false,
        resultToken: 'RESULT_TOKEN',
        errorCode: 'POD_TIKTOK_INVALID_AUTH_CODE',
      });

      await controller.callback(request('/api/v1/tiktok/callback?code=C&state=S'), res, IP);

      expect(callArg<string>(redirect, 0, 0)).toBe('/tiktok/link-failed?ref=RESULT_TOKEN');
    });

    it('state hỏng (không có vé) → gửi thẳng mã lỗi để trang lỗi vẫn nói được nguyên nhân', async () => {
      const { controller, res, redirect, handleCallback } = build();
      handleCallback.mockResolvedValue({
        success: false,
        errorCode: 'POD_TIKTOK_INVALID_STATE',
      });

      await controller.callback(request('/api/v1/tiktok/callback?code=C'), res, IP);

      expect(callArg<string>(redirect, 0, 0)).toBe(
        '/tiktok/link-failed?error=POD_TIKTOK_INVALID_STATE',
      );
    });

    it('dùng base URL tuyệt đối khi frontend ở domain khác', async () => {
      const { controller, res, redirect } = build('https://app.example.com/');

      await controller.callback(request('/api/v1/tiktok/callback?code=C&state=S'), res, IP);

      // Dấu `/` thừa ở cuối base bị cắt để không sinh ra `//tiktok/...`.
      expect(callArg<string>(redirect, 0, 0)).toBe(
        'https://app.example.com/tiktok/link-success?ref=RESULT_TOKEN',
      );
    });

    it('bỏ qua tham số lặp lại (Express trả về mảng) thay vì gửi kiểu sai xuống service', async () => {
      const { controller, res, handleCallback } = build();
      const req = { url: '/x', query: { code: ['A', 'B'], state: 'S' } } as unknown as Request;

      await controller.callback(req, res, IP);

      expect(callArg<CallbackParams>(handleCallback, 0, 0).authorizationCode).toBeUndefined();
    });
  });

  describe('bảo mật', () => {
    it('🔴 KHÔNG ghi giá trị auth_code / state vào log', async () => {
      const { controller, res } = build();
      // Logger là thuộc tính của INSTANCE, không nằm trên prototype của controller ⇒ theo dõi
      // ở `Logger.prototype` để bắt được mọi lần ghi log dù instance nào phát ra.
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await controller.callback(
        request('/api/v1/tiktok/callback?app_key=abc&code=SUPER_SECRET_CODE&state=SECRET_STATE'),
        res,
        IP,
      );

      const serialized = JSON.stringify(logSpy.mock.calls);
      expect(serialized).not.toContain('SUPER_SECRET_CODE');
      expect(serialized).not.toContain('SECRET_STATE');
      // Vẫn phải biết tham số nào đã tới, để chẩn đoán khi TikTok đổi payload.
      expect(serialized).toContain('app_key');
      expect(serialized).toContain('code');

      logSpy.mockRestore();
    });

    it('🔴 URL chuyển hướng KHÔNG mang code/token — chỉ có vé đọc kết quả', async () => {
      const { controller, res, redirect } = build();

      await controller.callback(
        request('/api/v1/tiktok/callback?code=SUPER_SECRET_CODE&state=SECRET_STATE'),
        res,
        IP,
      );

      const target = callArg<string>(redirect, 0, 0);
      expect(target).not.toContain('SUPER_SECRET_CODE');
      expect(target).not.toContain('SECRET_STATE');
      expect(target).not.toContain('code=');
      expect(target).not.toContain('token=');
    });

    it('🔴 không đặt cookie và chỉ chuyển hướng đúng một lần', async () => {
      const { controller, res, redirect } = build();
      const cookie = jest.fn();
      (res as unknown as { cookie: jest.Mock }).cookie = cookie;

      await controller.callback(request('/api/v1/tiktok/callback?code=C&state=S'), res, IP);

      expect(cookie).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledTimes(1);
    });

    it('chuyển IP và User-Agent xuống service để ghi audit', async () => {
      const { controller, res, handleCallback } = build();

      await controller.callback(
        request('/api/v1/tiktok/callback?code=C&state=S'),
        res,
        IP,
        'jest-agent',
      );

      expect(callArg<Record<string, string>>(handleCallback, 0, 1)).toEqual({
        ipAddress: IP,
        userAgent: 'jest-agent',
      });
    });
  });

  describe('link-result', () => {
    it('trả tóm tắt theo vé `ref`', async () => {
      const { controller, getLinkResult } = build();
      getLinkResult.mockResolvedValue({ success: true });

      await controller.linkResult({ ref: 'RESULT_TOKEN' });

      expect(getLinkResult).toHaveBeenCalledWith('RESULT_TOKEN');
    });
  });

  /**
   * Đường chính: Redirect URI trỏ thẳng vào trang frontend, nên trang đó gửi `code` + `state`
   * xuống đây. Toàn bộ OAuth vẫn nằm ở backend.
   */
  describe('POST oauth/complete', () => {
    const BODY = {
      code: 'THE_CODE',
      state: 'THE_STATE',
      appKey: APP_KEY,
      locale: 'en-US',
      shopRegion: 'US',
    };

    it('chuyển `code` + `state` xuống service kèm IP/User-Agent để ghi audit', async () => {
      const { controller, handleCallback } = build();

      await controller.completeOAuth(BODY, IP, 'jest-agent');

      expect(callArg<CallbackParams>(handleCallback, 0, 0)).toEqual({
        authorizationCode: 'THE_CODE',
        state: 'THE_STATE',
      });
      expect(callArg<Record<string, string>>(handleCallback, 0, 1)).toEqual({
        ipAddress: IP,
        userAgent: 'jest-agent',
      });
    });

    it('thành công → trả tóm tắt để trang dựng màn hình (KHÔNG có token)', async () => {
      const { controller, handleCallback } = build();
      handleCallback.mockResolvedValue({
        success: true,
        resultToken: 'RESULT_TOKEN',
        accountName: 'NCMedia US Store',
        shopName: 'Maomao beauty shop',
        region: 'US',
        shopCount: 1,
        linkedAt: '2026-08-18T03:00:00.000Z',
      });

      const result = await controller.completeOAuth(BODY, IP);

      expect(result).toEqual({
        success: true,
        accountName: 'NCMedia US Store',
        shopName: 'Maomao beauty shop',
        region: 'US',
        shopCount: 1,
        linkedAt: '2026-08-18T03:00:00.000Z',
        errorCode: null,
        message: null,
      });
      // 🔴 Vé nội bộ không được rò ra ngoài response của đường chính.
      expect(JSON.stringify(result)).not.toContain('RESULT_TOKEN');
    });

    it('thất bại → vẫn HTTP 200 kèm mã lỗi + thông điệp thân thiện', async () => {
      const { controller, handleCallback } = build();
      handleCallback.mockResolvedValue({
        success: false,
        errorCode: 'POD_TIKTOK_INVALID_STATE',
        message: 'Phiên uỷ quyền không hợp lệ hoặc đã hết hạn.',
      });

      const result = await controller.completeOAuth(BODY, IP);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('POD_TIKTOK_INVALID_STATE');
      expect(result.message).toContain('hết hạn');
      expect(result.shopCount).toBe(0);
    });

    it('🔴 KHÔNG ghi `code`/`state` vào log; vẫn ghi locale/shop_region để chẩn đoán', async () => {
      const { controller } = build();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await controller.completeOAuth(
        { code: 'SUPER_SECRET_CODE', state: 'SECRET_STATE', locale: 'en-US', shopRegion: 'US' },
        IP,
      );

      const serialized = JSON.stringify(logSpy.mock.calls);
      expect(serialized).not.toContain('SUPER_SECRET_CODE');
      expect(serialized).not.toContain('SECRET_STATE');
      expect(serialized).toContain('en-US');

      logSpy.mockRestore();
    });

    it('app_key lệch cấu hình → chỉ cảnh báo, KHÔNG chặn luồng', async () => {
      const { controller, handleCallback } = build();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const result = await controller.completeOAuth({ ...BODY, appKey: 'app-key-KHAC' }, IP);

      expect(warnSpy).toHaveBeenCalled();
      expect(handleCallback).toHaveBeenCalled();
      expect(result.success).toBe(true);

      warnSpy.mockRestore();
    });
  });
});
