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
/** Tên kết nối người dùng nhập ở bước tạo Authorization URL. */
const ACCOUNT_NAME = 'NCMedia US Store';

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
  let repo: jest.Mocked<Partial<PodTiktokAccountRepository>>;
  let encryption: { encrypt: jest.Mock };
  let authClient: { getAccessToken: jest.Mock };
  let apiClient: { getAuthorizedShops: jest.Mock };

  beforeEach(() => {
    // $transaction chạy callback với `tx` giả — không chạm DB thật.
    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
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

  describe('completeAuthorization — luồng thành công', () => {
    beforeEach(() => mockFindByIdResult());

    it('thực hiện đúng thứ tự: đổi code → Get Authorized Shops → lưu DB', async () => {
      const result = await service.completeAuthorization(ORG_ID, USER_ID, 'TTP_auth_code', ACCOUNT_NAME);

      expect(authClient.getAccessToken).toHaveBeenCalledWith('TTP_auth_code');
      expect(apiClient.getAuthorizedShops).toHaveBeenCalledWith(TOKEN_RESPONSE.access_token);
      expect(repo.createAccount).toHaveBeenCalled();
      expect(repo.upsertShop).toHaveBeenCalledTimes(1);
      expect(result.accountName).toBe('NCMedia US Store');
    });

    it('MÃ HOÁ access_token, refresh_token và shop_cipher trước khi lưu', async () => {
      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);

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
      const result = await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(TOKEN_RESPONSE.access_token);
      expect(serialized).not.toContain(TOKEN_RESPONSE.refresh_token);
      expect(serialized).not.toContain(SHOP_RESPONSE.cipher);
    });

    it('ghi audit ISSUE khi tạo kết nối mới', async () => {
      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);
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

      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);

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
        accountName: 'NCMedia US Store',
      });

      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);

      expect(repo.createAccount).not.toHaveBeenCalled();
      expect(repo.updateAccountTokens).toHaveBeenCalled();
      const audit = callArg<AuditArg>(repo.insertTokenAudit as jest.Mock, 0, 1);
      expect(audit.action).toBe(PodTiktokTokenAction.REAUTHORIZE);
    });

    it('truyền đúng organizationId từ tham số (tenant isolation)', async () => {
      await service.completeAuthorization(OTHER_ORG_ID, USER_ID, 'code', ACCOUNT_NAME);
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

  describe('completeAuthorization — validation & lỗi', () => {
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
        service.completeAuthorization(ORG_ID, USER_ID, 'used-code', ACCOUNT_NAME),
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
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
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
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).rejects.toBeInstanceOf(PodTiktokRateLimitedException);
    });

    it('lỗi nghiệp vụ khác → POD_TIKTOK_API_ERROR (không lộ message gốc)', async () => {
      apiClient.getAuthorizedShops.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 999999, 'internal detail', 200),
      );

      await expect(
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).rejects.toBeInstanceOf(PodTiktokApiException);
    });

    it('user_type là Creator (1) → từ chối', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, user_type: 1 },
      });

      await expect(
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).rejects.toBeInstanceOf(PodTiktokInvalidUserTypeException);
      expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
    });

    it('chấp nhận Global Selling seller (user_type = 4)', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, user_type: 4 },
      });
      mockFindByIdResult();

      await expect(
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).resolves.toBeDefined();
    });

    it('TikTok không trả shop nào → POD_TIKTOK_NO_SHOP', async () => {
      apiClient.getAuthorizedShops.mockResolvedValue({ shops: [] });

      await expect(
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).rejects.toBeInstanceOf(PodTiktokNoShopException);
      expect(repo.createAccount).not.toHaveBeenCalled();
    });

    it('Shop đã được kết nối khác trong cùng Organization → POD_TIKTOK_SHOP_ALREADY_LINKED', async () => {
      (repo.findConflictingShops as jest.Mock).mockResolvedValue([
        { tiktokShopId: SHOP_RESPONSE.id, name: SHOP_RESPONSE.name },
      ]);

      await expect(
        service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME),
      ).rejects.toBeInstanceOf(PodTiktokShopAlreadyLinkedException);
      expect(repo.createAccount).not.toHaveBeenCalled();
      expect(repo.upsertShop).not.toHaveBeenCalled();
    });

    it('seller_type lạ được chuẩn hoá về LOCAL (không làm hỏng link)', async () => {
      apiClient.getAuthorizedShops.mockResolvedValue({
        shops: [{ ...SHOP_RESPONSE, seller_type: 'SOMETHING_NEW' }],
      });
      mockFindByIdResult();

      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);

      const shopData = callArg<PodTiktokShopWriteData>(repo.upsertShop as jest.Mock, 0, 4);
      expect(shopData.sellerType).toBe('LOCAL');
    });
  });

  /**
   * Tên kết nối do người dùng nhập ở bước tạo Authorization URL, đi theo bản ghi `state`
   * để callback (request vô danh) vẫn gán được đúng tên. Thiếu tên thì suy ra từ dữ liệu
   * TikTok — cột `account_name` là NOT NULL nên không bao giờ được rỗng.
   */
  describe('tên kết nối', () => {
    beforeEach(() => mockFindByIdResult());

    it('dùng ĐÚNG tên người dùng đã nhập', async () => {
      await service.completeAuthorization(ORG_ID, USER_ID, 'code', ACCOUNT_NAME);

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accountName).toBe(ACCOUNT_NAME);
    });

    it('cắt khoảng trắng thừa của tên người dùng nhập', async () => {
      await service.completeAuthorization(ORG_ID, USER_ID, 'code', '   Shop A   ');

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accountName).toBe('Shop A');
    });

    it('không có tên người dùng → lấy seller_name của TikTok', async () => {
      await service.completeAuthorization(ORG_ID, USER_ID, 'code');

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accountName).toBe(TOKEN_RESPONSE.seller_name);
    });

    it('không có tên người dùng lẫn seller_name → dùng tên shop đầu tiên', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, seller_name: '' },
      });

      await service.completeAuthorization(ORG_ID, USER_ID, 'code');

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accountName).toBe(SHOP_RESPONSE.name);
    });

    it('không có nguồn nào → vẫn có tên nhận diện (cột NOT NULL)', async () => {
      authClient.getAccessToken.mockResolvedValue({
        data: { ...TOKEN_RESPONSE, seller_name: null },
      });
      apiClient.getAuthorizedShops.mockResolvedValue({
        shops: [{ ...SHOP_RESPONSE, name: '' }],
      });

      await service.completeAuthorization(ORG_ID, USER_ID, 'code');

      const writeData = callArg<PodTiktokAccountWriteData>(repo.createAccount as jest.Mock, 0, 3);
      expect(writeData.accountName).toContain(TOKEN_RESPONSE.open_id);
    });

    it('uỷ quyền lại có nhập tên mới → CẬP NHẬT tên theo người dùng', async () => {
      (repo.findByOpenIdIncludingDeleted as jest.Mock).mockResolvedValue({
        id: ACCOUNT_ID,
        deletedAt: null,
        accountName: 'Tên cũ',
      });

      await service.completeAuthorization(ORG_ID, USER_ID, 'code', 'Tên mới');

      const writeData = callArg<PodTiktokAccountWriteData>(
        repo.updateAccountTokens as jest.Mock,
        0,
        3,
      );
      expect(writeData.accountName).toBe('Tên mới');
    });

    it('uỷ quyền lại KHÔNG nhập tên → giữ nguyên tên cũ, không ghi đè bằng tên suy ra', async () => {
      (repo.findByOpenIdIncludingDeleted as jest.Mock).mockResolvedValue({
        id: ACCOUNT_ID,
        deletedAt: null,
        accountName: 'Tên do tổ chức đặt',
      });

      await service.completeAuthorization(ORG_ID, USER_ID, 'code');

      const writeData = callArg<PodTiktokAccountWriteData>(
        repo.updateAccountTokens as jest.Mock,
        0,
        3,
      );
      expect(writeData.accountName).toBe('Tên do tổ chức đặt');
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
