import type { ConfigService } from '@nestjs/config';
import { FulfillmentCatalogItemStatus } from '@prisma/client';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import { SellerwixApiClient } from '../clients/sellerwix-api.client';
import { SellerwixCatalogService } from './sellerwix-catalog.service';
import { SellerwixCredentialService } from './sellerwix-credential.service';

/**
 * **CASE 2 — đồng bộ danh mục Sellerwix: Category → Product → Variant.**
 * Dữ liệu mẫu theo ví dụ trong tài liệu + SKU có thật trong bảng "Sellerwix Variant SKU".
 */

const ACCOUNT = {
  id: 'acc-swx',
  name: 'Sellerwix',
  isActive: true,
  apiKeyEnc: 'api',
  secretEnc: 'pem',
  providerConfig: { storeId: 'store-1', publicKeyId: 'kid' },
  baseUrlOverride: null,
  updatedAt: new Date(),
};

function ok<T>(data: T) {
  return Promise.resolve({ data, requestId: 'r', durationMs: 1, httpStatus: 200 });
}

function build(
  overrides: Partial<Record<keyof SellerwixApiClient, jest.Mock>> = {},
  config: Record<string, unknown> = { 'fulfillment.sellerwix.costCurrency': 'USD' },
) {
  const client = {
    listCategories: jest.fn(() =>
      ok([
        { id: 1, title: "Men's Clothing - T-shirts" },
        { id: 2, title: "Women's Clothing - T-shirts" },
      ]),
    ),
    listCategoryProducts: jest.fn((_ctx: unknown, id: string) =>
      ok(
        id === '1'
          ? [
              {
                sku: 'SW-MD-MPTG',
                title: 'Most Popular Tee',
                img_src: 'https://img/tee.png',
                active: true,
              },
            ]
          : [
              // Cùng sản phẩm ở danh mục thứ hai ⇒ KHÔNG nhân đôi.
              { sku: 'SW-MD-MPTG', title: 'Most Popular Tee', active: true },
              { sku: 'SW-MD-OLD', title: 'Retired Tee', active: false },
            ],
      ),
    ),
    listVariants: jest.fn((_ctx: unknown, sku: string, cursor?: string | null) => {
      if (sku === 'SW-MD-OLD') return ok({ paging: { total: 0, next_page: null }, data: [] });
      return ok(
        cursor
          ? {
              paging: { total: 2, next_page: '' },
              data: [
                {
                  sku: 'SW-MD-MPTG-WH-S',
                  title: 'Most Popular Tee-White-S',
                  active: true,
                  color: { name: 'White', code: '#ffffff' },
                  size: { name: 'S' },
                  cost: 6.65,
                  print_areas: [{ key: 'CF', display_name: 'Front' }],
                },
              ],
            }
          : {
              paging: { total: 2, next_page: 'page-2' },
              data: [
                {
                  sku: 'SW-MD-MPTG-BL-XL',
                  title: 'Most Popular Tee-Black-XL',
                  active: true,
                  color: { name: 'Black', code: '#000000' },
                  size: { name: 'XL' },
                  cost: 6.65,
                  is_rush_service: true,
                  label_support: true,
                  print_areas: [
                    { key: 'CF', display_name: 'Front' },
                    { key: 'FB', display_name: 'Back' },
                  ],
                },
              ],
            },
      );
    }),
    ...overrides,
  } as unknown as SellerwixApiClient;

  const service = new SellerwixCatalogService(
    client,
    new SellerwixCredentialService({
      decrypt: (v: string) => v,
    } as unknown as TiktokEncryptionService),
    { get: (key: string) => config[key] } as unknown as ConfigService,
  );
  return { service, client };
}

describe('SellerwixCatalogService.fetchCatalog', () => {
  it('danh mục, sản phẩm (không trùng), biến thể qua mọi trang next_page; SKU biến thể lưu nguyên văn', async () => {
    const { service } = build();

    const snapshot = await service.fetchCatalog(ACCOUNT);

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.catalogues.map((c) => [c.externalCatalogueId, c.name])).toEqual([
      ['1', "Men's Clothing - T-shirts"],
      ['2', "Women's Clothing - T-shirts"],
    ]);
    expect(snapshot.products.map((p) => [p.externalProductId, p.sku, p.status])).toEqual([
      ['SW-MD-MPTG', 'SW-MD-MPTG', FulfillmentCatalogItemStatus.ACTIVE],
      ['SW-MD-OLD', 'SW-MD-OLD', FulfillmentCatalogItemStatus.INACTIVE],
    ]);
    expect(snapshot.products[0].rawData).toMatchObject({ categories: ['1', '2'] });
    // API không trả đơn vị tiền ⇒ lấy từ cấu hình SELLERWIX_COST_CURRENCY.
    expect(snapshot.products.map((p) => p.currency)).toEqual(['USD', 'USD']);

    expect(snapshot.variants).toHaveLength(2);
    expect(snapshot.variants[0]).toMatchObject({
      externalProductId: 'SW-MD-MPTG',
      externalVariantId: 'SW-MD-MPTG-BL-XL',
      sku: 'SW-MD-MPTG-BL-XL',
      name: 'Most Popular Tee-Black-XL',
      color: 'Black',
      size: 'XL',
      price: '6.65',
      status: FulfillmentCatalogItemStatus.ACTIVE,
    });
    // print_areas / rush / label_support giữ trong raw_data cho luồng gửi đơn.
    expect(snapshot.variants[0].rawData).toMatchObject({
      is_rush_service: true,
      print_areas: [{ key: 'CF' }, { key: 'FB' }],
    });
    expect(snapshot.variants[1].sku).toBe('SW-MD-MPTG-WH-S');
  });

  it('thiếu cấu hình đơn vị tiền ⇒ currency NULL (không đoán)', async () => {
    const { service } = build({}, {});

    const snapshot = await service.fetchCatalog(ACCOUNT);

    expect(snapshot.products.every((p) => p.currency === null)).toBe(true);
  });

  it('một lượt đọc lỗi ⇒ warnings (bước archive sẽ bị bỏ qua), không vứt dữ liệu đã đọc', async () => {
    const { service } = build({
      listVariants: jest.fn(() =>
        Promise.reject(
          new FulfillmentClientError(FulfillmentErrorClass.SERVER, 'Internal Server Error', 500),
        ),
      ),
    });

    const snapshot = await service.fetchCatalog(ACCOUNT);

    expect(snapshot.products).toHaveLength(2);
    expect(snapshot.warnings.length).toBeGreaterThan(0);
    expect(snapshot.warnings[0]).toMatch(/đọc THIẾU/);
  });
});
