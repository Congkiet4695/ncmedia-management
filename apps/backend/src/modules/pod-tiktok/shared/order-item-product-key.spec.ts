import { PodOrderRepository } from '../repositories/pod-order.repository';
import {
  needsCatalogLookup,
  resolveItemProductKeys,
  type CatalogVariantRow,
  type ItemKeyInput,
} from './order-item-product-key';

/**
 * Khoá sản phẩm của dòng đơn — ca thật 2026-10-21: đơn 577629614737560461 (poster 27x40) có `seller_sku = ""`
 * trong đơn TikTok, còn biến thể cùng Product ID + SKU ID trong danh mục Products đã có Seller SKU `dung2740`.
 */
const SHOP = 'shop-1';
const item = (over: Partial<ItemKeyInput> = {}): ItemKeyInput => ({
  id: 'item-1',
  productId: '1732716254750544348',
  skuId: '1732716272490942940',
  sellerSku: '',
  ...over,
});
const variant = (over: Partial<CatalogVariantRow> = {}): CatalogVariantRow => ({
  shopId: SHOP,
  tiktokProductId: '1732716254750544348',
  tiktokSkuId: '1732716272490942940',
  sellerSku: 'dung2740',
  ...over,
});

describe('resolveItemProductKeys', () => {
  it('đơn rỗng Seller SKU + danh mục có ĐÚNG MỘT Seller SKU cho cùng shop/Product ID/SKU ID ⇒ CATALOG', () => {
    expect(resolveItemProductKeys(SHOP, [item()], [variant()]).get('item-1')).toEqual({
      sellerSku: 'dung2740',
      sellerSkuSource: 'CATALOG',
      productKeyIssue: null,
    });
  });

  it('đơn CÓ Seller SKU ⇒ dùng nguyên văn, không bao giờ ghi đè bằng danh mục', () => {
    const resolved = resolveItemProductKeys(SHOP, [item({ sellerSku: 'FROM-ORDER' })], [variant()]);
    expect(resolved.get('item-1')).toMatchObject({ sellerSku: 'FROM-ORDER', sellerSkuSource: 'ORDER' });
  });

  it.each([
    ['biến thể chưa đồng bộ', [] as CatalogVariantRow[], 'VARIANT_NOT_SYNCED'],
    ['biến thể có nhưng TikTok cũng rỗng', [variant({ sellerSku: null }), variant({ sellerSku: '  ' })], 'SELLER_SKU_EMPTY_ON_TIKTOK'],
    ['nhiều Seller SKU khác nhau ⇒ không tự chọn', [variant(), variant({ sellerSku: 'other' })], 'SELLER_SKU_AMBIGUOUS'],
    ['biến thể của SHOP KHÁC không được dùng', [variant({ shopId: 'shop-2' })], 'VARIANT_NOT_SYNCED'],
    ['cùng SKU ID nhưng Product ID khác', [variant({ tiktokProductId: 'OTHER' })], 'VARIANT_NOT_SYNCED'],
  ])('%s ⇒ %s, không có khoá', (_label, catalog, issue) => {
    expect(resolveItemProductKeys(SHOP, [item()], catalog).get('item-1')).toEqual({
      sellerSku: null,
      sellerSkuSource: null,
      productKeyIssue: issue,
    });
  });

  it('trùng lặp CÙNG một Seller SKU (khoảng trắng) vẫn là duy nhất', () => {
    const resolved = resolveItemProductKeys(SHOP, [item()], [variant(), variant({ sellerSku: ' dung2740 ' })]);
    expect(resolved.get('item-1')).toMatchObject({ sellerSku: 'dung2740', sellerSkuSource: 'CATALOG' });
  });

  it('thiếu SKU ID ⇒ NO_SKU_ID kể cả khi dòng có Seller SKU (giữ Seller SKU để hiển thị)', () => {
    const resolved = resolveItemProductKeys(SHOP, [item({ skuId: null, sellerSku: 'SELLER-1' })], []);
    expect(resolved.get('item-1')).toEqual({ sellerSku: 'SELLER-1', sellerSkuSource: 'ORDER', productKeyIssue: 'NO_SKU_ID' });
  });

  it('thiếu Product ID ⇒ NO_PRODUCT_ID; thiếu cả Seller SKU lẫn SKU ID ⇒ NO_SKU_ID', () => {
    const resolved = resolveItemProductKeys(
      SHOP,
      [item({ id: 'a', productId: null }), item({ id: 'b', skuId: null })],
      [variant()],
    );
    expect(resolved.get('a')?.productKeyIssue).toBe('NO_PRODUCT_ID');
    expect(resolved.get('b')?.productKeyIssue).toBe('NO_SKU_ID');
  });

  it('đơn CÓ Seller SKU, danh mục chưa đồng bộ biến thể ⇒ vẫn đủ khoá (ORDER)', () => {
    expect(resolveItemProductKeys(SHOP, [item({ sellerSku: 'FROM-ORDER' })], []).get('item-1')).toEqual({
      sellerSku: 'FROM-ORDER',
      sellerSkuSource: 'ORDER',
      productKeyIssue: null,
    });
  });

  it.each([
    ['null', null],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
  ])('Seller SKU của đơn là %s ⇒ coi như thiếu, tra danh mục', (_label, sellerSku) => {
    expect(needsCatalogLookup(item({ sellerSku }))).toBe(true);
    expect(resolveItemProductKeys(SHOP, [item({ sellerSku })], [variant()]).get('item-1')).toMatchObject({
      sellerSku: 'dung2740',
      sellerSkuSource: 'CATALOG',
    });
  });

  it('nhiều biến thể cùng sản phẩm, Seller SKU khác nhau ⇒ mỗi dòng lấy ĐÚNG biến thể của nó, không lấy chéo', () => {
    const catalog = [
      variant({ tiktokSkuId: 'SKU-S', sellerSku: 'POSTER-S' }),
      variant({ tiktokSkuId: 'SKU-M', sellerSku: 'POSTER-M' }),
      variant({ tiktokSkuId: 'SKU-L', sellerSku: null }),
    ];
    const resolved = resolveItemProductKeys(
      SHOP,
      [
        item({ id: 's', skuId: 'SKU-S' }),
        item({ id: 'm', skuId: 'SKU-M' }),
        item({ id: 'l', skuId: 'SKU-L' }),
        item({ id: 'm2', skuId: 'SKU-M' }),
      ],
      catalog,
    );
    expect(resolved.get('s')?.sellerSku).toBe('POSTER-S');
    expect(resolved.get('m')?.sellerSku).toBe('POSTER-M');
    expect(resolved.get('m2')?.sellerSku).toBe('POSTER-M');
    // Biến thể L rỗng trên TikTok ⇒ báo lỗi, KHÔNG mượn Seller SKU của S/M.
    expect(resolved.get('l')).toEqual({ sellerSku: null, sellerSkuSource: null, productKeyIssue: 'SELLER_SKU_EMPTY_ON_TIKTOK' });
  });

  it('Seller SKU đặt bổ sung SAU khi đơn đã đồng bộ ⇒ có hiệu lực ngay ở lần đọc kế tiếp (khôi phục lúc đọc)', () => {
    const before = resolveItemProductKeys(SHOP, [item()], [variant({ sellerSku: null })]);
    expect(before.get('item-1')?.productKeyIssue).toBe('SELLER_SKU_EMPTY_ON_TIKTOK');
    const after = resolveItemProductKeys(SHOP, [item()], [variant({ sellerSku: 'SET-LATER' })]);
    expect(after.get('item-1')).toEqual({ sellerSku: 'SET-LATER', sellerSkuSource: 'CATALOG', productKeyIssue: null });
  });

  it('chỉ tra danh mục cho dòng thiếu Seller SKU nhưng có Product ID + SKU ID', () => {
    expect(needsCatalogLookup(item())).toBe(true);
    expect(needsCatalogLookup(item({ sellerSku: 'X' }))).toBe(false);
    expect(needsCatalogLookup(item({ productId: null }))).toBe(false);
    expect(needsCatalogLookup(item({ skuId: null }))).toBe(false);
  });
});

describe('PodOrderRepository gắn khoá sản phẩm lúc đọc', () => {
  function build(variants: unknown[]) {
    const order = {
      id: 'order-1',
      shopId: SHOP,
      items: [
        { id: 'item-1', productId: '1732716254750544348', skuId: '1732716272490942940', sellerSku: '' },
        { id: 'item-2', productId: 'P2', skuId: 'S2', sellerSku: 'SELLER-2' },
      ],
    };
    const prisma = {
      podOrder: { findFirst: jest.fn().mockResolvedValue(order) },
      podProductVariant: { findMany: jest.fn().mockResolvedValue(variants) },
    };
    return { repo: new PodOrderRepository(prisma as never), prisma };
  }

  it('findById: dòng rỗng nhận Seller SKU từ danh mục (một truy vấn tra, lọc tổ chức + shop của đơn); dòng có sẵn giữ nguyên', async () => {
    const { repo, prisma } = build([
      { tiktokSkuId: '1732716272490942940', sellerSku: 'dung2740', product: { shopId: SHOP, tiktokProductId: '1732716254750544348' } },
    ]);
    const order = await repo.findById('org-1', 'order-1');
    expect(order?.items[0]).toMatchObject({ sellerSku: 'dung2740', sellerSkuSource: 'CATALOG', productKeyIssue: null });
    expect(order?.items[1]).toMatchObject({ sellerSku: 'SELLER-2', sellerSkuSource: 'ORDER' });
    expect(prisma.podProductVariant.findMany).toHaveBeenCalledTimes(1);
    const [query] = prisma.podProductVariant.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(query.where).toMatchObject({
      organizationId: 'org-1',
      deletedAt: null,
      product: { organizationId: 'org-1', deletedAt: null, shopId: { in: [SHOP] } },
    });
  });

  it('đồng bộ Products rồi mở lại đơn ⇒ đọc lại thấy Seller SKU mới; dữ liệu đơn đã lưu KHÔNG bị ghi đè', async () => {
    const { repo, prisma } = build([
      { tiktokSkuId: '1732716272490942940', sellerSku: null, product: { shopId: SHOP, tiktokProductId: '1732716254750544348' } },
    ]);
    const first = await repo.findById('org-1', 'order-1');
    expect(first?.items[0]).toMatchObject({ sellerSku: null, productKeyIssue: 'SELLER_SKU_EMPTY_ON_TIKTOK' });

    prisma.podProductVariant.findMany.mockResolvedValue([
      { tiktokSkuId: '1732716272490942940', sellerSku: 'SYNCED-LATER', product: { shopId: SHOP, tiktokProductId: '1732716254750544348' } },
    ]);
    const reopened = await repo.findById('org-1', 'order-1');
    expect(reopened?.items[0]).toMatchObject({ sellerSku: 'SYNCED-LATER', sellerSkuSource: 'CATALOG', productKeyIssue: null });
    expect(reopened?.items[1]).toMatchObject({ sellerSku: 'SELLER-2', sellerSkuSource: 'ORDER' });
    // Khôi phục chỉ ở lúc ĐỌC: mock chỉ có `findFirst`/`findMany` — một lệnh ghi bất kỳ lên đơn sẽ ném lỗi ở đây.
    expect(prisma.podOrder.findFirst).toHaveBeenCalledTimes(2);
  });

  it('không có dòng nào cần tra ⇒ KHÔNG truy vấn danh mục', async () => {
    const { repo, prisma } = build([]);
    prisma.podOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      shopId: SHOP,
      items: [{ id: 'item-2', productId: 'P2', skuId: 'S2', sellerSku: 'SELLER-2' }],
    });
    await repo.findById('org-1', 'order-1');
    expect(prisma.podProductVariant.findMany).not.toHaveBeenCalled();
  });

  it('không dòng nào có khoá Seller SKU lẫn SKU ID ⇒ KHÔNG truy vấn danh mục', async () => {
    const { repo, prisma } = build([]);
    prisma.podOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      shopId: SHOP,
      items: [{ id: 'item-3', productId: 'P3', skuId: null, sellerSku: '' }],
    });
    await repo.findById('org-1', 'order-1');
    expect(prisma.podProductVariant.findMany).not.toHaveBeenCalled();
  });
});
