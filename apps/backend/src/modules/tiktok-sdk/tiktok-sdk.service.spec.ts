/**
 * 🔴 Chặn nạp SDK thật: barrel của SDK kéo theo ~3.4k module (≈1,5s mỗi lần) mà test ở đây
 * chỉ kiểm phần LOGIC của wrapper (bóc envelope, phân lớp lỗi, retry) — không cần SDK thật.
 * Phải đặt TRƯỚC các import khác vì `jest.mock` được hoisted.
 */
jest.mock('@tiktok-shop/nodejs-sdk', () => ({
  ClientConfiguration: class {
    static globalConfig: Record<string, unknown> = {};
  },
  TikTokShopNodeApiClient: class {
    api = {};
  },
}));

import { ConfigService } from '@nestjs/config';
import { TiktokErrorClass } from '../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TikTokSdkService } from './tiktok-sdk.service';

const CONFIG_VALUES: Record<string, string> = {
  'tiktok.appKey': 'app-key',
  'tiktok.appSecret': 'app-secret',
  'tiktok.apiBaseUrl': 'https://open-api.tiktokglobalshop.com',
};

function buildService(): TikTokSdkService {
  const config = {
    get: jest.fn((key: string) => CONFIG_VALUES[key]),
    getOrThrow: jest.fn((key: string) => CONFIG_VALUES[key]),
  } as unknown as ConfigService;

  const service = new TikTokSdkService(config);
  // Không log ra output test.
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return service;
}

describe('TikTokSdkService', () => {
  beforeEach(() => {
    // Backoff thật khiến test chờ hàng giây — rút về 0 nhưng vẫn chạy đúng số lần thử.
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('execute — bóc envelope', () => {
    it('code = 0 → trả `data` kèm `request_id`', async () => {
      const service = buildService();

      const result = await service.execute<{ products: string[] }>({
        endpoint: 'TEST',
        invoke: () =>
          Promise.resolve({
            body: { code: 0, message: 'Success', requestId: 'req-1', data: { products: ['a'] } },
          }),
      });

      expect(result).toEqual({ data: { products: ['a'] }, requestId: 'req-1' });
    });

    it('thiếu `data` → trả object rỗng thay vì undefined (tầng trên không phải kiểm null)', async () => {
      const service = buildService();

      const result = await service.execute({
        endpoint: 'TEST',
        invoke: () => Promise.resolve({ body: { code: 0, requestId: 'req-2' } }),
      });

      expect(result.data).toEqual({});
    });
  });

  describe('execute — lỗi nghiệp vụ', () => {
    it('code ≠ 0 → ném TiktokClientError mang code/message/request_id', async () => {
      const service = buildService();

      const call = service.execute({
        endpoint: 'TEST',
        invoke: () =>
          Promise.resolve({
            body: { code: 105002, message: 'Expired credentials', requestId: 'req-err' },
          }),
      });

      await expect(call).rejects.toBeInstanceOf(TiktokClientError);
      await expect(call).rejects.toMatchObject({
        tiktokCode: 105002,
        requestId: 'req-err',
        endpoint: 'TEST',
      });
    });

    it('🔴 lỗi KHÔNG thuộc nhóm tạm thời → KHÔNG retry (auth code sai mà thử lại là vô nghĩa)', async () => {
      const service = buildService();
      const invoke = jest
        .fn()
        .mockResolvedValue({ body: { code: 105002, message: 'Expired credentials' } });

      await expect(service.execute({ endpoint: 'TEST', invoke })).rejects.toBeInstanceOf(
        TiktokClientError,
      );
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('rate limit (36009002) → retry rồi thành công', async () => {
      const service = buildService();
      const invoke = jest
        .fn()
        .mockResolvedValueOnce({ body: { code: 36009002, message: 'Too many requests' } })
        .mockResolvedValueOnce({ body: { code: 0, data: { ok: true } } });

      const result = await service.execute<{ ok: boolean }>({ endpoint: 'TEST', invoke });

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ ok: true });
    });

    it('lỗi mạng (SDK ném Error thường) → phân lớp NETWORK và có retry', async () => {
      const service = buildService();
      const invoke = jest
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce({ body: { code: 0, data: { ok: true } } });

      const result = await service.execute<{ ok: boolean }>({ endpoint: 'TEST', invoke });

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ ok: true });
    });

    it('🔴 `retry: false` → KHÔNG tự gửi lại dù lỗi mạng (Create Product mang `idempotency_key`)', async () => {
      const service = buildService();
      const invoke = jest
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce({ body: { code: 0, data: { ok: true } } });

      // Gửi lại y hệt = gửi lại cùng `idempotency_key` ⇒ TikTok trả `12052996 requires a
      // unique external_id`. Quyền gửi lại thuộc về nơi đối soát được, không phải tầng này.
      await expect(
        service.execute<{ ok: boolean }>({ endpoint: 'PRODUCT_CREATE', retry: false, invoke }),
      ).rejects.toBeInstanceOf(TiktokClientError);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('HTTP 500 kèm envelope → giữ nguyên code nghiệp vụ để chẩn đoán', async () => {
      const service = buildService();
      const invoke = jest.fn().mockRejectedValue({
        statusCode: 500,
        body: { code: 36009003, message: 'Internal error', requestId: 'req-500' },
      });

      const call = service.execute({ endpoint: 'TEST', invoke });

      await expect(call).rejects.toMatchObject({
        tiktokCode: 36009003,
        httpStatus: 500,
        requestId: 'req-500',
        errorClass: TiktokErrorClass.SERVER,
      });
      // Nhóm SERVER là lỗi tạm thời ⇒ phải thử lại đủ số lần trước khi bỏ cuộc.
      expect(invoke).toHaveBeenCalledTimes(4);
    });
  });

  describe('execute — giới hạn thời gian (timeoutMs)', () => {
    it('TikTok không phản hồi ⇒ lỗi NETWORK có thông điệp rõ, thử lại đúng `maxRetries`', async () => {
      const service = buildService();
      // Không bao giờ trả lời — chỉ có bộ hẹn giờ kết thúc được lời gọi.
      const invoke = jest.fn(() => new Promise<never>(() => undefined));

      const call = service.execute({ endpoint: 'ORDER_DETAIL', invoke, timeoutMs: 20_000, maxRetries: 2 });

      await expect(call).rejects.toMatchObject({
        errorClass: TiktokErrorClass.NETWORK,
        httpStatus: 0,
        endpoint: 'ORDER_DETAIL',
      });
      await expect(call).rejects.toThrow(/20 giây/);
      expect(invoke).toHaveBeenCalledTimes(3);
    });

    it('🔴 lệnh GHI (`retry: false`) hết giờ ⇒ KHÔNG gửi lại (tránh tạo gói trùng)', async () => {
      const service = buildService();
      const invoke = jest.fn(() => new Promise<never>(() => undefined));

      await expect(
        service.execute({ endpoint: 'FULFILLMENT_CREATE_PACKAGE', invoke, retry: false, timeoutMs: 20_000 }),
      ).rejects.toMatchObject({ errorClass: TiktokErrorClass.NETWORK });
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('5xx tạm thời ⇒ thử lại có kiểm soát rồi thành công', async () => {
      const service = buildService();
      const invoke = jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 503, body: { code: 36009003, message: 'busy' } })
        .mockResolvedValueOnce({ body: { code: 0, requestId: 'req-ok', data: { ok: true } } });

      const result = await service.execute({ endpoint: 'TEST', invoke, timeoutMs: 20_000, maxRetries: 2 });

      expect(result.data).toEqual({ ok: true });
      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('lỗi 4xx/nghiệp vụ ⇒ KHÔNG thử lại', async () => {
      const service = buildService();
      const invoke = jest.fn().mockResolvedValue({ body: { code: 21011001, message: 'invalid order' } });

      await expect(
        service.execute({ endpoint: 'TEST', invoke, timeoutMs: 20_000, maxRetries: 2 }),
      ).rejects.toBeInstanceOf(TiktokClientError);
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('vòng đời client', () => {
    it('gọi API trước khi module init → báo lỗi rõ ràng thay vì undefined', () => {
      const service = buildService();
      expect(() => service.api).toThrow(/chưa khởi tạo/);
    });
  });
});
