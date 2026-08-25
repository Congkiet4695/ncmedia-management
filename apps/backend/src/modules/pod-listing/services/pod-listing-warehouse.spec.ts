import {
  PodListingPublisherService,
  PodWarehouseResolutionException,
} from './pod-listing-publisher.service';
import type { ResolvedListing } from './pod-listing-resolver.service';

/**
 * Chọn kho lúc **Publish**, theo TỪNG SHOP.
 *
 * 🔴 Kho là dữ liệu của shop, không phải của sản phẩm: cùng một Draft Product đăng lên ba shop
 * là ba kho khác nhau. Draft vì thế không gắn kho và cổng validate cũng không đòi kho — mọi
 * quyết định nằm ở đây, ngay trước khi gọi Create Product.
 */

type Warehouse = { id: string; tiktokWarehouseId: string; name: string; isDefault: boolean };

function buildPayload(warehouse: ResolvedListing['warehouse']): ResolvedListing {
  return { warehouse } as ResolvedListing;
}

function buildService(shop: {
  name?: string;
  defaultWarehouse?: { id: string; tiktokWarehouseId: string; name: string } | null;
  warehouses?: Warehouse[];
} | null) {
  const prisma = {
    podTiktokShop: {
      findFirst: jest.fn().mockResolvedValue(
        shop === null
          ? null
          : {
              name: shop.name ?? 'Playmaker',
              defaultWarehouse: shop.defaultWarehouse ?? null,
              warehouses: shop.warehouses ?? [],
            },
      ),
    },
  };

  const service = new PodListingPublisherService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  // `resolveWarehouse` là chi tiết nội bộ của publisher; test gọi thẳng vì đây chính là luật
  // nghiệp vụ cần khoá lại, không phải một hàm phụ trợ.
  const resolve = (payload: ResolvedListing) =>
    (
      service as unknown as {
        resolveWarehouse: (
          organizationId: string,
          ctx: { shopId: string },
          payload: ResolvedListing,
          log: () => Promise<void>,
        ) => Promise<{ tiktokWarehouseId: string; source: string }>;
      }
    ).resolveWarehouse('org-1', { shopId: 'shop-1' }, payload, () => Promise.resolve());

  return { resolve, prisma };
}

const WH_A: Warehouse = { id: 'wh-a', tiktokWarehouseId: 'TT-A', name: 'Kho A', isDefault: false };
const WH_B: Warehouse = { id: 'wh-b', tiktokWarehouseId: 'TT-B', name: 'Kho B', isDefault: true };
const NONE: ResolvedListing['warehouse'] = { id: null, tiktokWarehouseId: null, name: null };

describe('PodListingPublisherService — chọn kho lúc Publish', () => {
  it('1. Kho của Category Template, khi kho đó THUỘC shop này', async () => {
    const { resolve } = buildService({ warehouses: [WH_A, WH_B] });

    const result = await resolve(
      buildPayload({ id: 'wh-a', tiktokWarehouseId: 'TT-A', name: 'Kho A' }),
    );

    expect(result).toEqual({ tiktokWarehouseId: 'TT-A', source: 'TEMPLATE' });
  });

  it('🔴 Kho của template thuộc SHOP KHÁC ⇒ bỏ qua, dùng cấu hình của shop này', async () => {
    // `warehouse_id` là mã riêng của từng shop — gửi kho shop A sang shop B thì TikTok từ
    // chối cả sản phẩm, mà thông điệp lỗi của họ không nói ra điều đó.
    const { resolve } = buildService({
      defaultWarehouse: { id: 'wh-b', tiktokWarehouseId: 'TT-B', name: 'Kho B' },
      warehouses: [WH_B],
    });

    const result = await resolve(
      buildPayload({ id: 'wh-cua-shop-khac', tiktokWarehouseId: 'TT-X', name: 'Kho lạ' }),
    );

    expect(result).toEqual({ tiktokWarehouseId: 'TT-B', source: 'SHOP_MAPPING' });
  });

  it('2. Warehouse Mapping của shop', async () => {
    const { resolve } = buildService({
      defaultWarehouse: { id: 'wh-a', tiktokWarehouseId: 'TT-A', name: 'Kho A' },
      warehouses: [WH_A, WH_B],
    });

    expect(await resolve(buildPayload(NONE))).toEqual({
      tiktokWarehouseId: 'TT-A',
      source: 'SHOP_MAPPING',
    });
  });

  it('3. Shop chỉ có ĐÚNG MỘT kho ⇒ tự chọn', async () => {
    const { resolve } = buildService({ warehouses: [WH_A] });

    expect(await resolve(buildPayload(NONE))).toEqual({
      tiktokWarehouseId: 'TT-A',
      source: 'ONLY_WAREHOUSE',
    });
  });

  it('4. Nhiều kho ⇒ lấy kho TikTok đánh dấu mặc định', async () => {
    const { resolve } = buildService({ warehouses: [WH_A, WH_B] });

    expect(await resolve(buildPayload(NONE))).toEqual({
      tiktokWarehouseId: 'TT-B',
      source: 'TIKTOK_DEFAULT',
    });
  });

  it('5. Nhiều kho, không kho nào mặc định ⇒ CHỈ shop này hỏng, nói rõ phải làm gì', async () => {
    const { resolve } = buildService({
      warehouses: [WH_A, { ...WH_B, isDefault: false }],
    });

    await expect(resolve(buildPayload(NONE))).rejects.toBeInstanceOf(
      PodWarehouseResolutionException,
    );
    await expect(resolve(buildPayload(NONE))).rejects.toThrow(/kho mặc định/);
  });

  it('5b. Shop chưa đồng bộ kho nào ⇒ báo đi đồng bộ, không im lặng gửi thiếu', async () => {
    const { resolve } = buildService({ warehouses: [] });

    await expect(resolve(buildPayload(NONE))).rejects.toThrow(/chưa có kho nào/);
  });

  it('KHÔNG chặn khi Draft không có kho — đó là trạng thái BÌNH THƯỜNG', async () => {
    const { resolve } = buildService({ warehouses: [WH_A] });

    await expect(resolve(buildPayload(NONE))).resolves.toBeDefined();
  });
});

/**
 * Payload gửi TikTok — **giá và tồn kho của từng SKU**.
 *
 * 🔴 Đây là bước cuối trước khi rời khỏi hệ thống, nên nó phải mang đúng con số mà lưới SKU
 * hiển thị: `price.amount` = giá bán hiệu lực, `list_price` chỉ có khi giá gốc CAO HƠN giá
 * bán, `inventory.warehouse_id` là kho đã quyết theo shop.
 */
describe('PodListingPublisherService — payload gửi TikTok', () => {
  const buildRequest = (variant: Partial<ResolvedListing['variants'][number]>) => {
    const service = new PodListingPublisherService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const payload = {
      title: 'Vintage Sunset Poster',
      description: '<p>hi</p>',
      category: { tiktokCategoryId: '1237008', name: null, path: null },
      brand: { tiktokBrandId: '7082427311584347905', name: 'No brand' },
      attributes: [],
      images: [],
      package: { weight: '0.35', weightUnit: 'POUND' },
      warehouse: { id: null, tiktokWarehouseId: null, name: null },
      shipping: { shippingTemplateId: null, handlingDays: null },
      pricing: null,
      variants: [
        {
          variantName: '8"x12"',
          sellerSku: 'POSTER-8X12',
          barcode: null,
          optionValues: [{ name: 'Size', value: '8"x12"' }],
          salePrice: '13.99',
          retailPrice: '19.99',
          currency: 'USD',
          quantity: 500,
          imageFileId: null,
          sortOrder: 0,
          ...variant,
        },
      ],
      source: {},
    } as unknown as ResolvedListing;

    return (
      service as unknown as {
        buildCreateRequest: (
          payload: ResolvedListing,
          hash: string,
          uris: string[],
          byFileId: Map<string, string>,
          warehouseId: string,
        ) => { skus?: Array<Record<string, never>> };
      }
    ).buildCreateRequest(payload, 'hash', [], new Map(), 'TT-WH-1');
  };

  it('giá bán và giá gạch ngang đi đúng chỗ', () => {
    const sku = buildRequest({}).skus?.[0] as unknown as {
      sellerSku: string;
      price: { amount: string; currency: string };
      listPrice?: { amount: string };
      inventory: Array<{ warehouseId: string; quantity: number }>;
    };

    expect(sku.sellerSku).toBe('POSTER-8X12');
    expect(sku.price).toEqual({ amount: '13.99', currency: 'USD' });
    expect(sku.listPrice).toEqual({ amount: '19.99', currency: 'USD' });
    expect(sku.inventory).toEqual([{ warehouseId: 'TT-WH-1', quantity: 500 }]);
  });

  it('giá gốc KHÔNG cao hơn giá bán ⇒ không gửi list_price (TikTok từ chối)', () => {
    const sku = buildRequest({ retailPrice: null }).skus?.[0] as unknown as {
      listPrice?: { amount: string };
    };

    expect(sku.listPrice).toBeUndefined();
  });
});
