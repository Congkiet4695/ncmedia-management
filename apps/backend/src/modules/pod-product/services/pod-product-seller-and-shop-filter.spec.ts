import { PodTiktokAccountStatus, PodTiktokShopStatus, type Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { callArg } from '../../../testing/mock-call.util';
import {
  PodAccessScopeService,
  POD_SCOPE_SYSTEM,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  PodProductFilterOptionsQueryDto,
  PodProductQueryDto,
} from '../dto/pod-product-query.dto';
import { PodProductRepository, type PodProductFindManyParams } from '../repositories/pod-product.repository';
import { PodProductService } from './pod-product.service';

/**
 * Products — bộ lọc **Employees** (`sellerId`) và danh sách shop **chỉ hoạt động** cho Listing.
 *
 * Product không có cột nhân viên: nhân viên phụ trách là `PodTiktokAccount.sellerId` (ID Employee) của kết nối
 * sở hữu sản phẩm — cùng quan hệ mà Orders / Dashboard / TikTok Accounts đang lọc.
 */

const ORG = 'org-1';
const SELLER_SCOPE: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

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

const BASE: PodProductFindManyParams = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' };

function buildService(shops: unknown[] = []) {
  const repo = { findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const prisma = {
    podProductCategory: { findMany: jest.fn().mockResolvedValue([]) },
    podProductBrand: { findMany: jest.fn().mockResolvedValue([]) },
    podTiktokShop: { findMany: jest.fn().mockResolvedValue(shops) },
  };
  const service = new PodProductService(
    prisma as never,
    repo as never,
    {} as never,
    { toListItem: jest.fn() } as never,
    {} as never,
    new PodAccessScopeService(prisma as never),
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repo, prisma };
}

const errorCode = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: { response?: { code?: string } }) => error.response?.code ?? 'NO_CODE',
  );

describe('Products — lọc theo Employee (repository)', () => {
  it('sellerId ⇒ lọc qua quan hệ account (N-1, không nhân bản dòng); COUNT dùng CÙNG điều kiện', async () => {
    const { repo, query, countWhere } = buildRepo();
    await repo.findMany(ORG, { ...BASE, page: 2, limit: 10, sellerId: 'employee-1' });

    expect(query().where).toMatchObject({ organizationId: ORG, deletedAt: null, account: { sellerId: 'employee-1' } });
    expect(query().skip).toBe(10);
    expect(query().take).toBe(10);
    expect(query().orderBy).toEqual({ createdAt: 'desc' });
    expect(countWhere()).toEqual(query().where);
  });

  it('không chọn Employee ⇒ điều kiện y như trước (không có `account`)', async () => {
    const { repo, query } = buildRepo();
    await repo.findMany(ORG, BASE);
    expect(query().where).not.toHaveProperty('account');
  });

  it('kết hợp search + status + shop + category + brand + Employee', async () => {
    const { repo, query } = buildRepo();
    await repo.findMany(ORG, {
      ...BASE,
      search: 'tee',
      statuses: ['ACTIVE'],
      shopId: 'shop-1',
      categoryId: 'cat-1',
      brandId: 'brand-1',
      sellerId: 'employee-1',
    });
    const where = query().where as Prisma.PodProductWhereInput;
    expect(where).toMatchObject({
      organizationId: ORG,
      shopId: 'shop-1',
      categoryId: 'cat-1',
      brandId: 'brand-1',
      account: { sellerId: 'employee-1' },
      status: { in: ['ACTIVATE'] },
    });
    expect(where.OR).toHaveLength(3);
  });

  it('🔴 luôn kèm organizationId ⇒ ID nhân viên của tổ chức khác chỉ cho ra tập rỗng, không rò dữ liệu', async () => {
    const { repo, query } = buildRepo();
    await repo.findMany(ORG, { ...BASE, sellerId: 'employee-of-other-org' });
    expect(query().where).toMatchObject({ organizationId: ORG, account: { sellerId: 'employee-of-other-org' } });
  });
});

describe('Products — lọc theo Employee (service + DTO)', () => {
  it('người xem mọi shop (pod.shop.all) ⇒ sellerId đi xuống repository', async () => {
    const { service, repo } = buildService();
    await service.findAll(ORG, { sellerId: 'employee-1' }, POD_SCOPE_SYSTEM);
    expect(repo.findMany).toHaveBeenCalledWith(ORG, expect.objectContaining({ sellerId: 'employee-1', shopScope: undefined }));
  });

  it('🔴 Seller (chỉ shop được gán) gửi sellerId ⇒ 403, không truy vấn', async () => {
    const { service, repo } = buildService();
    expect(await errorCode(service.findAll(ORG, { sellerId: 'employee-2' }, SELLER_SCOPE))).toBe(
      'POD_SHOP_FORBIDDEN',
    );
    expect(repo.findMany).not.toHaveBeenCalled();
  });

  it('Seller không gửi sellerId ⇒ vẫn chạy như cũ trong phạm vi được gán', async () => {
    const { service, repo } = buildService();
    await service.findAll(ORG, {}, SELLER_SCOPE);
    expect(repo.findMany).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ sellerId: undefined, shopScope: ['shop-1'], accountScope: ['acc-1'] }),
    );
  });

  it('meta (total / totalPages) tính trên tập đã lọc', async () => {
    const { service, repo } = buildService();
    repo.findMany.mockResolvedValue({ items: [], total: 45 });
    const result = await service.findAll(ORG, { sellerId: 'employee-1', page: 2, limit: 20 }, POD_SCOPE_SYSTEM);
    expect(result.meta).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
  });

  it('DTO: sellerId không phải UUID ⇒ lỗi validate (400)', async () => {
    const bad = await validate(plainToInstance(PodProductQueryDto, { sellerId: 'abc' }));
    expect(bad.map((error) => error.property)).toContain('sellerId');
    const ok = await validate(plainToInstance(PodProductQueryDto, { sellerId: '0b8f0e0e-6a5b-4d7e-9a43-0b0a3c8a1f11' }));
    expect(ok.map((error) => error.property)).not.toContain('sellerId');
  });
});

describe('GET /pod/products/filters — activeShopsOnly (Listing)', () => {
  const shopWhere = (prisma: ReturnType<typeof buildService>['prisma']) =>
    callArg<{ where: Prisma.PodTiktokShopWhereInput }>(prisma.podTiktokShop.findMany, 0, 0).where;

  it('activeShopsOnly ⇒ chỉ shop ACTIVE thuộc kết nối ACTIVE, vẫn trong phạm vi', async () => {
    const { service, prisma } = buildService();
    await service.findFilterOptions(ORG, SELLER_SCOPE, { activeShopsOnly: true });
    expect(shopWhere(prisma)).toEqual({
      organizationId: ORG,
      deletedAt: null,
      id: { in: ['shop-1'] },
      status: PodTiktokShopStatus.ACTIVE,
      account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
    });
  });

  it('🔴 không truyền ⇒ GIỮ NGUYÊN danh sách cũ (Products, Flash Sale, Clone vẫn thấy shop đã ngưng)', async () => {
    const { service, prisma } = buildService();
    await service.findFilterOptions(ORG, POD_SCOPE_SYSTEM);
    expect(shopWhere(prisma)).toEqual({ organizationId: ORG, deletedAt: null });
  });

  it('DTO: "false" là false (không bị implicit conversion biến thành true)', () => {
    expect(plainToInstance(PodProductFilterOptionsQueryDto, { activeShopsOnly: 'false' }, { enableImplicitConversion: true }).activeShopsOnly).toBe(false);
    expect(plainToInstance(PodProductFilterOptionsQueryDto, { activeShopsOnly: 'true' }, { enableImplicitConversion: true }).activeShopsOnly).toBe(true);
  });
});
