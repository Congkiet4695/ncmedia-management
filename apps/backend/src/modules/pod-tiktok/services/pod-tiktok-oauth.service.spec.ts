import { ConfigService } from '@nestjs/config';
import { PodTiktokOAuthStateStatus } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import {
  PodTiktokInvalidAuthCodeException,
  PodTiktokLinkResultNotFoundException,
  PodTiktokShopAlreadyLinkedException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodTiktokOAuthStateRepository } from '../repositories/pod-tiktok-oauth-state.repository';
import { PodTiktokAccountService } from './pod-tiktok-account.service';
import { PodTiktokOAuthService } from './pod-tiktok-oauth.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444';
const STATE_ROW_ID = '55555555-5555-5555-5555-555555555555';
const ACCOUNT_NAME = 'NCMedia US Store';

const CONFIG_VALUES: Record<string, string | number> = {
  'tiktok.defaultRegion': 'US',
  'tiktok.authorizeBaseUrlUs': 'https://services.us.tiktokshop.com',
  'tiktok.authorizeBaseUrlRow': 'https://services.tiktokshop.com',
  'tiktok.serviceId': 'svc-123',
  'tiktok.oauthStateTtlSeconds': 900,
  'tiktok.oauthStateRetentionHours': 72,
};

/** Kết nối mà `completeAuthorization` trả về (chỉ các field service OAuth thực sự đọc). */
const LINKED_ACCOUNT = {
  id: ACCOUNT_ID,
  accountName: 'Test Seller',
  shops: [{ name: 'Maomao beauty shop', region: 'US' }],
};

interface CreateStateArg {
  organizationId: string;
  userId: string;
  accountName: string;
  state: string;
  region: string;
  expiresAt: Date;
}

describe('PodTiktokOAuthService', () => {
  let service: PodTiktokOAuthService;
  let stateRepo: {
    create: jest.Mock;
    consume: jest.Mock;
    markExpiredIfPending: jest.Mock;
    markSucceeded: jest.Mock;
    markFailed: jest.Mock;
    findResultByToken: jest.Mock;
    purgeOlderThan: jest.Mock;
  };
  let accountService: { completeAuthorization: jest.Mock };

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => CONFIG_VALUES[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => CONFIG_VALUES[key]),
    } as unknown as ConfigService;

    stateRepo = {
      create: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue({
        id: STATE_ROW_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        region: 'US',
        accountName: ACCOUNT_NAME,
      }),
      markExpiredIfPending: jest.fn().mockResolvedValue(true),
      markSucceeded: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      findResultByToken: jest.fn(),
      purgeOlderThan: jest.fn().mockResolvedValue(0),
    };
    accountService = {
      completeAuthorization: jest.fn().mockResolvedValue(LINKED_ACCOUNT),
    };

    service = new PodTiktokOAuthService(
      config,
      stateRepo as unknown as PodTiktokOAuthStateRepository,
      accountService as unknown as PodTiktokAccountService,
    );
  });

  describe('startAuthorization', () => {
    it('sinh state ngẫu nhiên, lưu server-side và đính vào authorization link', async () => {
      const result = await service.startAuthorization(ORG_ID, USER_ID, ACCOUNT_NAME);

      const saved = callArg<CreateStateArg>(stateRepo.create, 0, 0);
      expect(saved.organizationId).toBe(ORG_ID);
      expect(saved.userId).toBe(USER_ID);
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
      // 🔴 Tên phải nằm trong bản ghi state: callback không có cách nào hỏi lại người dùng.
      expect(saved.accountName).toBe(ACCOUNT_NAME);
      expect(result.accountName).toBe(ACCOUNT_NAME);

      const url = new URL(result.authorizeUrl);
      expect(url.origin).toBe('https://services.us.tiktokshop.com');
      expect(url.pathname).toBe('/open/authorize');
      expect(url.searchParams.get('service_id')).toBe('svc-123');
      // Đúng giá trị đã lưu — nếu lệch thì callback không bao giờ khớp được.
      expect(url.searchParams.get('state')).toBe(saved.state);
    });

    it('state đủ dài và khác nhau ở mỗi lần bấm (không thể đoán, không tái sử dụng)', async () => {
      await service.startAuthorization(ORG_ID, USER_ID, ACCOUNT_NAME);
      await service.startAuthorization(ORG_ID, USER_ID, ACCOUNT_NAME);

      const first = callArg<CreateStateArg>(stateRepo.create, 0, 0).state;
      const second = callArg<CreateStateArg>(stateRepo.create, 1, 0).state;
      expect(first).not.toBe(second);
      // 32 byte → 43 ký tự base64url.
      expect(first.length).toBeGreaterThanOrEqual(43);
    });

    it('dùng domain ROW khi chỉ định region = ROW', async () => {
      const result = await service.startAuthorization(ORG_ID, USER_ID, ACCOUNT_NAME, 'ROW');

      expect(result.region).toBe('ROW');
      expect(new URL(result.authorizeUrl).origin).toBe('https://services.tiktokshop.com');
    });

    it('KHÔNG trả state ra ngoài response (chỉ nằm trong URL gửi TikTok)', async () => {
      const result = await service.startAuthorization(ORG_ID, USER_ID, ACCOUNT_NAME);
      expect(Object.keys(result).sort()).toEqual([
        'accountName',
        'authorizeUrl',
        'expiresAt',
        'region',
      ]);
    });
  });

  describe('handleCallback — xác thực state', () => {
    it('không có state → từ chối, KHÔNG gọi TikTok', async () => {
      const outcome = await service.handleCallback({ authorizationCode: 'C' });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('POD_TIKTOK_INVALID_STATE');
      expect(accountService.completeAuthorization).not.toHaveBeenCalled();
    });

    it('state hết hạn / đã dùng → từ chối, KHÔNG đổi token', async () => {
      stateRepo.consume.mockResolvedValue(null);

      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('POD_TIKTOK_INVALID_STATE');
      expect(accountService.completeAuthorization).not.toHaveBeenCalled();
    });

    it('state chỉ dùng được MỘT LẦN — lần hai bị chặn', async () => {
      // Lần đầu tiêu thụ được; lần sau repository trả null (bản ghi đã USED).
      stateRepo.consume
        .mockResolvedValueOnce({
          id: STATE_ROW_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          region: 'US',
          accountName: ACCOUNT_NAME,
        })
        .mockResolvedValue(null);

      const first = await service.handleCallback({ authorizationCode: 'C', state: 'S' });
      const second = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(accountService.completeAuthorization).toHaveBeenCalledTimes(1);
    });

    it('Seller từ chối (error=auth_denied) → ghi nhận và không gọi TikTok', async () => {
      const outcome = await service.handleCallback({ state: 'S', error: 'auth_denied' });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('POD_TIKTOK_AUTH_DENIED');
      expect(accountService.completeAuthorization).not.toHaveBeenCalled();
      expect(stateRepo.markFailed).toHaveBeenCalledWith(
        STATE_ROW_ID,
        'POD_TIKTOK_AUTH_DENIED',
        expect.any(String),
      );
    });
  });

  describe('handleCallback — hoàn tất tự động', () => {
    it('lấy organizationId/userId/accountName TỪ BẢN GHI STATE, không từ query', async () => {
      await service.handleCallback({ authorizationCode: 'THE_CODE', state: 'S' });

      expect(accountService.completeAuthorization).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'THE_CODE',
        ACCOUNT_NAME,
        {},
      );
    });

    it('thành công → gắn kết nối vào state và phát vé đọc kết quả', async () => {
      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome.success).toBe(true);
      expect(outcome.resultToken).toEqual(expect.any(String));
      expect(stateRepo.markSucceeded).toHaveBeenCalledWith(
        STATE_ROW_ID,
        ACCOUNT_ID,
        outcome.resultToken,
      );
    });

    it('thành công → trả kèm tóm tắt để trang kết quả dựng ngay, không phải gọi thêm', async () => {
      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome).toMatchObject({
        success: true,
        accountName: 'Test Seller',
        shopName: 'Maomao beauty shop',
        region: 'US',
        shopCount: 1,
      });
      expect(outcome.linkedAt).toEqual(expect.any(String));
      // 🔴 Không có bất kỳ dấu vết token nào trong outcome.
      expect(JSON.stringify(outcome)).not.toContain('token"');
    });

    it('đổi token lỗi → giữ mã lỗi nghiệp vụ để trang thất bại hiển thị', async () => {
      accountService.completeAuthorization.mockRejectedValue(
        new PodTiktokInvalidAuthCodeException(),
      );

      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('POD_TIKTOK_INVALID_AUTH_CODE');
      // Kèm thông điệp thân thiện để trang kết quả vẫn nói được nguyên nhân dù chưa có bản dịch.
      // Không so khớp nguyên văn: nội dung thuộc về exception, đổi chữ không được làm vỡ test.
      expect(outcome.message).toBe(
        (new PodTiktokInvalidAuthCodeException().getResponse() as { message: string }).message,
      );
      expect(stateRepo.markFailed).toHaveBeenCalledWith(
        STATE_ROW_ID,
        'POD_TIKTOK_INVALID_AUTH_CODE',
        outcome.resultToken,
      );
    });

    it('shop đã liên kết → báo đúng nguyên nhân thay vì lỗi chung', async () => {
      accountService.completeAuthorization.mockRejectedValue(
        new PodTiktokShopAlreadyLinkedException('Maomao beauty shop'),
      );

      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome.errorCode).toBe('POD_TIKTOK_SHOP_ALREADY_LINKED');
    });

    it('lỗi lạ (không phải HttpException) → quy về lỗi API, không ném ra ngoài', async () => {
      accountService.completeAuthorization.mockRejectedValue(new Error('socket hang up'));

      const outcome = await service.handleCallback({ authorizationCode: 'C', state: 'S' });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('POD_TIKTOK_API_ERROR');
      // Không lộ chi tiết kỹ thuật ('socket hang up') ra ngoài.
      expect(outcome.message).not.toContain('socket');
    });
  });

  describe('getLinkResult', () => {
    it('trả tóm tắt phi nhạy cảm của phiên thành công', async () => {
      stateRepo.findResultByToken.mockResolvedValue({
        status: PodTiktokOAuthStateStatus.USED,
        errorCode: null,
        usedAt: new Date('2026-08-17T10:00:00.000Z'),
        account: {
          id: ACCOUNT_ID,
          accountName: 'Test Seller',
          sellerName: 'Test Seller',
          shops: [
            { name: 'Maomao beauty shop', region: 'US' },
            { name: 'Shop 2', region: 'GB' },
          ],
        },
      });

      const result = await service.getLinkResult('TOKEN');

      expect(result).toEqual({
        success: true,
        accountName: 'Test Seller',
        sellerName: 'Test Seller',
        shopName: 'Maomao beauty shop',
        region: 'US',
        shopCount: 2,
        linkedAt: '2026-08-17T10:00:00.000Z',
        errorCode: null,
      });
    });

    it('phiên thất bại → success = false kèm mã lỗi', async () => {
      stateRepo.findResultByToken.mockResolvedValue({
        status: PodTiktokOAuthStateStatus.FAILED,
        errorCode: 'POD_TIKTOK_AUTH_DENIED',
        usedAt: new Date(),
        account: null,
      });

      const result = await service.getLinkResult('TOKEN');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('POD_TIKTOK_AUTH_DENIED');
      expect(result.shopName).toBeNull();
    });

    it('vé sai / hết hạn → POD_TIKTOK_LINK_RESULT_NOT_FOUND', async () => {
      stateRepo.findResultByToken.mockResolvedValue(null);

      await expect(service.getLinkResult('TOKEN')).rejects.toBeInstanceOf(
        PodTiktokLinkResultNotFoundException,
      );
    });
  });
});
