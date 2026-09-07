import {
  POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID,
  isNoBrandName,
} from '../constants/pod-product.constants';
import { PodProductCatalogService } from './pod-product-catalog.service';

/**
 * Đồng bộ Brand TOÀN CỤC.
 *
 * 🔴 Bộ test này đảo chiều so với bản trước. Trước đây nó canh gác việc hệ thống **tự tạo**
 * một bản ghi "No brand" khi `Get Brands` không liệt kê — và chính hành vi đó là lỗi: bản
 * ghi bịa mang một `brand_id` viết cứng chưa hề được TikTok xác nhận, nên sản phẩm lên sàn
 * mang tên một thương hiệu người dùng không chọn.
 *
 * Nay bảng thương hiệu chỉ chứa **đúng những gì TikTok trả về**, và "No brand" là một trạng
 * thái của template (`PodBrandMode.NONE`), không phải một dòng dữ liệu.
 */

interface BrandRow {
  tiktokBrandId: string;
  name: string | null;
  isNoBrand: boolean;
  isSystem: boolean;
}

/** Ngữ cảnh gọi TikTok — shop nguồn chỉ cho mượn token, không để lại dấu vết trong dữ liệu. */
const CTX = { accessToken: 'token', shopCipher: 'cipher', shopId: 'shop-1' } as never;

/** Prisma giả: giữ bảng brand trong bộ nhớ, đủ để quan sát upsert. */
function buildService(apiBrands: Array<{ id?: string; name?: string }>) {
  const rows: BrandRow[] = [];

  const prisma = {
    podProductBrand: {
      upsert: jest.fn(({ where, create, update }: never) => {
        const key = (where as { provider_tiktokBrandId: { tiktokBrandId: string } })
          .provider_tiktokBrandId.tiktokBrandId;
        const existing = rows.find((row) => row.tiktokBrandId === key);
        if (existing) Object.assign(existing, update);
        else {
          const row = create as unknown as Partial<BrandRow>;
          rows.push({
            ...row,
            isNoBrand: row.isNoBrand ?? false,
            isSystem: row.isSystem ?? false,
          } as BrandRow);
        }
        return Promise.resolve({});
      }),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
  };

  const productApi = { getAllBrands: jest.fn().mockResolvedValue(apiBrands) };

  const service = new PodProductCatalogService(
    prisma as never,
    {} as never,
    productApi as never,
    {} as never,
    {} as never,
  );

  return { service, rows, prisma };
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

describe('PodProductCatalogService — đồng bộ Brand toàn cục', () => {
  it('🔴 TikTok KHÔNG trả về "No brand" ⇒ hệ thống KHÔNG được tự bịa bản ghi nào', async () => {
    const { service, rows } = buildService([{ id: '111', name: 'Nike' }]);

    await service.syncGlobalBrands(CTX);

    // Đúng một brand — của TikTok. Không có dòng "No brand" nào được sinh thêm.
    expect(rows).toHaveLength(1);
    expect(rows[0].tiktokBrandId).toBe('111');
    expect(rows.some((row) => row.isSystem)).toBe(false);
  });

  it('🔴 KHÔNG bao giờ ghi id "No brand" viết cứng vào bảng thương hiệu', async () => {
    const { service, rows } = buildService([{ id: '111', name: 'Nike' }]);

    await service.syncGlobalBrands(CTX);

    expect(
      rows.some((row) => row.tiktokBrandId === POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID),
    ).toBe(false);
  });

  it('TikTok CÓ trả về "No brand" ⇒ lưu đúng bản ghi thật và đánh dấu `isNoBrand`', async () => {
    const { service, rows } = buildService([
      { id: '111', name: 'Nike' },
      { id: '999', name: 'No Brand' },
    ]);

    await service.syncGlobalBrands(CTX);

    const noBrands = rows.filter((row) => row.isNoBrand);
    expect(noBrands).toHaveLength(1);
    expect(noBrands[0].tiktokBrandId).toBe('999');
    expect(noBrands[0].isSystem).toBe(false);
  });

  it('brand thiếu id bị bỏ qua, không tạo bản ghi rác', async () => {
    const { service, rows } = buildService([{ name: 'Không có id' }]);

    await service.syncGlobalBrands(CTX);

    expect(rows).toHaveLength(0);
  });

  it('idempotent: chạy hai lượt liên tiếp KHÔNG nhân đôi bản ghi', async () => {
    const { service, rows } = buildService([
      { id: '111', name: 'Nike' },
      { id: '222', name: 'Adidas' },
    ]);

    await service.syncGlobalBrands(CTX);
    await service.syncGlobalBrands(CTX);

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.tiktokBrandId === '111')).toHaveLength(1);
  });
});
