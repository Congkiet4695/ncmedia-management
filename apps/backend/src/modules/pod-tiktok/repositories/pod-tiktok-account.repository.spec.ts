import { PodTiktokShopStatus } from '@prisma/client';
import { PodTiktokAccountRepository, type PodTiktokFindManyParams } from './pod-tiktok-account.repository';

/**
 * Bộ lọc màn TikTok Accounts ở tầng truy vấn (mock Prisma — không có DB): Active / Inactive theo trạng thái SHOP,
 * Seller được assign theo `seller_id`, và "Tổng số shop" đếm trên `pod_tiktok_shops` theo CÙNG bộ lọc.
 */
/** Đối số đầu tiên của lần gọi thứ `call` (mock Prisma) — có kiểu, không truy cập `any`. */
const argOf = (mock: jest.Mock, call = 0) => (mock.mock.calls as Array<[Record<string, unknown>]>)[call][0];

describe('PodTiktokAccountRepository.findMany — bộ lọc + tổng số shop', () => {
  const ORG = 'org-1';
  const BASE: PodTiktokFindManyParams = { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' };

  const run = async (params: Partial<PodTiktokFindManyParams>) => {
    const prisma = {
      podTiktokAccount: {
        findMany: jest.fn().mockResolvedValue([{ id: 'acc-1' }]),
        count: jest.fn().mockResolvedValue(12),
      },
      podTiktokShop: { count: jest.fn().mockResolvedValue(13) },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const repo = new PodTiktokAccountRepository(prisma as never);
    const result = await repo.findMany(ORG, { ...BASE, ...params });
    const accountWhere = argOf(prisma.podTiktokAccount.findMany).where as Record<string, unknown>;
    const countWhere = argOf(prisma.podTiktokAccount.count).where as Record<string, unknown>;
    const shopWhere = argOf(prisma.podTiktokShop.count).where as Record<string, unknown>;
    return { result, accountWhere, countWhere, shopWhere, prisma };
  };

  it('Tất cả: không thêm điều kiện trạng thái shop / seller; tổng shop = shop chưa xoá của các kết nối khớp', async () => {
    const { result, accountWhere, shopWhere } = await run({});
    expect(accountWhere).toEqual({ organizationId: ORG, deletedAt: null });
    expect(shopWhere).toEqual({ organizationId: ORG, deletedAt: null, account: { is: accountWhere } });
    expect(result).toEqual({ items: [{ id: 'acc-1' }], total: 12, totalShops: 13 });
  });

  it.each([PodTiktokShopStatus.ACTIVE, PodTiktokShopStatus.INACTIVE])(
    'shopStatus=%s ⇒ kết nối có ít nhất một shop ở trạng thái đó; chỉ đếm shop ở trạng thái đó',
    async (status) => {
      const { accountWhere, shopWhere } = await run({ shopStatus: status });
      expect(accountWhere.shops).toEqual({ some: { deletedAt: null, status } });
      expect(shopWhere).toMatchObject({ status, deletedAt: null, account: { is: accountWhere } });
    },
  );

  it('sellerId cụ thể ⇒ seller_id = id; null ⇒ chưa phân công (seller_id IS NULL)', async () => {
    expect((await run({ sellerId: 'e-1' })).accountWhere.sellerId).toBe('e-1');
    expect((await run({ sellerId: null })).accountWhere.sellerId).toBeNull();
    expect('sellerId' in (await run({})).accountWhere).toBe(false);
  });

  it('kết hợp: phạm vi Seller + trạng thái shop + seller + tìm kiếm ⇒ cùng một `where` cho danh sách, đếm kết nối và đếm shop', async () => {
    const { accountWhere, countWhere, shopWhere } = await run({
      accountScope: ['acc-a'],
      shopStatus: PodTiktokShopStatus.ACTIVE,
      sellerId: 'e-1',
      search: 'store',
    });
    expect(accountWhere).toMatchObject({
      id: { in: ['acc-a'] },
      sellerId: 'e-1',
      shops: { some: { deletedAt: null, status: 'ACTIVE' } },
    });
    expect(accountWhere.OR).toBeDefined();
    // Phân trang dựa trên CÙNG bộ lọc ⇒ meta.total và tổng shop khớp đúng tập kết quả, không chỉ trang hiện tại.
    expect(countWhere).toBe(accountWhere);
    expect((shopWhere.account as { is: unknown }).is).toBe(accountWhere);
  });

  it('phân trang không ảnh hưởng tổng: skip / take chỉ áp cho danh sách', async () => {
    const { prisma } = await run({ page: 3, limit: 10 });
    expect(argOf(prisma.podTiktokAccount.findMany)).toMatchObject({ skip: 20, take: 10 });
    expect(argOf(prisma.podTiktokAccount.count)).not.toHaveProperty('skip');
    expect(argOf(prisma.podTiktokShop.count)).not.toHaveProperty('skip');
  });
});

describe('PodTiktokAccountRepository.findAssignedSellers', () => {
  it('Employee đang đứng tên ≥ 1 kết nối trong phạm vi + số kết nối chưa phân công', async () => {
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 'e-1', user: { id: 'u', fullName: 'A', email: 'a@x' } }]) },
      podTiktokAccount: { count: jest.fn().mockResolvedValue(2) },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const repo = new PodTiktokAccountRepository(prisma as never);
    const result = await repo.findAssignedSellers('org-1', ['acc-a']);
    const scope = { organizationId: 'org-1', deletedAt: null, id: { in: ['acc-a'] } };
    expect(argOf(prisma.employee.findMany).where).toEqual({
      organizationId: 'org-1',
      deletedAt: null,
      podTiktokAccounts: { some: scope },
    });
    // Chỉ chọn id + họ tên / email — không kéo dữ liệu nhạy cảm.
    expect(argOf(prisma.employee.findMany).select).toEqual({
      id: true,
      user: { select: { id: true, fullName: true, email: true } },
    });
    expect(argOf(prisma.podTiktokAccount.count).where).toEqual({ ...scope, sellerId: null });
    expect(result).toEqual({ sellers: [{ id: 'e-1', user: { id: 'u', fullName: 'A', email: 'a@x' } }], unassignedAccounts: 2 });
  });
});
