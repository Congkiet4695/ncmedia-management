import { findIntroducedSkuConflicts, type ProductSnapshot } from './pod-product-edit.payload';
import { PodProductEditService, PodProductSkuDuplicateException } from './pod-product-edit.service';

/**
 * **Edit Product — Seller SKU trùng.**
 *
 * 🔴 Lỗi thật: 808/1.031 sản phẩm đồng bộ từ TikTok có SẴN nhiều biến thể dùng CHUNG một Seller SKU (POD
 * đặt một mã cho mọi size/màu; TikTok cho phép). Phép kiểm cũ chạy trên MỌI SKU ⇒ các sản phẩm đó không
 * lưu được gì, kể cả chỉ sửa tiêu đề. Luật đúng: chỉ chặn trùng DO LẦN SỬA NÀY tạo ra.
 */
const variants = (codes: Array<string | null>) =>
  codes.map((sellerSku, index) => ({
    tiktokSkuId: `sku-${index + 1}`,
    sellerSku,
    salePrice: '19.99',
    listPrice: null,
    inventoryTotal: 10,
    currency: 'USD',
  }));
const snapshotOf = (codes: Array<string | null>) => ({ variants: variants(codes) }) as unknown as ProductSnapshot;

describe('findIntroducedSkuConflicts', () => {
  it('🔴 SKU trùng CÓ SẴN, không đổi SKU nào (sửa tiêu đề / giá) ⇒ không xung đột', () => {
    expect(findIntroducedSkuConflicts([], snapshotOf(['SHARED', 'SHARED', 'SHARED']))).toEqual([]);
    expect(findIntroducedSkuConflicts([{ id: 'sku-1', price: { amount: '21' } }], snapshotOf(['SHARED', 'SHARED']))).toEqual([]);
  });

  it('E — đổi sang mã mới chưa ai dùng ⇒ hợp lệ', () => {
    expect(findIntroducedSkuConflicts([{ id: 'sku-1', sellerSku: 'NEW' }], snapshotOf(['A', 'B']))).toEqual([]);
  });

  it('🔴 G — đổi sang mã của biến thể khác cùng sản phẩm ⇒ xung đột, nêu đúng biến thể', () => {
    expect(findIntroducedSkuConflicts([{ id: 'sku-1', sellerSku: ' B ' }], snapshotOf(['A', 'B', 'C']))).toEqual([
      { sellerSku: 'B', tiktokSkuId: 'sku-1', conflictsWith: ['sku-2'] },
    ]);
  });

  it('🔴 hai biến thể cùng đổi sang một mã mới ⇒ xung đột cả hai', () => {
    const conflicts = findIntroducedSkuConflicts(
      [
        { id: 'sku-1', sellerSku: 'X' },
        { id: 'sku-2', sellerSku: 'X' },
      ],
      snapshotOf(['A', 'B']),
    );
    expect(conflicts.map((conflict) => conflict.tiktokSkuId)).toEqual(['sku-1', 'sku-2']);
  });

  it('tách một biến thể khỏi mã dùng chung ⇒ hợp lệ', () => {
    expect(findIntroducedSkuConflicts([{ id: 'sku-1', sellerSku: 'UNIQUE' }], snapshotOf(['SHARED', 'SHARED']))).toEqual([]);
  });
});

describe('PodProductEditService.update — Seller SKU trùng', () => {
  function build(codes: Array<string | null>) {
    const product = {
      id: 'p-1',
      shopId: 'shop-1',
      tiktokProductId: 'tt-1',
      title: 'Tiêu đề cũ',
      description: '<p>cũ</p>',
      tiktokBrandId: null,
      packageWeight: null,
      weightUnit: null,
      packageLength: null,
      packageWidth: null,
      packageHeight: null,
      dimensionUnit: null,
      searchTerms: [],
      keyProductFeatures: [],
      images: [],
      sizeChartUri: null,
      sizeChartTemplateId: null,
      videos: [],
      variants: variants(codes).map((variant) => ({ ...variant, salePrice: { toString: () => '19.99' } })),
    };
    const partialEditProduct = jest.fn().mockResolvedValue({});
    const service = new PodProductEditService(
      { findById: jest.fn().mockResolvedValue(product) } as never,
      {} as never,
      { syncShop: jest.fn().mockResolvedValue(undefined) } as never,
      { buildContext: jest.fn().mockResolvedValue({ shopId: 'ctx' }) } as never,
      { partialEditProduct } as never,
      {} as never,
      {} as never,
      { assertShopAllowed: jest.fn() } as never,
      { withLock: (_key: string, _ttl: number, task: () => Promise<unknown>) => task() } as never,
      { toDetail: jest.fn((value: unknown) => value) } as never,
    );
    jest
      .spyOn(service as unknown as { resolveShopTarget: () => Promise<unknown> }, 'resolveShopTarget')
      .mockResolvedValue({ shopId: 'shop-1' });
    return { service, partialEditProduct };
  }
  const scope = { allShops: true, accountIds: [], shopIds: [] };

  it('🔴 A — sản phẩm 104 biến thể chung một SKU, chỉ sửa tiêu đề ⇒ gửi TikTok, KHÔNG báo trùng, không gửi SKU', async () => {
    const h = build(Array.from({ length: 104 }, () => 'LALAGAGA2610_BSBZ_13092025_99186604'));
    await h.service.update('org-1', 'user-1', 'p-1', { title: 'Tiêu đề mới' }, scope);
    expect(h.partialEditProduct).toHaveBeenCalledTimes(1);
    const body = (h.partialEditProduct.mock.calls[0] as unknown[])[2] as { title?: string; skus?: unknown };
    expect(body.title).toBe('Tiêu đề mới');
    expect(body.skus).toBeUndefined();
  });

  it('🔴 G — đổi SKU sang mã của biến thể khác ⇒ 400 POD_PRODUCT_SKU_DUPLICATE, KHÔNG gọi TikTok', async () => {
    const h = build(['A', 'B']);
    const error = await h.service
      .update('org-1', 'user-1', 'p-1', { skus: [{ tiktokSkuId: 'sku-1', sellerSku: 'B' }] }, scope)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PodProductSkuDuplicateException);
    expect((error as PodProductSkuDuplicateException).getResponse()).toMatchObject({ code: 'POD_PRODUCT_SKU_DUPLICATE' });
    expect(h.partialEditProduct).not.toHaveBeenCalled();
  });

  it('E — đổi SKU sang mã mới ⇒ gửi đúng một SKU với mã mới (cập nhật theo id biến thể, không tạo mới)', async () => {
    const h = build(['A', 'B']);
    await h.service.update('org-1', 'user-1', 'p-1', { skus: [{ tiktokSkuId: 'sku-1', sellerSku: 'A-NEW' }] }, scope);
    const body = (h.partialEditProduct.mock.calls[0] as unknown[])[2] as { skus?: unknown };
    expect(body.skus).toEqual([{ id: 'sku-1', sellerSku: 'A-NEW' }]);
  });
});
