import { callArg } from '../../../../testing/mock-call.util';
import { RedisService } from '../../../../redis/redis.service';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoCatalogService } from './mango-catalog.service';
import { MangoCredentialService } from './mango-credential.service';
import type { MangoAccountCredentialRef } from './mango-credential.service';
import type { MangoProduct, MangoVariation } from '../types/mango-api.types';

const ACCOUNT: MangoAccountCredentialRef = {
  id: 'prov-1',
  organizationId: 'org-1',
  name: 'Mango US',
  isActive: true,
  apiKeyEnc: 'enc:key',
  baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
};

/** Credential giả lập — phần chọn khoá đã có spec riêng. */
const credentials = {
  buildContext: () => ({ apiKey: 'key', baseUrl: 'https://example.com' }),
} as unknown as MangoCredentialService;

/** Sinh `count` sản phẩm giả để dựng các trang. */
function products(count: number, offset = 0): MangoProduct[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `MP-${offset + index + 1}`,
    sku: `SKU-${offset + index + 1}`,
    name: `Product ${offset + index + 1}`,
    catalog_name: 'Apparel',
    is_active: true,
    variations_count: 3,
  }));
}

function variations(count: number, offset = 0): MangoVariation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `MV-${offset + index + 1}`,
    sku: `VAR-${offset + index + 1}`,
    name: `Variant ${offset + index + 1}`,
    color: 'Black',
    size: 'L',
    is_available: true,
  }));
}

function build(options: { cached?: string | null; redisFails?: boolean } = {}) {
  const get = jest.fn().mockImplementation(() => {
    if (options.redisFails) return Promise.reject(new Error('redis down'));
    return Promise.resolve(options.cached ?? null);
  });
  const set = jest.fn().mockImplementation(() => {
    if (options.redisFails) return Promise.reject(new Error('redis down'));
    return Promise.resolve('OK');
  });
  const keys = jest.fn().mockResolvedValue(['k1', 'k2']);
  const del = jest.fn().mockResolvedValue(2);

  const redis = { client: { get, set, keys, del } } as unknown as RedisService;
  const listProducts = jest.fn();
  const listVariations = jest.fn();
  const client = { listProducts, listVariations } as unknown as MangoApiClient;

  const service = new MangoCatalogService(redis, client, credentials);
  return { service, get, set, keys, del, listProducts, listVariations };
}

/** Dựng một response một trang theo đúng shape `{ items, pagination }` của Mango. */
function page<T>(items: T[], pageNo: number, pages: number, total: number, limit = 100) {
  return {
    data: { items, pagination: { total, page: pageNo, limit, pages } },
    durationMs: 5,
  };
}

describe('MangoCatalogService — phân trang', () => {
  describe('listProducts', () => {
    it('duyệt HẾT các trang, không dừng ở trang đầu', async () => {
      const { service, listProducts } = build();
      // 250 sản phẩm / 100 mỗi trang = 3 trang.
      listProducts
        .mockResolvedValueOnce(page(products(100, 0), 1, 3, 250))
        .mockResolvedValueOnce(page(products(100, 100), 2, 3, 250))
        .mockResolvedValueOnce(page(products(50, 200), 3, 3, 250));

      const result = await service.listProducts(ACCOUNT);

      expect(listProducts).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(250);
      expect(result[0].id).toBe('MP-1');
      expect(result[249].id).toBe('MP-250');
    });

    it('dùng `limit` LỚN NHẤT tài liệu cho phép (100) và tăng `page` tuần tự', async () => {
      const { service, listProducts } = build();
      listProducts
        .mockResolvedValueOnce(page(products(100, 0), 1, 2, 150))
        .mockResolvedValueOnce(page(products(50, 100), 2, 2, 150));

      await service.listProducts(ACCOUNT);

      const firstQuery = callArg<{ page: number; limit: number }>(listProducts, 0, 1);
      const secondQuery = callArg<{ page: number; limit: number }>(listProducts, 1, 1);
      expect(firstQuery).toMatchObject({ page: 1, limit: 100 });
      expect(secondQuery).toMatchObject({ page: 2, limit: 100 });
    });

    it('một trang duy nhất thì chỉ gọi một lần', async () => {
      const { service, listProducts } = build();
      listProducts.mockResolvedValueOnce(page(products(12), 1, 1, 12));

      const result = await service.listProducts(ACCOUNT);

      expect(listProducts).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(12);
    });

    it('dừng khi gặp trang RỖNG dù metadata báo còn rất nhiều', async () => {
      // `pages` và `total` đều báo còn nhiều nhưng trang 2 rỗng ⇒ phải dừng, không lặp vô ích.
      const { service, listProducts } = build();
      listProducts
        .mockResolvedValueOnce(page(products(100), 1, 99, 9999))
        .mockResolvedValueOnce(page([], 2, 99, 9999));

      const result = await service.listProducts(ACCOUNT);

      expect(listProducts).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(100);
    });

    it('dừng khi đã gom đủ `total` dù `pages` báo còn trang', async () => {
      const { service, listProducts } = build();
      listProducts.mockResolvedValueOnce(page(products(30), 1, 5, 30));

      const result = await service.listProducts(ACCOUNT);

      expect(listProducts).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(30);
    });

    it('không vỡ khi nhà cung cấp KHÔNG trả đối tượng pagination', async () => {
      const { service, listProducts } = build();
      listProducts.mockResolvedValueOnce({ data: { items: products(7) }, durationMs: 5 });

      const result = await service.listProducts(ACCOUNT);

      expect(result).toHaveLength(7);
    });

    it('truyền từ khoá tìm kiếm vào MỌI trang', async () => {
      const { service, listProducts } = build();
      listProducts
        .mockResolvedValueOnce(page(products(100), 1, 2, 150))
        .mockResolvedValueOnce(page(products(50, 100), 2, 2, 150));

      await service.listProducts(ACCOUNT, 'tee');

      for (let index = 0; index < listProducts.mock.calls.length; index += 1) {
        expect(callArg<{ name?: string }>(listProducts, index, 1)).toMatchObject({ name: 'tee' });
      }
    });

    it('trả về `variationsCount` để giao diện biết trước quy mô bước sau', async () => {
      const { service, listProducts } = build();
      listProducts.mockResolvedValueOnce(page(products(1), 1, 1, 1));

      const [product] = await service.listProducts(ACCOUNT);

      expect(product.variationsCount).toBe(3);
    });
  });

  describe('listVariations', () => {
    it('duyệt HẾT các trang biến thể', async () => {
      const { service, listVariations } = build();
      listVariations
        .mockResolvedValueOnce(page(variations(100, 0), 1, 2, 118))
        .mockResolvedValueOnce(page(variations(18, 100), 2, 2, 118));

      const result = await service.listVariations(ACCOUNT, 'MP-1');

      expect(listVariations).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(118);
    });

    it('dùng `limit` hợp lệ theo tài liệu và truyền đúng productId', async () => {
      const { service, listVariations } = build();
      listVariations.mockResolvedValueOnce(page(variations(5), 1, 1, 5));

      await service.listVariations(ACCOUNT, 'MP-42');

      expect(callArg<string>(listVariations, 0, 1)).toBe('MP-42');
      expect(callArg<{ page: number; limit: number }>(listVariations, 0, 2)).toMatchObject({
        page: 1,
        limit: 100,
      });
    });

    it('trả `sku` của biến thể — giá trị gửi trong items[].sku khi tạo đơn', async () => {
      const { service, listVariations } = build();
      listVariations.mockResolvedValueOnce(page(variations(1), 1, 1, 1));

      const [variation] = await service.listVariations(ACCOUNT, 'MP-1');

      expect(variation.sku).toBe('VAR-1');
    });
  });

  describe('cache', () => {
    it('có cache thì KHÔNG gọi API nhà cung cấp', async () => {
      const cached = JSON.stringify([{ id: 'MP-9', name: 'Cached' }]);
      const { service, listProducts } = build({ cached });

      const result = await service.listProducts(ACCOUNT);

      expect(listProducts).not.toHaveBeenCalled();
      expect(result[0].id).toBe('MP-9');
    });

    it('ghi cache TTL 5 phút sau khi gom đủ mọi trang', async () => {
      const { service, set, listProducts } = build();
      listProducts
        .mockResolvedValueOnce(page(products(100), 1, 2, 150))
        .mockResolvedValueOnce(page(products(50, 100), 2, 2, 150));

      await service.listProducts(ACCOUNT);

      // Chỉ ghi MỘT lần, và ghi danh sách ĐẦY ĐỦ chứ không phải từng trang.
      expect(set).toHaveBeenCalledTimes(1);
      const payload = callArg<string>(set, 0, 1);
      const ttl = callArg<number>(set, 0, 3);
      expect(ttl).toBe(300);
      expect((JSON.parse(payload) as unknown[]).length).toBe(150);
    });

    it('khoá cache tách theo TÀI KHOẢN', async () => {
      const { service, get, listProducts } = build();
      listProducts.mockResolvedValue(page(products(1), 1, 1, 1));

      await service.listProducts(ACCOUNT);
      await service.listProducts({ ...ACCOUNT, id: 'prov-2' });

      const firstKey = callArg<string>(get, 0, 0);
      const secondKey = callArg<string>(get, 1, 0);
      expect(firstKey).toContain('prov-1');
      expect(secondKey).toContain('prov-2');
    });

    it('Redis hỏng KHÔNG làm hỏng tính năng — vẫn duyệt hết trang và trả dữ liệu', async () => {
      const { service, listProducts } = build({ redisFails: true });
      listProducts
        .mockResolvedValueOnce(page(products(100), 1, 2, 150))
        .mockResolvedValueOnce(page(products(50, 100), 2, 2, 150));

      const result = await service.listProducts(ACCOUNT);

      expect(result).toHaveLength(150);
    });
  });

  describe('invalidate', () => {
    it('xoá toàn bộ khoá cache của tài khoản', async () => {
      const { service, keys, del } = build();

      await service.invalidate('prov-1');

      expect(keys).toHaveBeenCalledWith(expect.stringContaining('prov-1'));
      expect(del).toHaveBeenCalledWith('k1', 'k2');
    });
  });
});
