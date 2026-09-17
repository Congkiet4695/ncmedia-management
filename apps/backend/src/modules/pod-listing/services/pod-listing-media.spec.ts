import { PodImageAssetType, PodListingSessionImageType } from '@prisma/client';
import { PodListingResolverService } from './pod-listing-resolver.service';
import type { ResolveContext } from './pod-listing-resolver.service';

/**
 * **Bảng size và video KHÔNG được lẫn vào bộ ảnh sản phẩm.**
 *
 * 🔴 Vì sao bộ test này tồn tại: `ensureImageUris` của publisher đẩy NGUYÊN mảng
 * `payload.images` thành `main_images` của TikTok. Trước thay đổi này, một tấm bảng size lưu
 * cùng bảng ảnh (`imageType = SIZE_CHART`) sẽ đi thẳng vào bộ ảnh sản phẩm — người mua mở
 * trang hàng và thấy một bảng số đo nằm ở vị trí ảnh thứ hai, còn bảng size thật thì trống.
 * Lỗi này không tạo ra exception nào, nên chỉ có test mới giữ được nó.
 */

/** Template tối thiểu để resolver chạy — chỉ những trường nó thực sự đọc. */
function context(images: Array<{ imageType: PodListingSessionImageType; url: string }>): ResolveContext {
  return {
    template: {
      id: 'tpl-1',
      name: 'Tee',
      market: 'US',
      categoryTemplate: {
        tiktokCategoryId: '601226',
        categoryName: 'Tee',
        categoryPath: null,
        attributes: [],
        packageWeight: '300',
        weightUnit: 'GRAM',
        packageLength: null,
        packageWidth: null,
        packageHeight: null,
        dimensionUnit: null,
        warehouse: null,
      },
      descriptionTemplate: { contentHtml: '<p>Mô tả</p>', tokens: [] },
      imageTemplate: { id: 'img-1', items: [] },
      skuTemplate: { items: [], skuPrefix: null, skuSuffix: null, defaultSalePrice: null },
      pricingStrategy: null,
      warehouse: null,
      packageWeight: null,
      weightUnit: null,
      packageLength: null,
      packageWidth: null,
      packageHeight: null,
      dimensionUnit: null,
      shippingTemplateId: null,
      handlingDays: null,
      brandMode: null,
      tiktokBrandId: null,
      brandName: null,
    } as never,
    product: null,
    sessionProduct: {
      id: 'sp-1',
      title: 'Tee nhập tay',
      manualData: null,
      images: images.map((image, index) => ({
        id: `img-${index}`,
        imageUrl: image.url,
        imageType: image.imageType,
        sortOrder: index,
        fileId: null,
        remoteUri: null,
      })),
    } as never,
    shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
  };
}

describe('resolveFromContext — bảng size tách khỏi bộ ảnh sản phẩm', () => {
  const resolver = new PodListingResolverService({} as never);

  it('🔴 ảnh SIZE_CHART KHÔNG lọt vào `images` (main_images của TikTok)', () => {
    const { payload } = resolver.resolveFromContext(
      context([
        { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' },
        { imageType: PodListingSessionImageType.SIZE_CHART, url: 'https://cdn/chart.png' },
        { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/b.png' },
      ]),
    );

    expect(payload.images.map((image) => image.url)).toEqual([
      'https://cdn/a.png',
      'https://cdn/b.png',
    ]);
    expect(payload.images.some((image) => image.url.includes('chart'))).toBe(false);
  });

  it('bảng size đi vào trường RIÊNG `sizeChart`', () => {
    const { payload } = resolver.resolveFromContext(
      context([
        { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' },
        { imageType: PodListingSessionImageType.SIZE_CHART, url: 'https://cdn/chart.png' },
      ]),
    );

    expect(payload.sizeChart?.url).toBe('https://cdn/chart.png');
  });

  it('không có bảng size ⇒ `sizeChart = null` (bỏ hẳn trường khi gửi TikTok)', () => {
    const { payload } = resolver.resolveFromContext(
      context([{ imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' }]),
    );

    expect(payload.sizeChart).toBeNull();
  });

  it('🔴 ảnh DESCRIPTION cũng không lọt vào bộ ảnh — nó đã nằm trong HTML mô tả', () => {
    const { payload } = resolver.resolveFromContext(
      context([
        { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' },
        { imageType: PodListingSessionImageType.DESCRIPTION, url: 'https://cdn/inline.png' },
      ]),
    );

    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].url).toBe('https://cdn/a.png');
  });

  it('ảnh đầu tiên vẫn là ảnh CHÍNH sau khi lọc', () => {
    const { payload } = resolver.resolveFromContext(
      context([
        { imageType: PodListingSessionImageType.SIZE_CHART, url: 'https://cdn/chart.png' },
        { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' },
      ]),
    );

    // Bảng size đứng trước trong dữ liệu nhưng KHÔNG được chiếm vị trí ảnh chính.
    expect(payload.images[0].url).toBe('https://cdn/a.png');
    expect(payload.images[0].assetType).toBe(PodImageAssetType.MAIN_FRONT);
  });

  it('video mặc định null — chỉ có khi người dùng nhập tay', () => {
    const { payload } = resolver.resolveFromContext(
      context([{ imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' }]),
    );

    expect(payload.video).toBeNull();
  });
});
