import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountStatus, PodTiktokTokenAction } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TiktokErrorClass, TIKTOK_ERROR_CODES } from '../constants/tiktok-error-code.constants';
import { TiktokApiClient } from '../clients/tiktok-api.client';
import { TiktokAuthClient } from '../clients/tiktok-auth.client';
import {
  PodTiktokAccountNotFoundException,
  PodTiktokApiException,
  PodTiktokInvalidAuthCodeException,
  PodTiktokInvalidUserTypeException,
  PodTiktokNoShopException,
  PodTiktokRateLimitedException,
  PodTiktokScopeMissingException,
  PodTiktokShopAlreadyLinkedException,
  TiktokClientError,
} from '../exceptions/pod-tiktok.exceptions';
import { PodTiktokAccountMapper } from '../mappers/pod-tiktok-account.mapper';
import {
  PodTiktokAccountRepository,
  type PodTiktokAccountWriteData,
  type PodTiktokShopWriteData,
} from '../repositories/pod-tiktok-account.repository';
import { PodTiktokAccountService } from './pod-tiktok-account.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444';

/** Response mẫu của Get Access Token (đúng shape tài liệu Authorization overview). */
const TOKEN_RESPONSE = {
  access_token: 'TTP_access_token_example',
  access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  refresh_token: 'TTP_refresh_token_example',
  refresh_token_expire_in: Math.floor(Date.now() / 1000) + 180 * 24 * 3600,
  open_id: '7010736057180325637',
  seller_name: 'Test Seller',
  seller_base_region: 'US',
  user_type: 0,
  granted_scopes: ['seller.order.info'],
};

/** Response mẫu của Get Authorized Shops. */
const SHOP_RESPONSE = {
  id: '7000714532876273420',
  name: 'Maomao beauty shop',
  region: 'US',
  seller_type: 'LOCAL',
  cipher: 'GCP_XF90igAAAABh00qsWgtvOiGFNqyubMt3',
  code: 'CNGBCBA4LLU8',
};

/**
 * Ciphertext giả lập: định dạng giống `AesGcmCipher` (`v1.<...>`) và KHÔNG chứa plaintext,
 * để các assertion "không rò rỉ token" phản ánh đúng hành vi thật.
 */
function fakeCipher(value: string): string {
  return `v1.${Buffer.from(value, 'utf8').toString('base64')}`;
}

/** Đọc tham số của một lần gọi mock với kiểu tường minh (tránh `any` lan ra test). */
function callArg<T>(mock: jest.Mock, callIndex: number, argIndex: number): T {
  const calls = mock.mock.calls as unknown as unknown[][];
  return calls[callIndex][argIndex] as T;
}

/** Kiểu tối giản của bản ghi audit token dùng trong assertion. */
interface AuditArg {
  action: PodTiktokTokenAction;
  success: boolean;
  organizationId: string;
}

describe('PodTiktokAccountService', () => {
  let service: PodTiktokAccountService;
  let prisma: { $transaction: jest.Mock };
  let config: { get: jest.Mock; getOrThrow: jest.Mock };
  let repo: jest.Mocked<Partial<PodTiktokAccountRepository>>;
  let encryption: { encrypt: jest.Mock };
  let authClient: { getAccessToken: jest.Mock };
  let apiClient: { getAuthorizedShops: jest.Mock };

  const CONFIG_VALUES: Record<string, string> = {
    'tiktok.defaultRegion': 'US',
    'tiktok.authorizeBaseUrlUs': 'https://services.us.tiktokshop.com',
    'tiktok.authorizeBaseUrlRow': 'https://services.tiktokshop.com',
    'tiktok.serviceId': 'svc-123',
  };

  beforeEach(() => {
    // $transaction chạy callback với `tx` giả — không chạm DB thật.
    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
    };
    config = {
      get: jest.fn((key: string, fallback?: string) => CONFIG_VALUES[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => CONFIG_VALUES[key]),
    };
    repo = {
      findByOpenIdIncludingDeleted: jest.fn().mockResolvedValue(null),
      findConflictingShops: jest.fn().mockResolvedValue([]),
      createAccount: jest.fn().mockResolvedValue({ id: ACCOUNT_ID }),
      updateAccountTokens: jest.fn().mockResolvedValue(undefined),
      upsertShop: jest.fn().mockResolvedValue(undefined),
      softDeleteShopsNotIn: jest.fn().mockResolvedValue(undefined),
      softDeleteAccount: jest.fn().mockResolvedValue(undefined),
      insertTokenAudit: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findMany: jest.fn(),
    };
    // Mock giống ciphertext thật (không chứa plaintext) để assert "không rò rỉ" có ý nghĩa.
    encryption = { encrypt: jest.fn((value: string) => fakeCipher(value)) };
    authClient = {
      getAccessToken: jest.fn().mockResolvedValue({ data: TOKEN_RESPONSE, requestId: 'req-1' }),
    };
    apiClient = {
      getAuthorizedShops: jest.fn().mockResolvedValue({ shops: [SHOP_RESPONSE], requestId: 'req-2' }),
    };

    service = new PodTiktokAccountService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      repo as unknown as PodTiktokAccountRepository,
      new PodTiktokAccountMapper(),
      encryption as unknown as TiktokEncryptionService,
      authClient as unknown as TiktokAuthClient,
      apiClient as unknown as TiktokApiClient,
    );
  });

  /** Bản ghi Prisma giả để mapper dựng response sau khi link. */
  function mockFindByIdResult() {
    (repo.findById as jest.Mock).mockResolvedValue({
      id: ACCOUNT_ID,
      accountName: 'NCMedia US Store',
      openId: TOKEN_RESPONSE.open_id,
      sellerName: TOKEN_RESPONSE.seller_name,
      sellerBaseRegion: 'US',
      userType: 0,
      status: PodTiktokAccountStatus.ACTIVE,
      accessTokenExpiresAt: new Date(TOKEN_RESPONSE.access_token_expire_in * 1000),
      refreshTokenExpiresAt: new Date(TOKEN_RESPONSE.refresh_token_expire_in * 1000),
      grantedScopes: TOKEN_RESPONSE.granted_scopes,
      lastRefreshedAt: null,
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      shops: [
        {
          id: 'shop-uuid',
          tiktokShopId: SHOP_RESPONSE.id,
          shopCode: SHOP_RESPONSE.code,
          name: SHOP_RESPONSE.name,
          region: SHOP_RESPONSE.region,
          sellerType: SHOP_RESPONSE.seller_type,
          syncEnabled: true,
          lastOrderSyncAt: null,
          createdAt: new Date(),
        },
      ],
    });
  }

  describe('link — luồng thành công', () => {
    beforeEach(() => mockFindByIdResult());

    it('thực hiện đúng thứ tự: đổi code → Get Authorized Shops → lưu DB', async () => {
      const result = await service.link(ORG_ID, USER_ID, {
        accountName: 'NCMedia US Store',
        authorizationCode: 'TTP_auth_code',
      });

      expect(authClient.getAccessToken).toHaveBeenCalledWith('TTP_auth_code');
      expect(apiClient.getAuthorizedShops).toHaveBeenCalledWith(TOKEN_RESPONSE.access_token);
      expect(repo.createAccount).toHaveBeenCalled();
      expect(repo.upsertShop).toHaveBeenCalledTimes(1);
      expect(result.accountName).toBe('NCMedia US Store');
    });

    it('MÃ HOÁ access_token, refresh_token và shop_cipher trước khi lưu', async () => {
      await service.link(ORG_ID, USER_ID, {
        accountName: 'NCMedia US Store',
        authorizationCode: 'code',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith(TOKEN_RESPONSE.access_token);
      expect(encryption.encrypt).toHaveBeenCalledWith(TOKEN_RESPONSE.refresh_token);
      expect(encryption.encrypt).toHaveBeenCalledWith(SHOP_RESPONSE.cipher);

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accessTokenEnc).toBe(fakeCipher(TOKEN_RESPONSE.access_token));
      expect(writeData.refreshTokenEnc).toBe(fakeCipher(TOKEN_RESPONSE.refresh_token));
      // Không được lưu plaintext ở bất kỳ field nào.
      expect(JSON.stringify(writeData)).not.toContain(TOKEN_RESPONSE.access_token);
      expect(JSON.stringify(writeData)).not.toContain(TOKEN_RESPONSE.refresh_token);

      // shop_cipher cũng phải được mã hoá trước khi ghi.
      const shopData = callArg<PodTiktokShopWriteData>(repo.upsertShop as jest.Mock, 0, 4);
      expect(shopData.shopCipherEnc).toBe(fakeCipher(SHOP_RESPONSE.cipher));
      expect(JSON.stringify(shopData)).not.toContain(SHOP_RESPONSE.cipher);
    });

    it('KHÔNG trả về token/shop_cipher trong response', async () => {
      const result = await service.link(ORG_ID, USER_ID, {
        accountName: 'NCMedia US Store',
        authorizationCode: 'code',
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(TOKEN_RESPONSE.access_token);
      expect(serialized).not.toContain(TOKEN_RESPONSE.refresh_token);
      expect(serialized).not.toContain(SHOP_RESPONSE.cipher);
    });

    it('ghi audit ISSUE khi tạo kết nối mới', async () => {
      await service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' });
      const audit = callArg<AuditArg>(repo.insertTokenAudit as jest.Mock, 0, 1);
      expect(audit.action).toBe(PodTiktokTokenAction.ISSUE);
      expect(audit.success).toBe(true);
      expect(audit.organizationId).toBe(ORG_ID);
      // Audit KHÔNG được chứa giá trị token.
      expect(JSON.stringify(audit)).not.toContain(TOKEN_RESPONSE.access_token);
    });

    it('lưu TẤT CẢ shop khi TikTok trả về nhiều shop (không giả định chỉ 1 shop)', async () => {
      apiClient.getAuthorizedShops.mockResolvedValue({
        shops: [
          SHOP_RESPONSE,
          { ...SHOP_RESPONSE, id: '7000714532876273421', name: 'Shop 2', seller_type: 'CROSS_BORDER' },
        ],
      });

      await service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' });

      expect(repo.upsertShop).toHaveBeenCalledTimes(2);
      expect(repo.softDeleteShopsNotIn).toHaveBeenCalledWith(
        expect.anything(),
        ACCOUNT_ID,
        ['7000714532876273420', '7000714532876273421'],
        USER_ID,
      );
    });

    it('uỷ quyền lại cùng open_id → CẬP NHẬT kết nối cũ, không tạo bản ghi mới', async () => {
      (repo.findByOpenIdIncludingDeleted as jest.Mock).mockResolvedValue({
        id: ACCOUNT_ID,
        deletedAt: null,
      });

      await service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' });

      expect(repo.createAccount).not.toHaveBeenCalled();
      expect(repo.updateAccountTokens).toHaveBeenCalled();
      const audit = callArg<AuditArg>(repo.insertTokenAudit as jest.Mock, 0, 1);
      expect(audit.action).toBe(PodTiktokTokenAction.REAUTHORIZE);
    });

    it('truyền đúng organizationId từ tham số (tenant isolation)', async () => {
      await service.link(OTHER_ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' });
      expect(repo.findByOpenIdIncludingDeleted).toHaveBeenCalledWith(
        expect.anything(),
        OTHER_ORG_ID,
        TOKEN_RESPONSE.open_id,
      );
      expect(repo.createAccount).toHaveBeenCalledWith(
        expect.anything(),
        OTHER_ORG_ID,
        USER_ID,
        expect.anything(),
      );
    });
  });

  describe('link — validation & lỗi', () => {
    it('Authorization Code sai/hết hạn (36004004) → POD_TIKTOK_INVALID_AUTH_CODE', async () => {
      authClient.getAccessToken.mockRejectedValue(
        new TiktokClientError(
          TiktokErrorClass.AUTH,
          TIKTOK_ERROR_CODES.INVALID_AUTH_CODE,
          'Invalid auth code',
          200,
          'req-err',
        ),
      );

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'used-code' }),
      ).rejects.toBeInstanceOf(PodTiktokInvalidAuthCodeException);
      expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
    });

    it('thiếu scope (105005) → POD_TIKTOK_SCOPE_MISSING', async () => {
      apiClient.getAuthorizedShops.mockRejectedValue(
        new TiktokClientError(
          TiktokErrorClass.AUTH,
          TIKTOK_ERROR_CODES.SCOPE_DENIED,
          'Access denied',
          403,
        ),
      );

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokScopeMissingException);
    });

    it('bị rate limit → POD_TIKTOK_RATE_LIMITED', async () => {
      apiClient.getAuthorizedShops.mockRejectedValue(
        new TiktokClientError(
          TiktokErrorClass.RATE_LIMIT,
          TIKTOK_ERROR_CODES.RATE_LIMITED,
          'Too many requests',
          429,
        ),
      );

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokRateLimitedException);
    });

    it('lỗi nghiệp vụ khác → POD_TIKTOK_API_ERROR (không lộ message gốc)', async () => {
      apiClient.getAuthorizedShops.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 999999, 'internal detail', 200),
      );

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokApiException);
    });

    it('user_type là Creator (1) → từ chối', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, user_type: 1 },
      });

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokInvalidUserTypeException);
      expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
    });

    it('chấp nhận Global Selling seller (user_type = 4)', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, user_type: 4 },
      });
      mockFindByIdResult();

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).resolves.toBeDefined();
    });

    it('TikTok không trả shop nào → POD_TIKTOK_NO_SHOP', async () => {
      apiClient.getAuthorizedShops.mockResolvedValue({ shops: [] });

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokNoShopException);
      expect(repo.createAccount).not.toHaveBeenCalled();
    });

    it('Shop đã được kết nối khác trong cùng Organization → POD_TIKTOK_SHOP_ALREADY_LINKED', async () => {
      (repo.findConflictingShops as jest.Mock).mockResolvedValue([
        { tiktokShopId: SHOP_RESPONSE.id, name: SHOP_RESPONSE.name },
      ]);

      await expect(
        service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' }),
      ).rejects.toBeInstanceOf(PodTiktokShopAlreadyLinkedException);
      expect(repo.createAccount).not.toHaveBeenCalled();
      expect(repo.upsertShop).not.toHaveBeenCalled();
    });

    it('seller_type lạ được chuẩn hoá về LOCAL (không làm hỏng link)', async () => {
      apiClient.getAuthorizedShops.mockResolvedValue({
        shops: [{ ...SHOP_RESPONSE, seller_type: 'SOMETHING_NEW' }],
      });
      mockFindByIdResult();

      await service.link(ORG_ID, USER_ID, { accountName: 'A', authorizationCode: 'code' });

      const shopData = callArg<PodTiktokShopWriteData>(repo.upsertShop as jest.Mock, 0, 4);
      expect(shopData.sellerType).toBe('LOCAL');
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('dùng domain US theo cấu hình mặc định', () => {
      const result = service.buildAuthorizeUrl();
      expect(result.region).toBe('US');
      expect(result.authorizeUrl).toBe(
        'https://services.us.tiktokshop.com/open/authorize?service_id=svc-123',
      );
    });

    it('dùng domain ROW khi chỉ định region = ROW', () => {
      const result = service.buildAuthorizeUrl('ROW');
      expect(result.region).toBe('ROW');
      expect(result.authorizeUrl).toBe(
        'https://services.tiktokshop.com/open/authorize?service_id=svc-123',
      );
    });
  });

  describe('findOne / unlink', () => {
    it('không tìm thấy trong Organization → POD_TIKTOK_ACCOUNT_NOT_FOUND', async () => {
      (repo.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, ACCOUNT_ID)).rejects.toBeInstanceOf(
        PodTiktokAccountNotFoundException,
      );
    });

    it('unlink xoá mềm kết nối và ghi audit REVOKE_LOCAL', async () => {
      mockFindByIdResult();
      await service.unlink(ORG_ID, USER_ID, ACCOUNT_ID);

      expect(repo.softDeleteAccount).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, USER_ID);
      const audit = callArg<AuditArg>(repo.insertTokenAudit as jest.Mock, 0, 1);
      expect(audit.action).toBe(PodTiktokTokenAction.REVOKE_LOCAL);
    });

    it('unlink kết nối của Organization khác → không tìm thấy (tenant isolation)', async () => {
      (repo.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.unlink(OTHER_ORG_ID, USER_ID, ACCOUNT_ID)).rejects.toBeInstanceOf(
        PodTiktokAccountNotFoundException,
      );
      expect(repo.softDeleteAccount).not.toHaveBeenCalled();
    });
  });
});
