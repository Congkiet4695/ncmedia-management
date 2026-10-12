import type { TiktokProductDetail } from '../../tiktok-sdk/types/tiktok-product.types';
import { PodProductMapper, stableForHash } from './pod-product.mapper';

/**
 * `payloadHash` KHÔNG được đổi chỉ vì TikTok trả URL ảnh từ shard CDN khác (`p16-…` ↔ `p19-…`).
 *
 * 🔴 Bằng chứng (test/manual/probe-product-payload-diff.manual.ts, dữ liệu thật): so payload đã lưu với
 * payload lấy lại, phần khác nhau DUY NHẤT là `urls` / `thumbUrls` — cùng file ảnh. Hash cũ vì thế luôn
 * đổi ⇒ mọi sản phẩm trong cửa sổ đồng bộ bị ghi lại toàn bộ ở mỗi lượt (TC12).
 */
function detail(
  shard: 'p16' | 'p19',
  overrides: Partial<TiktokProductDetail> = {},
): TiktokProductDetail {
  const url = (path: string) =>
    `https://${shard}-oec-general-useast5.ttcdn-us.com/${path}?t=${shard === 'p16' ? 'a' : 'b'}`;
  return {
    id: '1732733033939571134',
    title: 'Cocteau Twins T-Shirt',
    status: 'ACTIVATE',
    updateTime: 1_791_454_719,
    mainImages: [
      {
        uri: 'tos-useast5-i/abc',
        urls: [url('abc.jpeg')],
        thumbUrls: [url('abc-300.jpeg')],
        width: 800,
        height: 800,
      },
    ],
    skus: [
      {
        id: 'SKU-1',
        sellerSku: 'TEE-BLACK-M',
        price: { salePrice: '19.99', currency: 'USD' },
        salesAttributes: [
          {
            id: 'A1',
            name: 'Color',
            valueName: 'Black',
            skuImg: {
              uri: 'tos-useast5-i/sku',
              urls: [url('sku.jpeg')],
              thumbUrls: [url('sku-300.jpeg')],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('payloadHash — ổn định trước URL ảnh CDN', () => {
  const mapper = new PodProductMapper();
  const hashOf = (payload: TiktokProductDetail) =>
    mapper.toWriteData(payload, payload).product.payloadHash;

  it('🔴 TC12 cùng sản phẩm, chỉ khác shard CDN / query của URL ảnh ⇒ CÙNG hash (lượt sync bỏ qua, không ghi lại)', () => {
    expect(hashOf(detail('p16'))).toBe(hashOf(detail('p19')));
  });

  it('ảnh THẬT SỰ đổi (`uri` khác) ⇒ hash khác ⇒ vẫn ghi', () => {
    const changed = detail('p16');
    (changed.mainImages as Array<{ uri: string }>)[0].uri = 'tos-useast5-i/NEW';
    expect(hashOf(changed)).not.toBe(hashOf(detail('p16')));
  });

  it('dữ liệu sản phẩm đổi (giá, tiêu đề) ⇒ hash khác', () => {
    expect(hashOf(detail('p16', { title: 'Tiêu đề mới' }))).not.toBe(hashOf(detail('p16')));
    const repriced = detail('p16');
    (repriced.skus as Array<{ price: { salePrice: string } }>)[0].price.salePrice = '24.99';
    expect(hashOf(repriced)).not.toBe(hashOf(detail('p16')));
  });

  it('stableForHash chỉ bỏ `urls` / `thumbUrls`, giữ nguyên mọi trường khác (kể cả `uri`)', () => {
    expect(
      stableForHash({ a: 1, urls: ['x'], nested: [{ uri: 'u', thumbUrls: ['y'], width: 2 }] }),
    ).toEqual({
      a: 1,
      nested: [{ uri: 'u', width: 2 }],
    });
  });
});
