import { PodTiktokAccountStatus, PodTiktokShopStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { callArg } from '../../../testing/mock-call.util';
import { TiktokApiClient } from '../clients/tiktok-api.client';
import { TiktokErrorClass } from '../constants/tiktok-error-code.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import {
  PodTiktokShopSyncRepository,
  type ShopSyncAccount,
} from '../repositories/pod-tiktok-shop-sync.repository';
import {
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from './pod-access-scope.service';
import { PodTiktokShopSyncService } from './pod-tiktok-shop-sync.service';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';

/**
 * Unit test — **Sync Shops**: đọc lại thông tin + trạng thái shop từ TikTok.
 *
 * Những điều phải đúng: phạm vi do BACKEND quyết (Seller không chạm được kết nối của người
 * khác), shop phân loại đúng ACTIVE / INACTIVE / DEAUTHORIZED theo hai API của TikTok, và một
 * kết nối/shop lỗi KHÔNG làm hỏng cả lượt.
 */

const ORG = 'org-1';
const USER = 'user-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-a'], shopIds: ['shop-a1'] };

function account(
  id: string,
  shops: Array<{ id: string; tiktokShopId: string; name?: string; status?: PodTiktokShopStatus }>,
  status: PodTiktokAccountStatus = PodTiktokAccountStatus.ACTIVE,
): ShopSyncAccount {
  return {
    id,
    organizationId: ORG,
    accountName: `Kết nối ${id}`,
    status,
    accessTokenEnc: 'enc-access',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    refreshTokenEnc: 'enc-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    shops: shops.map((shop) => ({
      id: shop.id,
      tiktokShopId: shop.tiktokShopId,
      name: shop.name ?? `Tên cũ ${shop.id}`,
      status: shop.status ?? PodTiktokShopStatus.ACTIVE,
    })),
  };
}

/** Một shop như TikTok trả về ở Get Authorized Shops. */
function remote(id: string, name = `Tên mới ${id}`) {
  return { id, name, region: 'US', seller_type: 'LOCAL', cipher: `cipher-${id}`, code: `CODE${id}` };
}

function buildService(accounts: ShopSyncAccount[]) {
  const repo = {
    findAccounts: jest.fn().mockResolvedValue(accounts),
    applyTiktokShop: jest.fn().mockResolvedValue(undefined),
    markDeauthorized: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn().mockResolvedValue(undefined),
  };
  const apiClient = {
    getAuthorizedShops: jest.fn(),
    getActiveShops: jest.fn(),
  };
  const tokenService = {
    ensureValidAccessToken: jest.fn((ref: { id: string }) =>
      Promise.resolve({ ok: true, accessToken: `token-${ref.id}`, refreshed: false }),
    ),
  };
  const encryption = { encrypt: jest.fn((value: string) => `enc(${value})`) };
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };

  const service = new PodTiktokShopSyncService(
    config as unknown as ConfigService,
    repo as unknown as PodTiktokShopSyncRepository,
    apiClient as unknown as TiktokApiClient,
    tokenService as unknown as PodTiktokTokenService,
    encryption as unknown as TiktokEncryptionService,
    // Bản THẬT: chính hàm assert này là thứ đang được kiểm.
    new PodAccessScopeService({} as never),
  );
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, repo, apiClient, tokenService };
}

describe('PodTiktokShopSyncService', () => {
  it('1. Admin — một shop đang hoạt động ⇒ SYNCED/ACTIVE, ghi đúng dữ liệu TikTok trả về', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111' }]),
    ]);
    apiClient.getAuthorizedShops.mockResolvedValue({ shops: [remote('111')] });
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111'] });

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result).toMatchObject({ totalShops: 1, syncedShops: 1, activeShops: 1, failedShops: 0 });
    expect(result.items[0]).toMatchObject({
      shopId: 'shop-a1',
      shopName: 'Tên mới 111',
      result: 'SYNCED',
      shopStatus: PodTiktokShopStatus.ACTIVE,
    });
    // Admin ⇒ không giới hạn phạm vi.
    expect(callArg<{ accountScope?: string[] }>(repo.findAccounts, 0, 1).accountScope).toBeUndefined();
    // Chỉ những trường TikTok trả về — cipher được MÃ HOÁ trước khi ghi.
    expect(callArg(repo.applyTiktokShop, 0, 1)).toEqual({
      name: 'Tên mới 111',
      region: 'US',
      shopCode: 'CODE111',
      sellerType: 'LOCAL',
      shopCipherEnc: 'enc(cipher-111)',
      status: PodTiktokShopStatus.ACTIVE,
    });
    // Ghi khoá theo CẢ tổ chức + kết nối + shop.
    expect(callArg(repo.applyTiktokShop, 0, 0)).toEqual({
      organizationId: ORG,
      accountId: 'acc-a',
      shopId: 'shop-a1',
    });
  });

  it('2. Admin — nhiều kết nối, nhiều shop ⇒ mỗi kết nối dùng token CỦA NÓ', async () => {
    const { service, apiClient } = buildService([
      account('acc-a', [
        { id: 'shop-a1', tiktokShopId: '111' },
        { id: 'shop-a2', tiktokShopId: '112' },
      ]),
      account('acc-b', [{ id: 'shop-b1', tiktokShopId: '221' }]),
    ]);
    apiClient.getAuthorizedShops.mockImplementation((token: string) =>
      Promise.resolve({
        shops: token === 'token-acc-a' ? [remote('111'), remote('112')] : [remote('221')],
      }),
    );
    apiClient.getActiveShops.mockImplementation((token: string) =>
      Promise.resolve({ shopIds: token === 'token-acc-a' ? ['111', '112'] : ['221'] }),
    );

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.syncedShops).toBe(3);
    expect(result.items.map((item) => item.shopId)).toEqual(['shop-a1', 'shop-a2', 'shop-b1']);
  });

  it('3. Seller — chỉ kết nối được gán (phạm vi lấy từ JWT, không từ request)', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111' }]),
    ]);
    apiClient.getAuthorizedShops.mockResolvedValue({ shops: [remote('111')] });
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111'] });

    await service.syncShops(ORG, USER, {}, SELLER);

    expect(callArg(repo.findAccounts, 0, 0)).toBe(ORG);
    expect(callArg<{ accountScope?: string[] }>(repo.findAccounts, 0, 1).accountScope).toEqual([
      'acc-a',
    ]);
  });

  it('4. 🔴 Seller gửi accountId của Seller KHÁC ⇒ 403, không đọc DB, không gọi TikTok', async () => {
    const { service, repo, apiClient } = buildService([]);

    await expect(
      service.syncShops(ORG, USER, { accountId: 'acc-cua-nguoi-khac' }, SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(repo.findAccounts).not.toHaveBeenCalled();
    expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
  });

  it('5. Shop còn uỷ quyền nhưng KHÔNG có trong Get Active Shops ⇒ INACTIVE', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [
        { id: 'shop-a1', tiktokShopId: '111' },
        { id: 'shop-a2', tiktokShopId: '112' },
      ]),
    ]);
    apiClient.getAuthorizedShops.mockResolvedValue({ shops: [remote('111'), remote('112')] });
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111'] });

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result).toMatchObject({ syncedShops: 2, activeShops: 1, inactiveShops: 1 });
    expect(result.items[1]).toMatchObject({
      shopId: 'shop-a2',
      shopStatus: PodTiktokShopStatus.INACTIVE,
      previousShopStatus: PodTiktokShopStatus.ACTIVE,
    });
    expect(callArg<{ status: string }>(repo.applyTiktokShop, 1, 1).status).toBe(
      PodTiktokShopStatus.INACTIVE,
    );
  });

  it('6a. Shop KHÔNG còn trong Get Authorized Shops ⇒ DEAUTHORIZED (không xoá, không ghi đè tên)', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [
        { id: 'shop-a1', tiktokShopId: '111' },
        { id: 'shop-a2', tiktokShopId: '112' },
      ]),
    ]);
    apiClient.getAuthorizedShops.mockResolvedValue({ shops: [remote('111')] });
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111'] });

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.deauthorizedShops).toBe(1);
    expect(repo.markDeauthorized).toHaveBeenCalledWith(
      { organizationId: ORG, accountId: 'acc-a', shopId: 'shop-a2' },
      expect.any(Date),
      USER,
    );
    expect(repo.applyTiktokShop).toHaveBeenCalledTimes(1);
  });

  it('6b. Kết nối DISCONNECTED / REAUTH_REQUIRED ⇒ SKIPPED + lý do, KHÔNG gọi TikTok', async () => {
    const { service, apiClient, tokenService } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111' }], PodTiktokAccountStatus.DISCONNECTED),
      account('acc-b', [{ id: 'shop-b1', tiktokShopId: '221' }], PodTiktokAccountStatus.REAUTH_REQUIRED),
    ]);

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result).toMatchObject({ totalShops: 2, skippedShops: 2, syncedShops: 0 });
    expect(result.items.map((item) => item.errorCode)).toEqual([
      'ACCOUNT_DISCONNECTED',
      'ACCOUNT_REAUTH_REQUIRED',
    ]);
    expect(tokenService.ensureValidAccessToken).not.toHaveBeenCalled();
    expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
  });

  it('7. TikTok timeout ⇒ FAILED với mã rõ ràng, ghi lỗi, KHÔNG đổi trạng thái shop', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111', status: PodTiktokShopStatus.ACTIVE }]),
    ]);
    apiClient.getAuthorizedShops.mockRejectedValue(
      new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'Request timeout', 0),
    );

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.failedShops).toBe(1);
    expect(result.items[0]).toMatchObject({
      result: 'FAILED',
      shopStatus: PodTiktokShopStatus.ACTIVE,
      errorCode: 'NETWORK',
      errorMessage: 'Request timeout',
    });
    expect(repo.recordError).toHaveBeenCalledWith(
      { organizationId: ORG, accountId: 'acc-a' },
      { code: 'NETWORK', message: 'Request timeout' },
      USER,
    );
    expect(repo.applyTiktokShop).not.toHaveBeenCalled();
    expect(repo.markDeauthorized).not.toHaveBeenCalled();
  });

  it('8. 🔴 Một kết nối lỗi ⇒ các kết nối khác VẪN được đồng bộ', async () => {
    const { service, apiClient } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111' }]),
      account('acc-b', [{ id: 'shop-b1', tiktokShopId: '221' }]),
      account('acc-c', [{ id: 'shop-c1', tiktokShopId: '331' }]),
    ]);
    apiClient.getAuthorizedShops.mockImplementation((token: string) =>
      token === 'token-acc-b'
        ? Promise.reject(new TiktokClientError(TiktokErrorClass.AUTH, 105005, 'Access denied', 200))
        : Promise.resolve({ shops: [remote(token === 'token-acc-a' ? '111' : '331')] }),
    );
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111', '331'] });

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.items.map((item) => [item.shopId, item.result, item.errorCode])).toEqual([
      ['shop-a1', 'SYNCED', null],
      ['shop-b1', 'FAILED', '105005'],
      ['shop-c1', 'SYNCED', null],
    ]);
  });

  it('token không lấy được ⇒ FAILED cho shop của kết nối đó, mã = lý do của token service', async () => {
    const { service, tokenService, apiClient } = buildService([
      account('acc-a', [{ id: 'shop-a1', tiktokShopId: '111' }]),
    ]);
    tokenService.ensureValidAccessToken.mockResolvedValue({
      ok: false,
      reason: 'REAUTH_REQUIRED',
      message: 'Uỷ quyền đã hết hạn — seller cần uỷ quyền lại',
    } as never);

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.items[0]).toMatchObject({ result: 'FAILED', errorCode: 'REAUTH_REQUIRED' });
    expect(apiClient.getAuthorizedShops).not.toHaveBeenCalled();
  });

  it('một shop ghi DB lỗi ⇒ chỉ shop đó FAILED, shop cùng kết nối vẫn SYNCED', async () => {
    const { service, repo, apiClient } = buildService([
      account('acc-a', [
        { id: 'shop-a1', tiktokShopId: '111' },
        { id: 'shop-a2', tiktokShopId: '112' },
      ]),
    ]);
    apiClient.getAuthorizedShops.mockResolvedValue({ shops: [remote('111'), remote('112')] });
    apiClient.getActiveShops.mockResolvedValue({ shopIds: ['111', '112'] });
    repo.applyTiktokShop.mockRejectedValueOnce(new Error('DB hỏng'));

    const result = await service.syncShops(ORG, USER, {}, ADMIN);

    expect(result.items.map((item) => item.result)).toEqual(['FAILED', 'SYNCED']);
  });
});
