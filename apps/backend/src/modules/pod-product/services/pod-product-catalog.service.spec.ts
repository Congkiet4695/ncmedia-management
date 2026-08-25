import {
  POD_TIKTOK_NO_BRAND_ID,
  POD_TIKTOK_NO_BRAND_NAME,
  isNoBrandName,
} from '../constants/pod-product.constants';
import { PodProductCatalogService } from './pod-product-catalog.service';

/**
 * Đồng bộ Brand — trọng tâm là **"No brand" luôn tồn tại**.
 *
 * 🔴 Vì sao đáng một bộ test riêng: "No brand" là lựa chọn mặc định của gần như mọi mặt hàng
 * POD. Thiếu nó thì Category Template không có gì để chọn và listing không đăng được — cổng
 * validate đòi `brand_id`. Mà `Get Brands` thì KHÔNG phải lúc nào cũng liệt kê nó.
 */

interface BrandRow {
  shopId: string;
  tiktokBrandId: string;
  name: string | null;
  isNoBrand: boolean;
  isSystem: boolean;
}

const TARGET = { id: 'shop-1', organizationId: 'org-1' } as never;

/** Prisma giả: giữ bảng brand trong bộ nhớ, đủ để quan sát upsert và findFirst. */
function buildService(apiBrands: Array<{ id?: string; name?: string }>) {
  const rows: BrandRow[] = [];

  const prisma = {
    podProductBrand: {
      upsert: jest.fn(({ where, create, update }: never) => {
        const key = (where as { shopId_tiktokBrandId: { tiktokBrandId: string } })
          .shopId_tiktokBrandId.tiktokBrandId;
        const existing = rows.find((row) => row.tiktokBrandId === key);
        if (existing) Object.assign(existing, update);
        // `isSystem` / `isNoBrand` có `@default(false)` trong schema — bản giả phải áp cùng
        // mặc định đó, không thì test đọc `undefined` và tưởng là lỗi của service.
        else {
          const row = create as unknown as Partial<BrandRow>;
          rows.push({ ...row, isNoBrand: row.isNoBrand ?? false, isSystem: row.isSystem ?? false } as BrandRow);
        }
        return Promise.resolve({});
      }),
      findFirst: jest.fn(({ where }: { where: { isNoBrand?: boolean } }) =>
        Promise.resolve(where.isNoBrand ? (rows.find((row) => row.isNoBrand) ?? null) : null),
      ),
    },
  };

  const productApi = { getAllBrands: jest.fn().mockResolvedValue(apiBrands) };
  // `buildContext` chỉ cần token hợp lệ và một chuỗi cipher — không có request nào rời máy.
  const tokenService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue({ ok: true, accessToken: 'token' }),
  };
  const encryption = { decrypt: jest.fn().mockReturnValue('cipher') };

  const service = new PodProductCatalogService(
    prisma as never,
    {} as never,
    {} as never,
    productApi as never,
    tokenService as never,
    encryption as never,
  );

  return { service, rows };
}

describe('isNoBrandName', () => {
  it.each(['No brand', 'No Brand', 'no brand', 'NoBrand', '  NO  BRAND '])(
    'nhận diện "%s" là No brand',
    (name) => {
      expect(isNoBrandName(name)).toBe(true);
    },
  );

  it.each(['Nike', 'Brandon', null, undefined, ''])('không nhận nhầm "%s"', (name) => {
    expect(isNoBrandName(name)).toBe(false);
  });
});

describe('PodProductCatalogService — đồng bộ Brand', () => {
  it('TikTok KHÔNG trả về No brand ⇒ hệ thống tự tạo bản ghi', async () => {
    const { service, rows } = buildService([{ id: '111', name: 'Nike' }]);

    await service.syncShopBrands(TARGET);

    const noBrand = rows.find((row) => row.isNoBrand);
    expect(noBrand).toBeDefined();
    expect(noBrand?.tiktokBrandId).toBe(POD_TIKTOK_NO_BRAND_ID);
    expect(noBrand?.name).toBe(POD_TIKTOK_NO_BRAND_NAME);
    // Đánh dấu là bản ghi hệ thống — màn hình Brands nói rõ để không ai đi tìm nó trên TikTok.
    expect(noBrand?.isSystem).toBe(true);
  });

  it('TikTok CÓ trả về No brand ⇒ dùng bản ghi thật, không đẻ thêm bản hệ thống', async () => {
    const { service, rows } = buildService([
      { id: '111', name: 'Nike' },
      { id: '999', name: 'No Brand' },
    ]);

    await service.syncShopBrands(TARGET);

    const noBrands = rows.filter((row) => row.isNoBrand);
    expect(noBrands).toHaveLength(1);
    expect(noBrands[0].tiktokBrandId).toBe('999');
    expect(noBrands[0].isSystem).toBe(false);
  });

  it('lần đồng bộ sau TikTok trả về No brand ⇒ bản ghi hệ thống được nhường chỗ', async () => {
    const { service, rows } = buildService([{ id: '111', name: 'Nike' }]);
    await service.syncShopBrands(TARGET);
    expect(rows.find((row) => row.isNoBrand)?.isSystem).toBe(true);

    // Lần hai: API liệt kê "No brand" với CHÍNH id toàn cầu đó.
    const second = buildService([{ id: POD_TIKTOK_NO_BRAND_ID, name: 'No Brand' }]);
    second.rows.push({
      shopId: 'shop-1',
      tiktokBrandId: POD_TIKTOK_NO_BRAND_ID,
      name: POD_TIKTOK_NO_BRAND_NAME,
      isNoBrand: true,
      isSystem: true,
    });
    await second.service.syncShopBrands(TARGET);

    const row = second.rows.find((item) => item.tiktokBrandId === POD_TIKTOK_NO_BRAND_ID);
    expect(row?.isNoBrand).toBe(true);
    expect(row?.isSystem).toBe(false);
  });

  it('brand thiếu id bị bỏ qua, không tạo bản ghi rác', async () => {
    const { service, rows } = buildService([{ name: 'Không có id' }]);

    await service.syncShopBrands(TARGET);

    // Chỉ còn đúng bản ghi No brand do hệ thống tạo.
    expect(rows).toHaveLength(1);
    expect(rows[0].isNoBrand).toBe(true);
  });
});
