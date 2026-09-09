import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodProductService } from './pod-product.service';

/**
 * **Bộ chọn SKU phải phân trang ở SERVER và bị chặn theo phạm vi shop.**
 *
 * 🔴 Đơn vị phân trang là SKU, không phải sản phẩm. Một sản phẩm có 1 hay 60 biến thể, nên
 * "20 sản phẩm" là một con số giao diện không đoán được — và cách làm sai kinh điển là lấy
 * 20 sản phẩm kèm toàn bộ biến thể rồi cắt ở trình duyệt, tức là vẫn kéo cả kho về.
 */

function buildService(result: { items: unknown[]; total: number } = { items: [], total: 0 }) {
  const repo = { findVariants: jest.fn().mockResolvedValue(result) };
  const accessScope = {
    assertShopAllowed: (scope: { allShops: boolean; shopIds: string[] }, shopId?: string | null) => {
      if (scope.allShops || !shopId) return;
      if (!scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    },
    assertAccountAllowed: jest.fn(),
  };

  const service = new PodProductService(
    {} as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    accessScope as never,
  );

  const args = (): Record<string, unknown> =>
    (repo.findVariants.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];

  return { service, repo, args };
}

const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

describe('findVariants — phân trang', () => {
  it('mặc định trang 1, 20 dòng, và truyền thẳng xuống repository', async () => {
    const { service, args } = buildService();

    await service.findVariants('org-1', {}, ADMIN);

    expect(args().page).toBe(1);
    expect(args().limit).toBe(20);
  });

  it('🔴 phân trang ở SERVER: skip/take do repository nhận, không phải cắt ở bộ nhớ', async () => {
    const { service, args } = buildService();

    await service.findVariants('org-1', { page: 3, limit: 50 }, ADMIN);

    expect(args().page).toBe(3);
    expect(args().limit).toBe(50);
  });

  it('meta.totalPages tính đúng cho 10.000 SKU', async () => {
    const { service } = buildService({ items: [], total: 10_000 });

    const result = await service.findVariants('org-1', { limit: 20 }, ADMIN);

    expect(result.meta).toEqual({ total: 10_000, page: 1, limit: 20, totalPages: 500 });
  });

  it('không có kết quả ⇒ totalPages = 0 (không phải 1 trang rỗng)', async () => {
    const { service } = buildService({ items: [], total: 0 });

    const result = await service.findVariants('org-1', {}, ADMIN);

    expect(result.meta.totalPages).toBe(0);
  });

  it('từ khoá tìm kiếm được chuyển xuống server, không lọc ở client', async () => {
    const { service, args } = buildService();

    await service.findVariants('org-1', { search: 'black', page: 1 }, ADMIN);

    expect(args().search).toBe('black');
  });
});

describe('findVariants — phạm vi shop', () => {
  it('Admin ⇒ không giới hạn tập shop', async () => {
    const { service, args } = buildService();

    await service.findVariants('org-1', {}, ADMIN);

    expect(args().shopScope).toBeUndefined();
  });

  it('🔴 Seller không gửi shopId ⇒ vẫn bị giới hạn đúng shop được gán', async () => {
    const { service, args } = buildService();

    await service.findVariants('org-1', {}, SELLER);

    expect(args().shopScope).toEqual(['shop-1']);
  });

  it('🔴 Seller hỏi shop NGOÀI phạm vi ⇒ 403, không chạm database', async () => {
    const { service, repo } = buildService();

    await expect(
      service.findVariants('org-1', { shopId: 'shop-nguoi-khac' }, SELLER as never),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);

    expect(repo.findVariants).not.toHaveBeenCalled();
  });
});

describe('findVariants — giá gốc hiển thị', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'v-1',
    productId: 'p-1',
    variantName: 'Black / M',
    sellerSku: 'SKU-1',
    tiktokSkuId: 'TT-1',
    salePrice: null,
    listPrice: null,
    currency: 'USD',
    imageUrl: null,
    status: 'ACTIVATE',
    product: { title: 'Tee' },
    ...over,
  });

  it('🔴 dùng `salePrice` trước, lùi về `listPrice` — ĐÚNG luật mà backend dùng để tính deal', async () => {
    // Bộ chọn hiện một giá mà backend lại tính theo giá khác là cách chắc chắn nhất để
    // người dùng mất niềm tin vào con số trên màn hình.
    const { service } = buildService({
      items: [row({ salePrice: '20.00', listPrice: '25.00' }), row({ id: 'v-2', listPrice: '30.00' })],
      total: 2,
    });

    const result = await service.findVariants('org-1', {}, ADMIN);

    expect(result.items[0].originalPrice).toBe(20);
    expect(result.items[1].originalPrice).toBe(30);
  });

  it('không có giá nào ⇒ null (không phải 0 — 0 là một mức giá thật)', async () => {
    const { service } = buildService({ items: [row({})], total: 1 });

    const result = await service.findVariants('org-1', {}, ADMIN);

    expect(result.items[0].originalPrice).toBeNull();
  });
});
