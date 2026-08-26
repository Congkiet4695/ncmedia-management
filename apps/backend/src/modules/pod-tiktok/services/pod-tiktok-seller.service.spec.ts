import { PrismaService } from '../../../database/prisma.service';
import { TiktokApiClient } from '../clients/tiktok-api.client';
import { TiktokAuthClient } from '../clients/tiktok-auth.client';
import { PodTiktokSellerInvalidException } from '../exceptions/pod-tiktok.exceptions';
import { PodTiktokAccountMapper } from '../mappers/pod-tiktok-account.mapper';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodTiktokAccountService } from './pod-tiktok-account.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { callArg } from '../../../testing/mock-call.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const ACCOUNT = '33333333-3333-3333-3333-333333333333';
const EMPLOYEE = '44444444-4444-4444-4444-444444444444';

/** Bản ghi account tối thiểu mà mapper cần. */
function accountRow(over: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT,
    accountName: 'HN28',
    openId: '7010736012345675637',
    sellerName: 'TikTok Seller',
    sellerId: null,
    seller: null,
    sellerBaseRegion: 'US',
    userType: 0,
    status: 'ACTIVE',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    grantedScopes: [],
    lastRefreshedAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    shops: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('PodTiktokAccountService — Seller phụ trách', () => {
  let service: PodTiktokAccountService;
  let repo: {
    findById: jest.Mock;
    assignSeller: jest.Mock;
    isEligibleSeller: jest.Mock;
    findEligibleSellers: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findById: jest.fn().mockResolvedValue(accountRow()),
      assignSeller: jest.fn().mockResolvedValue(undefined),
      isEligibleSeller: jest.fn().mockResolvedValue(true),
      findEligibleSellers: jest.fn().mockResolvedValue([]),
    };

    service = new PodTiktokAccountService(
      {} as unknown as PrismaService,
      repo as unknown as PodTiktokAccountRepository,
      new PodTiktokAccountMapper(),
      {} as unknown as TiktokEncryptionService,
      {} as unknown as TiktokAuthClient,
      {} as unknown as TiktokApiClient,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  describe('findSellerOptions', () => {
    it('trả về id Employee kèm họ tên + email để hiển thị', async () => {
      repo.findEligibleSellers.mockResolvedValue([
        { id: EMPLOYEE, user: { id: 'u1', fullName: 'Nguyễn Văn A', email: 'nva@gmail.com' } },
      ]);

      const result = await service.findSellerOptions(ORG, {});

      expect(result).toEqual([{ id: EMPLOYEE, fullName: 'Nguyễn Văn A', email: 'nva@gmail.com' }]);
    });

    it('luôn giới hạn theo Organization của người gọi', async () => {
      await service.findSellerOptions(ORG, { search: 'linh' });
      expect(callArg<string>(repo.findEligibleSellers, 0, 0)).toBe(ORG);
      expect(callArg<string>(repo.findEligibleSellers, 0, 1)).toBe('linh');
    });

    it('search rỗng → không truyền bộ lọc thừa xuống DB', async () => {
      await service.findSellerOptions(ORG, { search: '' });
      expect(callArg<string | undefined>(repo.findEligibleSellers, 0, 1)).toBeUndefined();
    });
  });

  describe('assignSeller', () => {
    it('gán Employee hợp lệ → ghi sellerId', async () => {
      await service.assignSeller(ORG, ACTOR, ACCOUNT, { sellerId: EMPLOYEE });

      expect(repo.isEligibleSeller).toHaveBeenCalledWith(ORG, EMPLOYEE);
      expect(repo.assignSeller).toHaveBeenCalledWith(ACCOUNT, EMPLOYEE, ACTOR);
    });

    it('🔴 Employee không đủ điều kiện (nghỉ việc / role Admin / khác tổ chức) → từ chối', async () => {
      repo.isEligibleSeller.mockResolvedValue(false);

      await expect(
        service.assignSeller(ORG, ACTOR, ACCOUNT, { sellerId: EMPLOYEE }),
      ).rejects.toBeInstanceOf(PodTiktokSellerInvalidException);
      expect(repo.assignSeller).not.toHaveBeenCalled();
    });

    it('sellerId = null → BỎ phân công, không cần kiểm tra điều kiện', async () => {
      await service.assignSeller(ORG, ACTOR, ACCOUNT, { sellerId: null });

      expect(repo.isEligibleSeller).not.toHaveBeenCalled();
      expect(repo.assignSeller).toHaveBeenCalledWith(ACCOUNT, null, ACTOR);
    });

    it('bỏ trống sellerId → cũng là bỏ phân công', async () => {
      await service.assignSeller(ORG, ACTOR, ACCOUNT, {});
      expect(repo.assignSeller).toHaveBeenCalledWith(ACCOUNT, null, ACTOR);
    });

    it('🔴 account thuộc tổ chức khác → không tìm thấy, KHÔNG ghi gì', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.assignSeller(ORG, ACTOR, ACCOUNT, { sellerId: EMPLOYEE }),
      ).rejects.toThrow();
      expect(repo.assignSeller).not.toHaveBeenCalled();
    });
  });

  describe('mapper — hiển thị Seller', () => {
    it('có Seller → trả họ tên và email lấy từ User của Employee', () => {
      const dto = new PodTiktokAccountMapper().toListItem(
        accountRow({
          sellerId: EMPLOYEE,
          seller: {
            id: EMPLOYEE,
            status: 'ACTIVE',
            user: { fullName: 'Lê Như Yên', email: 'yen@x.com' },
          },
        }) as never,
      );

      expect(dto.sellerId).toBe(EMPLOYEE);
      expect(dto.sellerFullName).toBe('Lê Như Yên');
      expect(dto.sellerEmail).toBe('yen@x.com');
    });

    it('chưa phân công → các trường seller đều null (FE hiển thị "Chưa phân công")', () => {
      const dto = new PodTiktokAccountMapper().toListItem(accountRow() as never);

      expect(dto.sellerId).toBeNull();
      expect(dto.sellerFullName).toBeNull();
      expect(dto.sellerEmail).toBeNull();
    });
  });
});
