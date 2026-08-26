import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountStatus, PodTiktokTokenAction } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TiktokAuthClient } from '../clients/tiktok-auth.client';
import { TIKTOK_ERROR_CODES, TiktokErrorClass } from '../constants/tiktok-error-code.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodTiktokTokenService, TokenAccountRef } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { callArg } from '../../../testing/mock-call.util';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const HOUR = 3_600_000;

function buildAccount(overrides: Partial<TokenAccountRef> = {}): TokenAccountRef {
  return {
    id: ACCOUNT_ID,
    organizationId: ORG_ID,
    accessTokenEnc: 'v1.access',
    accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * HOUR),
    refreshTokenEnc: 'v1.refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * HOUR),
    ...overrides,
  };
}

const NEW_TOKEN = {
  access_token: 'NEW_ACCESS',
  access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  refresh_token: 'NEW_REFRESH',
  refresh_token_expire_in: Math.floor(Date.now() / 1000) + 180 * 24 * 3600,
  open_id: 'open-1',
  user_type: 0,
  granted_scopes: ['seller.order.info'],
};

describe('PodTiktokTokenService', () => {
  let service: PodTiktokTokenService;
  let prisma: { $transaction: jest.Mock };
  let config: { get: jest.Mock };
  let repo: {
    findTokenRefById: jest.Mock;
    updateTokensAfterRefresh: jest.Mock;
    recordRefreshFailure: jest.Mock;
    markStatus: jest.Mock;
    insertTokenAudit: jest.Mock;
  };
  let authClient: { refreshAccessToken: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };
    // Refresh khi access token còn dưới 24h.
    config = { get: jest.fn(() => 86_400) };
    repo = {
      findTokenRefById: jest.fn().mockResolvedValue(buildAccount()),
      updateTokensAfterRefresh: jest.fn().mockResolvedValue(undefined),
      recordRefreshFailure: jest.fn().mockResolvedValue(undefined),
      markStatus: jest.fn().mockResolvedValue(undefined),
      insertTokenAudit: jest.fn().mockResolvedValue(undefined),
    };
    authClient = {
      refreshAccessToken: jest.fn().mockResolvedValue({ data: NEW_TOKEN, requestId: 'req-1' }),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };

    service = new PodTiktokTokenService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      repo as unknown as PodTiktokAccountRepository,
      {
        encrypt: (v: string) => `v1.${v}`,
        decrypt: (v: string) => v.replace('v1.', ''),
      } as unknown as TiktokEncryptionService,
      authClient as unknown as TiktokAuthClient,
      lock as unknown as DistributedLockService,
    );
  });

  describe('ensureValidAccessToken', () => {
    it('token còn hạn xa → dùng token hiện tại, KHÔNG gọi TikTok', async () => {
      const result = await service.ensureValidAccessToken(buildAccount());

      expect(result).toEqual({ ok: true, accessToken: 'access', refreshed: false });
      expect(authClient.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('token sắp hết hạn (dưới ngưỡng) → refresh trước khi dùng', async () => {
      const account = buildAccount({ accessTokenExpiresAt: new Date(Date.now() + 2 * HOUR) });
      repo.findTokenRefById.mockResolvedValue(account);

      const result = await service.ensureValidAccessToken(account);

      expect(authClient.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, accessToken: 'NEW_ACCESS', refreshed: true });
    });

    it('token đã hết hạn → refresh', async () => {
      const account = buildAccount({ accessTokenExpiresAt: new Date(Date.now() - HOUR) });
      repo.findTokenRefById.mockResolvedValue(account);

      const result = await service.ensureValidAccessToken(account);

      expect(result.ok).toBe(true);
      expect(authClient.refreshAccessToken).toHaveBeenCalled();
    });

    it('🔴 refresh token ĐÃ hết hạn → REAUTH_REQUIRED, KHÔNG gọi TikTok vô ích', async () => {
      const account = buildAccount({
        accessTokenExpiresAt: new Date(Date.now() - HOUR),
        refreshTokenExpiresAt: new Date(Date.now() - HOUR),
      });

      const result = await service.ensureValidAccessToken(account);

      expect(result).toMatchObject({ ok: false, reason: 'REAUTH_REQUIRED' });
      expect(authClient.refreshAccessToken).not.toHaveBeenCalled();
      expect(repo.markStatus).toHaveBeenCalledWith(
        expect.anything(),
        ACCOUNT_ID,
        PodTiktokAccountStatus.REAUTH_REQUIRED,
        expect.any(String),
      );
    });
  });

  describe('refresh — rotation an toàn', () => {
    it('lưu CẢ access token MỚI lẫn refresh token MỚI (TikTok xoay vòng refresh token)', async () => {
      await service.refresh(ACCOUNT_ID, ORG_ID);

      const data = callArg<Record<string, unknown>>(repo.updateTokensAfterRefresh, 0, 2);
      expect(data.accessTokenEnc).toBe('v1.NEW_ACCESS');
      expect(data.refreshTokenEnc).toBe('v1.NEW_REFRESH');
      expect(data.grantedScopes).toEqual(['seller.order.info']);
    });

    it('ghi audit REFRESH thành công, KHÔNG chứa giá trị token', async () => {
      await service.refresh(ACCOUNT_ID, ORG_ID);

      const audit = callArg<Record<string, unknown>>(repo.insertTokenAudit, 0, 1);
      expect(audit.action).toBe(PodTiktokTokenAction.REFRESH);
      expect(audit.success).toBe(true);
      expect(JSON.stringify(audit)).not.toContain('NEW_ACCESS');
      expect(JSON.stringify(audit)).not.toContain('NEW_REFRESH');
    });

    it('đọc LẠI token từ DB sau khi giành khoá (tránh dùng refresh token cũ)', async () => {
      await service.refresh(ACCOUNT_ID, ORG_ID);
      expect(lock.acquire).toHaveBeenCalled();
      expect(repo.findTokenRefById).toHaveBeenCalledWith(ORG_ID, ACCOUNT_ID);
    });

    it('luôn giải phóng khoá kể cả khi refresh lỗi', async () => {
      authClient.refreshAccessToken.mockRejectedValue(new Error('boom'));
      await service.refresh(ACCOUNT_ID, ORG_ID);
      expect(lock.release).toHaveBeenCalledTimes(1);
    });

    it('🔴 KHÔNG giành được khoá → KHÔNG gọi TikTok lần hai (chống ghi đè rotation)', async () => {
      lock.acquire.mockResolvedValue(null);
      // Tiến trình kia đã refresh xong, DB có token mới còn hạn dài.
      repo.findTokenRefById.mockResolvedValue(
        buildAccount({ accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * HOUR) }),
      );

      const result = await service.refresh(ACCOUNT_ID, ORG_ID);

      expect(authClient.refreshAccessToken).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: true, refreshed: true });
    });
  });

  describe('Xử lý lỗi refresh', () => {
    it('lỗi AUTH (token bị thu hồi) → REAUTH_REQUIRED', async () => {
      authClient.refreshAccessToken.mockRejectedValue(
        new TiktokClientError(
          TiktokErrorClass.AUTH,
          TIKTOK_ERROR_CODES.INVALID_CREDENTIAL,
          'Invalid credentials',
          401,
          'req-err',
        ),
      );

      const result = await service.refresh(ACCOUNT_ID, ORG_ID);

      expect(result).toMatchObject({ ok: false, reason: 'REAUTH_REQUIRED' });
      const failure = callArg<Record<string, unknown>>(repo.recordRefreshFailure, 0, 2);
      expect(failure.status).toBe(PodTiktokAccountStatus.REAUTH_REQUIRED);
    });

    it('lỗi mạng tạm thời → REFRESH_FAILED (chưa đổi sang REAUTH_REQUIRED)', async () => {
      authClient.refreshAccessToken.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'timeout', 0),
      );

      const result = await service.refresh(ACCOUNT_ID, ORG_ID);

      expect(result).toMatchObject({ ok: false, reason: 'REFRESH_FAILED' });
      const failure = callArg<Record<string, unknown>>(repo.recordRefreshFailure, 0, 2);
      expect(failure.status).toBe(PodTiktokAccountStatus.ERROR);
    });

    it('ghi audit REFRESH thất bại kèm request_id của TikTok', async () => {
      authClient.refreshAccessToken.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.SERVER, 36009003, 'Internal error', 500, 'req-xyz'),
      );

      await service.refresh(ACCOUNT_ID, ORG_ID);

      const audit = callArg<Record<string, unknown>>(repo.insertTokenAudit, 0, 1);
      expect(audit.success).toBe(false);
      expect(audit.errorCode).toBe('36009003');
      expect(audit.tiktokRequestId).toBe('req-xyz');
    });

    it('refresh token hết hạn ngay trước khi gọi → REAUTH_REQUIRED, không gọi TikTok', async () => {
      repo.findTokenRefById.mockResolvedValue(
        buildAccount({ refreshTokenExpiresAt: new Date(Date.now() - HOUR) }),
      );

      const result = await service.refresh(ACCOUNT_ID, ORG_ID);

      expect(result).toMatchObject({ ok: false, reason: 'REAUTH_REQUIRED' });
      expect(authClient.refreshAccessToken).not.toHaveBeenCalled();
    });
  });
});
