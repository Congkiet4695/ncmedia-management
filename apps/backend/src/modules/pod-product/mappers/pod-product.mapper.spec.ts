import { PodProductMapper } from './pod-product.mapper';
import type { TiktokProductDetail } from '../../tiktok-sdk/types/tiktok-product.types';

/** Chi tiết sản phẩm mẫu — đúng shape SDK khai báo cho Get Product (product/202309). */
const DETAIL: TiktokProductDetail = {
  id: '1729592969712207008',
  title: 'Unisex Cotton T-Shirt',
  description: '<p>Soft cotton tee</p>',
  status: 'ACTIVATE',
  audit: { status: 'AUDITING' },
  createTime: 1_700_000_000,
  updateTime: 1_700_600_000,
  brand: { id: '7082427311584347905', name: 'NCMedia' },
  categoryChains: [
    { id: '600001', localName: 'Womenswear', isLeaf: false, parentId: '0' },
    { id: '600024', localName: 'Tops', isLeaf: false, parentId: '600001' },
    { id: '601352', localName: 'T-Shirts', isLeaf: true, parentId: '600024' },
  ],
  mainImages: [
    { uri: 'tos-img-1', urls: ['https://cdn/1.jpg'], thumbUrls: ['https://cdn/1-t.jpg'], width: 800, height: 800 },
    { uri: 'tos-img-2', urls: ['https://cdn/2.jpg'] },
  ],
  video: { id: 'v-1', url: 'https://cdn/v.mp4', coverUrl: 'https://cdn/v.jpg', format: 'mp4', size: 1024 },
  packageDimensions: { length: '20', width: '15', height: '5', unit: 'CENTIMETER' },
  packageWeight: { value: '0.35', unit: 'KILOGRAM' },
  productAttributes: [
    { id: '100392', name: 'Material', values: [{ id: '1001', name: 'Cotton' }] },
  ],
  productTags: ['NEW'],
  salesRegions: ['US'],
  skus: [
    {
      id: 'sku-black-l',
      sellerSku: 'TEE-BLK-L',
      price: { currency: 'USD', salePrice: '19.99', taxExclusivePrice: '18.00' },
      listPrice: { amount: '24.99', currency: 'USD' },
      inventory: [
        { warehouseId: 'wh-1', quantity: 10 },
        { warehouseId: 'wh-2', quantity: 5 },
      ],
      salesAttributes: [
        { id: 'a1', name: 'Color', valueId: 'v1', valueName: 'Black', skuImg: { uri: 'sku-img-1', urls: ['https://cdn/blk.jpg'] } },
        { id: 'a2', name: 'Size', valueId: 'v2', valueName: 'L' },
      ],
      statusInfo: { status: 'ACTIVATE' },
    },
    {
      id: 'sku-white-m',
      sellerSku: 'TEE-WHT-M',
      price: { currency: 'USD', salePrice: '15.50' },
      inventory: [{ warehouseId: 'wh-1', quantity: 2 }],
      salesAttributes: [
        { id: 'a1', name: 'Color', valueId: 'v3', valueName: 'White' },
        { id: 'a2', name: 'Size', valueId: 'v4', valueName: 'M' },
      ],
    },
  ],
};

describe('PodProductMapper', () => {
  const mapper = new PodProductMapper();

  describe('toWriteData — sản phẩm', () => {
    it('ánh xạ các trường cơ bản + danh mục lá và đường dẫn danh mục', () => {
      const { product } = mapper.toWriteData(DETAIL, DETAIL);

      expect(product.tiktokProductId).toBe('1729592969712207008');
      expect(product.title).toBe('Unisex Cotton T-Shirt');
      expect(product.status).toBe('ACTIVATE');
      expect(product.auditStatus).toBe('AUDITING');
      // Danh mục LÁ, không phải node đầu tiên.
      expect(product.tiktokCategoryId).toBe('601352');
      expect(product.categoryName).toBe('T-Shirts');
      expect(product.categoryPath).toBe('Womenswear > Tops > T-Shirts');
    });

    it('tổng hợp số liệu từ SKU: số lượng, giá thấp/cao nhất, tổng tồn kho', () => {
      const { product } = mapper.toWriteData(DETAIL, DETAIL);

      expect(product.skuCount).toBe(2);
      expect(product.minPrice?.toString()).toBe('15.5');
      expect(product.maxPrice?.toString()).toBe('19.99');
      expect(product.currency).toBe('USD');
      // 10 + 5 (SKU 1) + 2 (SKU 2)
      expect(product.totalInventory).toBe(17);
    });

    it('giữ cả Unix lẫn Date cho mốc thời gian phía TikTok', () => {
      const { product } = mapper.toWriteData(DETAIL, DETAIL);

      expect(product.tiktokUpdateTime).toBe(1_700_600_000n);
      expect(product.tiktokUpdatedAt?.toISOString()).toBe(
        new Date(1_700_600_000 * 1000).toISOString(),
      );
    });

    it('payload không đổi → hash không đổi; đổi một trường → hash đổi', () => {
      const first = mapper.toWriteData(DETAIL, DETAIL).product.payloadHash;
      const same = mapper.toWriteData(DETAIL, DETAIL).product.payloadHash;
      const changed = mapper.toWriteData(DETAIL, { ...DETAIL, title: 'Đổi tên' }).product
        .payloadHash;

      expect(first).toBe(same);
      expect(changed).not.toBe(first);
    });

    it('🔴 thiếu dữ liệu (sản phẩm rỗng) vẫn ánh xạ được, không ném lỗi', () => {
      const { product, variants, images } = mapper.toWriteData({ id: 'p1' }, { id: 'p1' });

      expect(product.tiktokProductId).toBe('p1');
      expect(product.skuCount).toBe(0);
      expect(product.minPrice).toBeNull();
      expect(variants).toHaveLength(0);
      expect(images).toHaveLength(0);
    });

    it('giá sai định dạng → NULL thay vì làm hỏng cả lượt đồng bộ', () => {
      const { variants } = mapper.toWriteData(
        { ...DETAIL, skus: [{ id: 's', price: { salePrice: 'không-phải-số' } }] },
        DETAIL,
      );

      expect(variants[0].salePrice).toBeNull();
    });
  });

  describe('toWriteData — biến thể & ảnh', () => {
    it('ghép tên biến thể theo đúng thứ tự thuộc tính TikTok trả về', () => {
      const { variants } = mapper.toWriteData(DETAIL, DETAIL);

      expect(variants[0].variantName).toBe('Black / L');
      expect(variants[1].variantName).toBe('White / M');
      expect(variants[0].sellerSku).toBe('TEE-BLK-L');
      expect(variants[0].inventoryTotal).toBe(15);
    });

    it('ảnh chính giữ nguyên thứ tự; ảnh SKU được gắn với đúng SKU', () => {
      const { images } = mapper.toWriteData(DETAIL, DETAIL);

      const mainImages = images.filter((image) => image.variantSkuId === null);
      expect(mainImages.map((image) => image.sortOrder)).toEqual([0, 1]);
      expect(mainImages[0].url).toBe('https://cdn/1.jpg');

      const skuImages = images.filter((image) => image.variantSkuId !== null);
      expect(skuImages).toHaveLength(1);
      expect(skuImages[0].variantSkuId).toBe('sku-black-l');
    });

    it('video được ánh xạ; không có video → mảng rỗng', () => {
      expect(mapper.toWriteData(DETAIL, DETAIL).videos).toHaveLength(1);
      expect(mapper.toWriteData({ ...DETAIL, video: undefined }, DETAIL).videos).toHaveLength(0);
    });
  });

  describe('toCategoryRow / toCategoryAttributeRow', () => {
    it('parentId "0" của TikTok được quy về NULL (node gốc)', () => {
      const row = mapper.toCategoryRow({ id: '600001', parentId: '0', localName: 'Womenswear' });
      expect(row?.parentTiktokId).toBeNull();
    });

    it('node không có id → bỏ qua thay vì tạo bản ghi rác', () => {
      expect(mapper.toCategoryRow({ localName: 'Không id' })).toBeNull();
    });

    it('🔴 đọc đúng trường `isRequried` (sai chính tả ở API gốc của TikTok)', () => {
      const row = mapper.toCategoryAttributeRow({ id: 'a1', name: 'Material', isRequried: true });
      expect(row?.isRequired).toBe(true);
    });
  });
});
