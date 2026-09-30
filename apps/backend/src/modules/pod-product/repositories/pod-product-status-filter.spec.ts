import type { Prisma } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import {
  POD_PRODUCT_LOCAL_STATUSES,
  toLocalProductStatus,
} from '../constants/pod-product.constants';
import { PodProductRepository, type PodProductFindManyParams } from './pod-product.repository';

/**
 * Bộ lọc **Status** của màn hình Products — lọc ở TẦNG DATABASE.
 *
 * 🔴 Kiểm trên đúng thứ gửi xuống Prisma (`where` + `skip`/`take`), vì yêu cầu là "không được
 * chỉ filter ở frontend": tổng số và phân trang phải tính trên tập ĐÃ lọc.
 */

const ORG = 'org-1';

function buildRepo() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    podProduct: { findMany, count },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const repo = new PodProductRepository(prisma as never);
  const query = () => callArg<Prisma.PodProductFindManyArgs>(findMany, 0, 0);
  const countWhere = () => callArg<{ where: Prisma.PodProductWhereInput }>(count, 0, 0).where;
  return { repo, query, countWhere };
}

const BASE: PodProductFindManyParams = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

describe('PodProductRepository.findMany — lọc trạng thái', () => {
  it('không truyền status ⇒ CHỈ ACTIVE (mặc định an toàn cho màn hình chọn sản phẩm)', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, BASE);

    expect(query().where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      deactivatedAt: null,
      status: { in: ['ACTIVATE'] },
    });
  });

  it.each([
    ['ACTIVE', ['ACTIVATE']],
    ['REVIEWING', ['PENDING']],
    ['DEACTIVATED', ['SELLER_DEACTIVATED', 'PLATFORM_DEACTIVATED']],
    ['NEEDS_ATTENTION', ['FAILED', 'FREEZE']],
  ] as const)('status=%s ⇒ status IN %j', async (group, tiktok) => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, { ...BASE, statuses: [group] });

    expect(query().where?.status).toEqual({ in: tiktok });
  });

  it('🔴 "All" ⇒ mọi nhóm, KHÔNG mặc định loại REVIEWING / DEACTIVATED / NEEDS_ATTENTION', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, { ...BASE, statuses: [...POD_PRODUCT_LOCAL_STATUSES] });

    expect(query().where?.status).toEqual({
      in: ['ACTIVATE', 'PENDING', 'SELLER_DEACTIVATED', 'PLATFORM_DEACTIVATED', 'FAILED', 'FREEZE'],
    });
    // DRAFT / DELETED không thuộc nhóm nào ⇒ không bao giờ hiện.
    expect((query().where?.status as { in: string[] }).in).not.toContain('DELETED');
  });

  it('nhiều nhóm ⇒ hợp của các nhóm', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, { ...BASE, statuses: ['ACTIVE', 'REVIEWING'] });

    expect(query().where?.status).toEqual({ in: ['ACTIVATE', 'PENDING'] });
  });

  it('🔴 search + status ⇒ cả hai điều kiện CÙNG áp (AND), search không ghi đè status', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, { ...BASE, statuses: ['REVIEWING'], search: 'hoodie' });

    const where = query().where!;
    expect(where.status).toEqual({ in: ['PENDING'] });
    expect(where.OR).toEqual(
      expect.arrayContaining([{ title: { contains: 'hoodie', mode: 'insensitive' } }]),
    );
  });

  it('🔴 phân trang + status ⇒ skip/take theo trang, COUNT dùng CÙNG điều kiện lọc', async () => {
    const { repo, query, countWhere } = buildRepo();

    await repo.findMany(ORG, { ...BASE, page: 3, limit: 10, statuses: ['DEACTIVATED'] });

    expect(query().skip).toBe(20);
    expect(query().take).toBe(10);
    // Tổng số phải đếm trên tập ĐÃ lọc — nếu không, "Trang 3/12" sẽ sai.
    expect(countWhere()).toEqual(query().where);
  });

  it('🔴 phạm vi Seller vẫn áp khi lọc status (giao, không ghi đè)', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, {
      ...BASE,
      statuses: ['ACTIVE'],
      shopScope: ['shop-1'],
      accountScope: ['acc-1'],
    });

    expect(query().where).toMatchObject({
      shopId: { in: ['shop-1'] },
      accountId: { in: ['acc-1'] },
      status: { in: ['ACTIVATE'] },
    });
  });

  it('includeInactive (đối soát) KHÔNG có status ⇒ không giới hạn trạng thái', async () => {
    const { repo, query } = buildRepo();

    await repo.findMany(ORG, { ...BASE, includeInactive: true });

    expect(query().where?.status).toBeUndefined();
    expect(query().where?.deactivatedAt).toBeUndefined();
  });
});

describe('toLocalProductStatus', () => {
  it.each([
    ['ACTIVATE', 'ACTIVE'],
    ['PENDING', 'REVIEWING'],
    ['SELLER_DEACTIVATED', 'DEACTIVATED'],
    ['PLATFORM_DEACTIVATED', 'DEACTIVATED'],
    ['FAILED', 'NEEDS_ATTENTION'],
    ['FREEZE', 'NEEDS_ATTENTION'],
  ])('%s ⇒ %s', (tiktok, local) => {
    expect(toLocalProductStatus(tiktok)).toBe(local);
  });

  it.each([['DRAFT'], ['DELETED'], ['SOMETHING_NEW'], [null], [undefined]])(
    '🔴 %s ⇒ null — KHÔNG bao giờ quy về ACTIVE',
    (tiktok) => {
      expect(toLocalProductStatus(tiktok)).toBeNull();
    },
  );
});
