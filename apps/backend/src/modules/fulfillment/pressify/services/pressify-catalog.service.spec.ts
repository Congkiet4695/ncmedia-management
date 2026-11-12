import { Logger } from '@nestjs/common';
import { FulfillmentCatalogItemStatus } from '@prisma/client';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import type { PressifyApiClient } from '../clients/pressify-api.client';
import type { PressifyAllProductsResponse, PressifyVariant } from '../types/pressify-api.types';
import { PressifyCatalogService, tierPrice } from './pressify-catalog.service';
import type { PressifyAccountCredentialRef } from './pressify-credential.service';

/**
 * **Danh mục Pressify → bản sao chung.** Dữ liệu mẫu chép đúng DẠNG response thật của GET /all-product
 * (2026-11-11): `variant.id = null`, hai giá mỗi bậc (`shipping_type` 0/1), SKU rỗng / null, field giá nội bộ.
 */

function variant(over: Partial<PressifyVariant> & { variant_id: number }): PressifyVariant {
  return {
    id: null,
    product_id: 1,
    sku: `USG5000UL-Black-${over.variant_id}`,
    style: 'T-shirt',
    color: 'Black',
    hex: '#25282A',
    size: 'L',
    active: 1,
    // Giá NỘI BỘ — không bao giờ được dùng làm giá vốn.
    price: '2.7',
    basecost: '5.79',
    landed_cost: '4.30',
    product_prices: [
      { tier_id: 11, price: '5.79', shipping_type: 0 },
      { tier_id: 11, price: '5.79', shipping_type: 1 },
      { tier_id: 13, price: '5.39', shipping_type: 0 },
      { tier_id: 13, price: '5.39', shipping_type: 1 },
      { tier_id: 14, price: '4.99', shipping_type: 0 },
      { tier_id: 14, price: '4.99', shipping_type: 1 },
    ],
    ...over,
  };
}

const CATALOG: PressifyAllProductsResponse = {
  data: [
    {
      id: 1,
      name: 'Unisex T-shirt G5000',
      style: 'T-shirt',
      status: 1,
      mockup_src: 'https://cdn.pressify/g5000.jpg',
      accessories: [
        { name: 'Thank You Card', accessory_items: [{ tier_id: '14', code: 'TKB', fee: '0.50' }] },
      ],
      variants: [
        variant({ variant_id: 100, size: 'S' }),
        variant({ variant_id: 102, size: 'L' }),
        // Biến thể đã ngừng bán.
        variant({ variant_id: 103, size: 'XL', active: 0 }),
      ],
    },
    {
      id: 9,
      name: 'Poster',
      style: 'Poster',
      status: 1,
      variants: [
        // SKU RỖNG và NULL — vẫn đặt hàng được bằng variant_id ⇒ phải được đồng bộ.
        variant({
          variant_id: 3183,
          product_id: 9,
          sku: '',
          style: 'Poster',
          color: 'White',
          size: '27x40',
        }),
        variant({
          variant_id: 3184,
          product_id: 9,
          sku: null,
          style: 'Poster',
          color: 'White',
          size: '16x24',
        }),
      ],
    },
  ],
  tiers: { '11': 'Silver', '12': 'Gold', '13': 'Platinum', '14': 'Diamond' },
};

function account(tierId?: string): PressifyAccountCredentialRef {
  return {
    id: 'acc-psf',
    name: 'Pressify',
    isActive: true,
    apiKeyEnc: 'enc:key',
    providerConfig: tierId === undefined ? null : { tierId },
    baseUrlOverride: null,
  };
}

function build(data: unknown) {
  const listAllProducts = jest.fn(() =>
    data instanceof Error
      ? Promise.reject(data)
      : Promise.resolve({ data, requestId: 'r', durationMs: 1, httpStatus: 200 }),
  );
  return {
    service: new PressifyCatalogService({ listAllProducts } as unknown as PressifyApiClient),
    listAllProducts,
  };
}

describe('PressifyCatalogService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('Định danh = id sản phẩm / variant_id (KHÔNG phải SKU); MỘT lời gọi, không phân trang', async () => {
    const { service, listAllProducts } = build(CATALOG);

    const snapshot = await service.fetchCatalog(account());

    expect(listAllProducts).toHaveBeenCalledTimes(1);
    expect(snapshot.apiCalls).toBe(1);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.products.map((product) => product.externalProductId)).toEqual(['1', '9']);
    expect(snapshot.variants.map((item) => item.externalVariantId)).toEqual([
      '100',
      '102',
      '103',
      '3183',
      '3184',
    ]);
    expect(snapshot.variants.every((item) => ['1', '9'].includes(item.externalProductId))).toBe(
      true,
    );
  });

  it('Biến thể KHÔNG có SKU (rỗng / null) vẫn được đồng bộ — SKU lưu nguyên văn là chuỗi rỗng, không bịa', async () => {
    const { service } = build(CATALOG);

    const snapshot = await service.fetchCatalog(account());

    const poster = snapshot.variants.filter((item) => item.externalProductId === '9');
    expect(poster.map((item) => [item.externalVariantId, item.sku])).toEqual([
      ['3183', ''],
      ['3184', ''],
    ]);
    expect(poster[0].name).toBe('White / 27x40');
  });

  it('Danh mục suy từ `style` (trường thật) — Pressify không có thực thể danh mục', async () => {
    const { service } = build(CATALOG);

    const snapshot = await service.fetchCatalog(account());

    expect(snapshot.catalogues.map((catalogue) => catalogue.externalCatalogueId)).toEqual([
      'T-shirt',
      'Poster',
    ]);
    expect(snapshot.products.map((product) => product.externalCatalogueId)).toEqual([
      'T-shirt',
      'Poster',
    ]);
  });

  it('Có khai bậc giá ⇒ giá biến thể = giá của ĐÚNG bậc đó (tiền USD); KHÔNG dùng basecost/price nội bộ', async () => {
    const { service } = build(CATALOG);

    const platinum = await service.fetchCatalog(account('13'));
    const diamond = await service.fetchCatalog(account('14'));

    expect(platinum.variants[0].price).toBe('5.39');
    expect(diamond.variants[0].price).toBe('4.99');
    // `basecost` 5.79 / `price` 2.7 là giá nội bộ (tài liệu: "not what you pay").
    expect([...platinum.variants, ...diamond.variants].some((item) => item.price === '2.7')).toBe(
      false,
    );
    expect(platinum.products.every((product) => product.currency === 'USD')).toBe(true);
  });

  it('Chưa khai bậc giá ⇒ giá biến thể để TRỐNG (không đoán)', async () => {
    const { service } = build(CATALOG);
    const snapshot = await service.fetchCatalog(account());
    expect(snapshot.variants.every((item) => item.price === null)).toBe(true);
  });

  it('Biến thể active=0 ⇒ INACTIVE; còn lại ACTIVE', async () => {
    const { service } = build(CATALOG);
    const snapshot = await service.fetchCatalog(account());
    const byId = new Map(snapshot.variants.map((item) => [item.externalVariantId, item.status]));
    expect(byId.get('103')).toBe(FulfillmentCatalogItemStatus.INACTIVE);
    expect(byId.get('102')).toBe(FulfillmentCatalogItemStatus.ACTIVE);
  });

  it('Payload sản phẩm không nhân đôi mảng biến thể; payload biến thể giữ style của sản phẩm (kiểm DTG)', async () => {
    const { service } = build(CATALOG);
    const snapshot = await service.fetchCatalog(account());
    expect(snapshot.products[0].rawData).not.toHaveProperty('variants');
    expect(snapshot.variants[0].rawData).toMatchObject({
      variant_id: 100,
      product_style: 'T-shirt',
    });
  });

  it('variant_id trùng ⇒ giữ bản đầu + cảnh báo (lượt đồng bộ PARTIAL ⇒ không archive)', async () => {
    const { service } = build({
      data: [
        {
          id: 1,
          style: 'T-shirt',
          variants: [variant({ variant_id: 100 }), variant({ variant_id: 100, size: 'XL' })],
        },
      ],
      tiers: CATALOG.tiers,
    });
    const snapshot = await service.fetchCatalog(account());
    expect(snapshot.variants).toHaveLength(1);
    expect(snapshot.warnings.join(' ')).toContain('variant_id 100 xuất hiện hai lần');
  });

  it('Danh mục RỖNG ⇒ cảnh báo (KHÔNG archive cả bản sao)', async () => {
    const { service } = build({ data: [], tiers: {} });
    const snapshot = await service.fetchCatalog(account());
    expect(snapshot.warnings).toHaveLength(1);
  });

  it('Response sai định dạng ⇒ ném lỗi (lượt đồng bộ FAILED, bản sao cũ giữ nguyên)', async () => {
    const { service } = build({ message: 'maintenance' });
    await expect(service.fetchCatalog(account())).rejects.toThrow('không đúng định dạng');
  });

  it('Lỗi API (mạng / 5xx) ⇒ ném nguyên lỗi', async () => {
    const { service } = build(
      new FulfillmentClientError(FulfillmentErrorClass.SERVER, 'boom', 502),
    );
    await expect(service.fetchCatalog(account())).rejects.toBeInstanceOf(FulfillmentClientError);
  });

  it('tierPrice: ưu tiên shipping_type 0, bậc không tồn tại ⇒ null', () => {
    const item = variant({ variant_id: 1 });
    expect(tierPrice(item, '14')).toBe('4.99');
    expect(tierPrice(item, '12')).toBeNull();
    expect(
      tierPrice(
        { ...item, product_prices: [{ tier_id: 14, price: 'abc', shipping_type: 0 }] },
        '14',
      ),
    ).toBeNull();
  });
});
