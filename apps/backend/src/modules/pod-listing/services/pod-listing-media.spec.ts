import { PodImageAssetType, PodListingSessionImageType } from '@prisma/client';
import { POD_LISTING_MAX_IMAGES } from '../constants/pod-listing.constants';
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

interface TemplateImage {
  url: string;
  fileId?: string;
  assetType?: PodImageAssetType;
}

interface SessionImage {
  imageType: PodListingSessionImageType;
  url: string;
  fileId?: string;
}

/** Template tối thiểu để resolver chạy — chỉ những trường nó thực sự đọc. */
function context(
  images: SessionImage[],
  options: { templateImages?: TemplateImage[]; categorySizeChartFileId?: string | null } = {},
): ResolveContext {
  const templateItems = (options.templateImages ?? []).map((image, index) => ({
    id: `tpl-img-${index}`,
    title: `Mockup ${index + 1}`,
    assetType: image.assetType ?? PodImageAssetType.LIFESTYLE,
    fileId: image.fileId ?? `tpl-file-${index}`,
    imageUrl: image.url,
    imageKey: `key-${index}`,
    width: null,
    height: null,
    isRequired: false,
    tiktokImageUri: null,
    displayOrder: index,
  }));
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
        sizeChartFileId: options.categorySizeChartFileId ?? null,

        sizeChartTiktokImageUri: null,

        sizeChartImageUploadedAt: null,
      },
      descriptionTemplate: { contentHtml: '<p>Mô tả</p>', tokens: [] },
      imageTemplate: { id: 'img-1', items: templateItems },
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
        fileId: image.fileId ?? null,
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

/** N ảnh MAIN riêng của sản phẩm `https://cdn/own-1.png` … */
const own = (count: number): SessionImage[] =>
  Array.from({ length: count }, (_, index) => ({
    imageType: PodListingSessionImageType.MAIN,
    url: `https://cdn/own-${index + 1}.png`,
  }));

/** N ảnh trong Image Template `https://cdn/tpl-1.png` … */
const template = (count: number): TemplateImage[] =>
  Array.from({ length: count }, (_, index) => ({ url: `https://cdn/tpl-${index + 1}.png` }));

/**
 * **Bộ ảnh mẫu BỔ SUNG cho đủ chỗ, không thay thế ảnh người dùng.**
 *
 * 🔴 Trước đây resolver chọn "hoặc ảnh riêng, hoặc bộ mẫu": sản phẩm nhập từ file với 3 ảnh
 * lên sàn với đúng 3 ảnh dù người vận hành đã dựng sẵn bộ 6 mockup. Bảng dưới đây là hợp
 * đồng mới, tính theo `POD_LISTING_MAX_IMAGES` (trần `main_images` của TikTok = 9).
 */
describe('resolveFromContext — Image Template bổ sung ảnh cho đủ chỗ', () => {
  const resolver = new PodListingResolverService({} as never);
  const urls = (images: SessionImage[], templateImages: TemplateImage[]) =>
    resolver
      .resolveFromContext(context(images, { templateImages }))
      .payload.images.map((image) => image.url);

  it.each([
    [0, 8, 8],
    [1, 10, POD_LISTING_MAX_IMAGES],
    [3, 6, 9],
    [5, 10, POD_LISTING_MAX_IMAGES],
    [8, 10, POD_LISTING_MAX_IMAGES],
    [8, 1, 9],
    [9, 10, 9],
    [10, 10, 10],
  ])('%i ảnh riêng + %i ảnh mẫu ⇒ %i ảnh, ảnh riêng đứng trước và nguyên thứ tự', (ownCount, tplCount, expected) => {
    const result = urls(own(ownCount), template(tplCount));

    expect(result).toHaveLength(expected);
    // Ảnh riêng KHÔNG bị ghi đè, KHÔNG bị đổi chỗ, KHÔNG bị cắt ở đây.
    expect(result.slice(0, ownCount)).toEqual(own(ownCount).map((image) => image.url));
    // Phần bổ sung lấy đúng thứ tự của bộ mẫu.
    const appended = Math.max(0, Math.min(tplCount, POD_LISTING_MAX_IMAGES - ownCount));
    expect(result.slice(ownCount)).toEqual(template(appended).map((image) => image.url));
  });

  it('không tự tạo hay nhân đôi ảnh mẫu khi bộ mẫu ít hơn số chỗ trống', () => {
    const result = urls(own(8), template(1));
    expect(result).toEqual([...own(8).map((image) => image.url), 'https://cdn/tpl-1.png']);
    expect(new Set(result).size).toBe(9);
  });

  it('bộ mẫu rỗng ⇒ chỉ ảnh riêng, không lỗi', () => {
    expect(urls(own(3), [])).toEqual(own(3).map((image) => image.url));
  });

  it('🔴 ảnh mẫu trùng URL nhau chỉ được thêm một lần', () => {
    const result = urls(own(2), [
      { url: 'https://cdn/dup.png', fileId: 'f-dup-a' },
      { url: 'https://cdn/dup.png ', fileId: 'f-dup-b' },
      { url: 'https://cdn/other.png', fileId: 'f-other' },
    ]);
    expect(result).toEqual([...own(2).map((image) => image.url), 'https://cdn/dup.png', 'https://cdn/other.png']);
  });

  it('🔴 ảnh mẫu trùng với ảnh người dùng (cùng fileId hoặc cùng URL) không được thêm lại — A,B,C + C,D ⇒ A,B,C,D', () => {
    const result = resolver
      .resolveFromContext(
        context(
          [
            { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/a.png' },
            { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/b.png' },
            { imageType: PodListingSessionImageType.MAIN, url: 'https://cdn/c.png', fileId: 'file-c' },
          ],
          {
            templateImages: [
              { url: 'https://cdn/c-copy.png', fileId: 'file-c' }, // cùng file với C
              { url: 'https://cdn/b.png', fileId: 'file-b' }, // cùng URL với B
              { url: 'https://cdn/d.png', fileId: 'file-d' },
            ],
          },
        ),
      )
      .payload.images.map((image) => image.url);

    expect(result).toEqual(['https://cdn/a.png', 'https://cdn/b.png', 'https://cdn/c.png', 'https://cdn/d.png']);
  });

  it('tấm SIZE_CHART trong bộ mẫu KHÔNG được bổ sung vào bộ ảnh sản phẩm', () => {
    const result = urls(own(1), [
      { url: 'https://cdn/chart.png', assetType: PodImageAssetType.SIZE_CHART },
      { url: 'https://cdn/tpl.png' },
    ]);
    expect(result).toEqual(['https://cdn/own-1.png', 'https://cdn/tpl.png']);
  });

  it('thứ tự sau khi ghép là liên tiếp 0..n-1 và tấm đầu là ảnh bắt buộc', () => {
    const { payload } = resolver.resolveFromContext(context(own(2), { templateImages: template(2) }));
    expect(payload.images.map((image) => image.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(payload.images.map((image) => image.isRequired)).toEqual([true, false, false, false]);
  });
});

/**
 * **Bảng size của Category Template phải lên sàn.**
 *
 * 🔴 `sizeChartFileId` được lưu ở Category Template nhưng resolver chưa từng đọc — Auto
 * Listing từ CSV/XLSX (chỉ có ảnh MAIN) đăng sản phẩm không có bảng size dù template có.
 */
describe('resolveFromContext — nguồn bảng size', () => {
  const resolver = new PodListingResolverService({} as never);

  it('🔴 không có tấm SIZE_CHART riêng ⇒ lấy `sizeChartFileId` của Category Template (Auto Listing)', () => {
    const { payload } = resolver.resolveFromContext(
      context(own(3), { categorySizeChartFileId: 'file-size-chart' }),
    );

    expect(payload.sizeChart).toEqual({ fileId: 'file-size-chart', url: null, tiktokImageUri: null });
    // Bảng size KHÔNG chiếm chỗ trong bộ ảnh sản phẩm.
    expect(payload.images).toHaveLength(3);
  });

  it('tấm SIZE_CHART riêng của sản phẩm thắng bảng size của Category Template', () => {
    const { payload } = resolver.resolveFromContext(
      context(
        [
          ...own(1),
          { imageType: PodListingSessionImageType.SIZE_CHART, url: 'https://cdn/own-chart.png' },
        ],
        { categorySizeChartFileId: 'file-size-chart' },
      ),
    );

    expect(payload.sizeChart?.url).toBe('https://cdn/own-chart.png');
  });

  it('không có ở sản phẩm lẫn Category Template ⇒ lấy tấm SIZE_CHART của Image Template', () => {
    const { payload } = resolver.resolveFromContext(
      context(own(1), {
        templateImages: [
          { url: 'https://cdn/tpl.png' },
          { url: 'https://cdn/tpl-chart.png', fileId: 'file-tpl-chart', assetType: PodImageAssetType.SIZE_CHART },
        ],
      }),
    );

    expect(payload.sizeChart).toEqual({ fileId: 'file-tpl-chart', url: 'https://cdn/tpl-chart.png', tiktokImageUri: null });
    expect(payload.images.map((image) => image.url)).toEqual(['https://cdn/own-1.png', 'https://cdn/tpl.png']);
  });
});
