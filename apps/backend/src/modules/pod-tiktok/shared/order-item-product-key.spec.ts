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

  it('thiếu Product ID ⇒ NO_PRODUCT_ID; thiếu cả Seller SKU lẫn SKU ID ⇒ NO_SKU_ID', () => {
    const resolved = resolveItemProductKeys(
      SHOP,
      [item({ id: 'a', productId: null }), item({ id: 'b', skuId: null })],
      [variant()],
    );
    expect(resolved.get('a')?.productKeyIssue).toBe('NO_PRODUCT_ID');
    expect(resolved.get('b')?.productKeyIssue).toBe('NO_SKU_ID');
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

  it('findById: dòng rỗng nhận Seller SKU từ danh mục (một truy vấn, lọc tổ chức + shop của đơn); dòng có sẵn giữ nguyên', async () => {
    const { repo, prisma } = build([
      { tiktokSkuId: '1732716272490942940', sellerSku: 'dung2740', product: { shopId: SHOP, tiktokProductId: '1732716254750544348' } },
    ]);
    const order = await repo.findById('org-1', 'order-1');
    expect(order?.items[0]).toMatchObject({ sellerSku: 'dung2740', sellerSkuSource: 'CATALOG', productKeyIssue: null });
    expect(order?.items[1]).toMatchObject({ sellerSku: 'SELLER-2', sellerSkuSource: 'ORDER' });
    expect(prisma.podProductVariant.findMany).toHaveBeenCalledTimes(1);
    const where = (prisma.podProductVariant.findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(where.where).toMatchObject({
      organizationId: 'org-1',
      deletedAt: null,
      product: { organizationId: 'org-1', deletedAt: null, shopId: { in: [SHOP] } },
    });
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
});
