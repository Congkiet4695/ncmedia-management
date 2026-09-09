import { PodFlashSaleItemStatus } from '@prisma/client';
import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodFlashSaleService } from './pod-flash-sale.service';

/**
 * **Bảng sản phẩm của đợt sale: phân trang theo SẢN PHẨM, SKU nằm bên trong.**
 *
 * 🔴 Ba điều sai một cái là hỏng cả màn hình:
 *
 * 1. Đơn vị phân trang phải là SẢN PHẨM. Phân trang theo SKU cắt đôi một sản phẩm giữa hai
 *    trang — "Black / S" ở trang 1, "Black / M" ở trang 2.
 * 2. Đúng HAI truy vấn mỗi trang. Lặp qua từng sản phẩm để hỏi SKU của nó là N+1: 100 sản
 *    phẩm thành 101 lượt đọc database.
 * 3. `meta.total` là số SẢN PHẨM. Trả số SKU vào đó thì thanh phân trang hiện 500 trang
 *    trong khi chỉ có 25.
 */

const SCOPE_ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SCOPE_SELLER = { allShops: false, accountIds: [], shopIds: ['shop-cua-toi'] };

/** Một dòng như Prisma trả về (đã include product/variant). */
function row(productId: string, index: number, sortOrder: number) {
  return {
    id: `${productId}-item-${index}`,
    productId,
    variantId: `${productId}-v-${index}`,
    skuId: `SKU-${productId}-${index}`,
    originalPrice: { toString: () => '20.00' },
    flashSalePrice: { toString: () => '18.00' },
    discountPercent: { toString: () => '10.0000' },
    currency: 'USD',
    totalPurchaseLimit: -1,
    customerPurchaseLimit: -1,
    providerProductId: `TT-${productId}`,
    providerVariantId: `TT-SKU-${productId}-${index}`,
    providerSkuId: null,
    status: PodFlashSaleItemStatus.READY,
    errorCode: null,
    error: null,
    sortOrder,
    product: { id: productId, title: `Product ${productId}`, tiktokProductId: `TT-${productId}`, images: [] },
    variant: { id: `${productId}-v-${index}`, variantName: `Variant ${index}`, sellerSku: null, tiktokSkuId: null, imageUrl: null },
  };
}

function buildService(options: {
  /** productId ⇒ số SKU. */
  layout: Record<string, number>;
  page?: string[];
  shopId?: string;
  found?: boolean;
}) {
  const allRows = Object.entries(options.layout).flatMap(([productId, count], productIndex) =>
    Array.from({ length: count }, (_, index) => row(productId, index, productIndex * 100 + index)),
  );
  const allProductIds = Object.keys(options.layout);
  const pageIds = options.page ?? allProductIds;

  const groupBy = jest.fn().mockImplementation((args: { skip?: number; take?: number }) => {
    // Lời gọi có `take` là lấy TRANG; lời gọi không có là ĐẾM tổng số sản phẩm.
    if (args.take === undefined) {
      return Promise.resolve(allProductIds.map((productId) => ({ productId })));
    }
    return Promise.resolve(pageIds.map((productId) => ({ productId })));
  });

  const findMany = jest.fn().mockImplementation((args: { where: { productId?: { in: string[] } } }) => {
    const wanted = new Set(args.where.productId?.in ?? allProductIds);
    return Promise.resolve(allRows.filter((item) => wanted.has(item.productId)));
  });

  const prisma = {
    podFlashSale: {
      findFirst: jest.fn().mockResolvedValue(
        options.found === false ? null : { id: 'fs-1', shopId: options.shopId ?? 'shop-cua-toi' },
      ),
    },
    podFlashSaleItem: {
      groupBy,
      findMany,
      count: jest.fn().mockResolvedValue(allRows.length),
    },
  };

  const accessScope = {
    assertShopAllowed: (scope: { allShops: boolean; shopIds: string[] }, shopId?: string | null) => {
      if (scope.allShops || !shopId) return;
      if (!scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    },
  };

  const service = new PodFlashSaleService(
    prisma as never,
    accessScope as never,
    {} as never,
  );

  return { service, prisma, groupBy, findMany };
}

describe('findProductGroups — phân trang theo SẢN PHẨM', () => {
  it('🔴 gom SKU vào đúng sản phẩm của nó, giữ thứ tự trang', async () => {
    const { service } = buildService({ layout: { 'p-a': 3, 'p-b': 2, 'p-c': 1 } });

    const result = await service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN);

    expect(result.items.map((group) => group.productId)).toEqual(['p-a', 'p-b', 'p-c']);
    expect(result.items.map((group) => group.itemCount)).toEqual([3, 2, 1]);
    expect(result.items[0].items.map((item) => item.id)).toEqual([
      'p-a-item-0',
      'p-a-item-1',
      'p-a-item-2',
    ]);
    // Không có SKU nào lạc sang nhóm khác.
    expect(result.items[1].items.every((item) => item.productId === 'p-b')).toBe(true);
  });

  it('🔴 `meta.total` là số SẢN PHẨM; `totalItems` mới là số SKU', async () => {
    // 3 sản phẩm × 200 SKU = 600 dòng. Thanh phân trang phải nói 3, không phải 600.
    const { service } = buildService({ layout: { 'p-a': 200, 'p-b': 200, 'p-c': 200 } });

    const result = await service.findProductGroups(
      'org-1',
      'fs-1',
      { limit: 20 },
      SCOPE_ADMIN,
    );

    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(1);
    expect(result.totalItems).toBe(600);
  });

  it('🔴 ĐÚNG HAI truy vấn đọc dòng cho mỗi trang — không N+1 theo số sản phẩm', async () => {
    const layout = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`p-${index}`, 5]),
    );
    const { service, findMany, groupBy } = buildService({ layout });

    await service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN);

    // Một `findMany` lấy MỌI dòng của cả trang. 100 sản phẩm ⇒ vẫn đúng một lượt.
    expect(findMany).toHaveBeenCalledTimes(1);
    // Hai `groupBy`: một lấy trang, một đếm tổng số sản phẩm.
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it('chỉ nạp dòng của những sản phẩm TRÊN TRANG, không nạp cả đợt sale', async () => {
    const { service, findMany } = buildService({
      layout: { 'p-a': 2, 'p-b': 2, 'p-c': 2 },
      page: ['p-a', 'p-b'],
    });

    const result = await service.findProductGroups(
      'org-1',
      'fs-1',
      { limit: 2 },
      SCOPE_ADMIN,
    );

    const where = (findMany.mock.calls[0] as unknown as [{ where: { productId: { in: string[] } } }])[0].where;
    expect(where.productId.in).toEqual(['p-a', 'p-b']);
    expect(result.items).toHaveLength(2);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(2);
  });

  it('phân trang truyền đúng skip/take xuống database', async () => {
    const { service, groupBy } = buildService({ layout: { 'p-a': 1 } });

    await service.findProductGroups('org-1', 'fs-1', { page: 4, limit: 25 }, SCOPE_ADMIN);

    const args = (groupBy.mock.calls[0] as unknown as [{ skip: number; take: number }])[0];
    expect(args.skip).toBe(75);
    expect(args.take).toBe(25);
  });

  it('mức PRODUCT: mỗi nhóm đúng MỘT dòng', async () => {
    const { service } = buildService({ layout: { 'p-a': 1, 'p-b': 1 } });

    const result = await service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN);

    expect(result.items.map((group) => group.itemCount)).toEqual([1, 1]);
  });

  it('đợt sale rỗng ⇒ không nạp dòng nào, totalPages = 0', async () => {
    const { service, findMany } = buildService({ layout: {} });

    const result = await service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN);

    expect(result.items).toEqual([]);
    expect(result.meta.totalPages).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bỏ qua dòng đã bị gỡ khỏi hoạt động trên sàn (REMOVED)', async () => {
    const { service, groupBy } = buildService({ layout: { 'p-a': 1 } });

    await service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN);

    const where = (groupBy.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.status).toEqual({ not: PodFlashSaleItemStatus.REMOVED });
  });

  it('tìm kiếm được chuyển xuống server, không lọc ở client', async () => {
    const { service, groupBy } = buildService({ layout: { 'p-a': 1 } });

    await service.findProductGroups('org-1', 'fs-1', { search: 'tee' }, SCOPE_ADMIN);

    const where = (groupBy.mock.calls[0] as unknown as [{ where: { OR?: unknown[] } }])[0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(3);
  });
});

describe('findProductGroups — phạm vi & tồn tại', () => {
  it('🔴 shop ngoài phạm vi ⇒ 403, không đọc dòng nào', async () => {
    const { service, findMany } = buildService({
      layout: { 'p-a': 1 },
      shopId: 'shop-nguoi-khac',
    });

    await expect(
      service.findProductGroups('org-1', 'fs-1', {}, SCOPE_SELLER as never),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('không tìm thấy đợt sale ⇒ ném lỗi, không đọc dòng nào', async () => {
    const { service, findMany } = buildService({ layout: { 'p-a': 1 }, found: false });

    await expect(
      service.findProductGroups('org-1', 'fs-1', {}, SCOPE_ADMIN as never),
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });
});
