import { Injectable, Logger } from '@nestjs/common';
import {
  TIKTOK_BRAND_PAGE_SIZE,
  TIKTOK_CATEGORY_VERSION,
  TIKTOK_IMAGE_USE_CASE,
  TIKTOK_PRODUCT_MAX_PAGES_PER_RUN,
  TIKTOK_PRODUCT_SAVE_MODE,
  TIKTOK_PRODUCT_SEARCH_PAGE_SIZE,
  TIKTOK_SDK_CONTENT_TYPE,
  type TiktokImageUseCase,
} from './tiktok-sdk.constants';
import { TikTokSdkService } from './tiktok-sdk.service';
import type {
  TiktokBrand,
  TiktokCategoryAttribute,
  TiktokCategoryNode,
  TiktokCreateProductRequest,
  TiktokCreateProductResult,
  TiktokEditProductRequest,
  TiktokEditProductResult,
  TiktokProductDetail,
  TiktokProductSearchFilter,
  TiktokProductSummary,
  TiktokUploadedImage,
} from './types/tiktok-product.types';
import type {
  TiktokPage,
  TiktokSdkResult,
  TiktokShopContext,
} from './types/tiktok-shop-context.type';

/**
 * TiktokProductApiService — lớp bọc nhóm API **Product** của TikTok Shop.
 *
 * 🔴 Đây là ranh giới: module nghiệp vụ (`pod-product`) chỉ gọi service này và chỉ thấy
 * kiểu dữ liệu của `types/tiktok-product.types.ts`. Không service nghiệp vụ nào biết
 * TikTok có bao nhiêu version API, tên lớp SDK là gì, hay `shop_cipher` đặt ở đâu.
 *
 * Version đang dùng (chọn theo những gì SDK cung cấp — xem `tiktok-sdk.constants.ts`):
 *  - Search Products: **202502** (bản mới nhất; có `update_time_ge` cho sync tăng dần)
 *  - Get Product, Categories, Attributes, Brands: **202309**
 *  - Create Product, Edit Product (Publish), Upload Image, Delete: **202309**
 *
 * Toàn bộ phân trang dùng `page_token` do TikTok cấp — hàm `*All` tự đi hết mọi trang.
 */
@Injectable()
export class TiktokProductApiService {
  private readonly logger = new Logger(TiktokProductApiService.name);

  constructor(private readonly sdk: TikTokSdkService) {}

  // ---------------------------------------------------------------------------
  // Product
  // ---------------------------------------------------------------------------

  /**
   * Search Products — MỘT trang.
   *
   * Trả về bản TÓM TẮT (id, title, status, skus, thời điểm tạo/sửa). Ảnh, mô tả, thuộc
   * tính, brand, category **không** có ở đây ⇒ muốn đủ dữ liệu phải gọi `getProduct`.
   */
  async searchProducts(
    ctx: TiktokShopContext,
    params: {
      pageSize?: number;
      pageToken?: string;
      filter?: TiktokProductSearchFilter;
    } = {},
  ): Promise<TiktokSdkResult<TiktokPage<TiktokProductSummary>>> {
    const pageSize = params.pageSize ?? TIKTOK_PRODUCT_SEARCH_PAGE_SIZE;

    const result = await this.sdk.execute<{
      products?: TiktokProductSummary[];
      nextPageToken?: string;
      totalCount?: number;
    }>({
      endpoint: 'PRODUCT_SEARCH',
      invoke: () =>
        this.sdk.api.ProductV202502Api.ProductsSearchPost(
          pageSize,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          params.pageToken,
          ctx.shopCipher,
          params.filter ?? {},
        ),
    });

    return {
      data: {
        items: result.data.products ?? [],
        nextPageToken: result.data.nextPageToken,
        totalCount: result.data.totalCount,
      },
      requestId: result.requestId,
    };
  }

  /**
   * Search Products — đi HẾT mọi trang.
   *
   * 🔴 Điều kiện dừng cố ý dư thừa (giống `MangoCatalogService`): hết `next_page_token`,
   * trang rỗng, hoặc chạm trần số trang. Chạm trần ⇒ **ghi cảnh báo**, không im lặng cắt
   * dữ liệu — danh sách cụt mà không ai biết là lỗi tệ hơn nhiều so với chạy lâu.
   */
  async searchAllProducts(
    ctx: TiktokShopContext,
    filter: TiktokProductSearchFilter = {},
    onPage?: (page: TiktokProductSummary[], pageIndex: number) => Promise<void>,
  ): Promise<TiktokProductSummary[]> {
    const all: TiktokProductSummary[] = [];
    let pageToken: string | undefined;

    for (let pageIndex = 0; pageIndex < TIKTOK_PRODUCT_MAX_PAGES_PER_RUN; pageIndex++) {
      const { data } = await this.searchProducts(ctx, { pageToken, filter });
      if (data.items.length === 0) return all;

      all.push(...data.items);
      if (onPage) await onPage(data.items, pageIndex);

      if (!data.nextPageToken) return all;
      pageToken = data.nextPageToken;
    }

    this.logger.warn({
      module: 'tiktok-sdk',
      operation: 'product.searchAll',
      organizationId: ctx.organizationId,
      shopId: ctx.shopId,
      maxPages: TIKTOK_PRODUCT_MAX_PAGES_PER_RUN,
      collected: all.length,
      msg: 'Chạm trần số trang khi quét sản phẩm — dữ liệu có thể chưa đủ',
    });
    return all;
  }

  /** Get Product — bản ĐẦY ĐỦ của một sản phẩm (ảnh, video, brand, category, thuộc tính, SKU). */
  async getProduct(
    ctx: TiktokShopContext,
    productId: string,
    options: { returnUnderReviewVersion?: boolean; returnDraftVersion?: boolean; locale?: string } = {},
  ): Promise<TiktokSdkResult<TiktokProductDetail>> {
    return this.sdk.execute<TiktokProductDetail>({
      endpoint: 'PRODUCT_GET',
      invoke: () =>
        this.sdk.api.ProductV202309Api.ProductsProductIdGet(
          productId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          options.returnUnderReviewVersion,
          options.returnDraftVersion,
          options.locale,
          ctx.shopCipher,
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Ghi dữ liệu lên TikTok (Sprint 4 — Bulk Listing)
  // ---------------------------------------------------------------------------

  /**
   * Upload Product Image — đẩy MỘT tấm ảnh lên TikTok, nhận `uri` để gắn vào sản phẩm.
   *
   * 🔴 Đây là API **multipart**, không phải JSON: SDK gửi qua `formData` và phần chữ ký chỉ
   * ký path + query (`generate-sign.ts` bỏ qua body khi multipart), nên không được tự dựng
   * request tay. Buffer phải kèm `filename` + `contentType`, thiếu là TikTok từ chối file.
   *
   * Ảnh không gắn với shop nào: TikTok cấp `uri` ở phạm vi app, dùng lại được cho mọi shop —
   * đúng thứ Bulk Listing cần, vì một bộ mockup dùng cho hàng nghìn listing ở nhiều shop.
   */
  async uploadImage(
    ctx: TiktokShopContext,
    image: { buffer: Buffer; fileName: string; contentType: string },
    useCase: TiktokImageUseCase = TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE,
  ): Promise<TiktokSdkResult<TiktokUploadedImage>> {
    return this.sdk.execute<TiktokUploadedImage>({
      endpoint: 'PRODUCT_IMAGE_UPLOAD',
      invoke: () =>
        this.sdk.api.ProductV202309Api.ImagesUploadPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          {
            value: image.buffer,
            options: { filename: image.fileName, contentType: image.contentType },
          },
          useCase,
        ),
    });
  }

  /**
   * Create Product — tạo sản phẩm trên shop đích.
   *
   * 🔴 Mặc định `save_mode = AS_DRAFT`: sản phẩm vào mục Draft của Seller Center, KHÔNG lên
   * sàn và KHÔNG vào hàng chờ duyệt. Muốn đăng bán phải truyền `LISTING` tường minh — để
   * không ai publish nhầm chỉ vì quên một tham số.
   *
   * `idempotencyKey` do phía gọi cấp (hash của payload): thử lại sau lỗi mạng sẽ nhận lại
   * đúng sản phẩm cũ thay vì đẻ ra bản trùng trên shop thật.
   */
  async createProduct(
    ctx: TiktokShopContext,
    request: TiktokCreateProductRequest,
  ): Promise<TiktokSdkResult<TiktokCreateProductResult>> {
    const body = {
      categoryVersion: TIKTOK_CATEGORY_VERSION,
      saveMode: TIKTOK_PRODUCT_SAVE_MODE.AS_DRAFT,
      ...request,
    };

    return this.sdk.execute<TiktokCreateProductResult>({
      endpoint: 'PRODUCT_CREATE',
      invoke: () =>
        this.sdk.api.ProductV202309Api.ProductsPost(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          body,
        ),
    });
  }

  /**
   * **Publish** — đưa một sản phẩm ĐÃ TỒN TẠI trên shop vào hàng chờ duyệt.
   *
   * 🔴 Vì sao là Edit Product chứ không phải một endpoint "publish": TikTok Shop **không có**
   * endpoint publish cho sản phẩm local. Toàn bộ dòng `ProductV2023..V2026` của SDK chỉ có
   * Create / Edit / Partial Edit / Activate / Deactivate; `save_mode` mới là thứ quyết định
   * sản phẩm nằm ở Draft hay vào hàng chờ duyệt. (`Publish Global Product` là API khác, chỉ
   * dành cho global product của seller xuyên biên giới — không dùng ở đây.)
   *
   * 🔴 Gọi hàm này KHÔNG tạo sản phẩm mới: `productId` là id của Draft đã có, TikTok cập
   * nhật đúng bản ghi đó và trả lại chính id ấy. Đây là hàng rào chống trùng sản phẩm — mọi
   * đường publish trong hệ thống đều phải đi qua đây, không qua `createProduct`.
   *
   * ⚠️ Edit Product là **full edit**: trường nào không gửi sẽ bị ghi đè thành rỗng. Phía gọi
   * phải gửi NGUYÊN payload đã tạo ra Draft, không gửi một tập con.
   */
  async publishProduct(
    ctx: TiktokShopContext,
    productId: string,
    request: TiktokEditProductRequest,
  ): Promise<TiktokSdkResult<TiktokEditProductResult>> {
    const body = {
      categoryVersion: TIKTOK_CATEGORY_VERSION,
      ...request,
      // Đặt SAU phần spread: `LISTING` là toàn bộ ý nghĩa của lời gọi này, không cho phía
      // gọi vô tình ghi đè bằng `AS_DRAFT` rồi tưởng đã publish.
      saveMode: TIKTOK_PRODUCT_SAVE_MODE.LISTING,
    };

    return this.sdk.execute<TiktokEditProductResult>({
      endpoint: 'PRODUCT_PUBLISH',
      invoke: () =>
        this.sdk.api.ProductV202309Api.ProductsProductIdPut(
          productId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          body,
        ),
    });
  }

  /**
   * Delete Products — xoá sản phẩm khỏi shop.
   *
   * Dùng để **dọn dẹp**: draft tạo nhầm (chạy thử, job lỗi) phải xoá được từ hệ thống thay
   * vì bắt người vận hành vào Seller Center xoá tay từng cái.
   */
  async deleteProducts(
    ctx: TiktokShopContext,
    productIds: string[],
  ): Promise<TiktokSdkResult<{ errors?: Array<{ code?: number; message?: string }> }>> {
    return this.sdk.execute<{ errors?: Array<{ code?: number; message?: string }> }>({
      endpoint: 'PRODUCT_DELETE',
      invoke: () =>
        this.sdk.api.ProductV202309Api.ProductsDelete(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          ctx.shopCipher,
          { productIds },
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Danh mục / Thương hiệu / Thuộc tính
  // ---------------------------------------------------------------------------

  /** Get Categories — trả về TOÀN BỘ cây danh mục trong một lần (API không phân trang). */
  async getCategories(
    ctx: TiktokShopContext,
    options: { locale?: string; keyword?: string; categoryVersion?: string; listingPlatform?: string } = {},
  ): Promise<TiktokSdkResult<TiktokCategoryNode[]>> {
    const result = await this.sdk.execute<{ categories?: TiktokCategoryNode[] }>({
      endpoint: 'PRODUCT_CATEGORIES_GET',
      invoke: () =>
        this.sdk.api.ProductV202309Api.CategoriesGet(
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          options.locale,
          options.keyword,
          options.categoryVersion ?? TIKTOK_CATEGORY_VERSION,
          options.listingPlatform,
          undefined,
          ctx.shopCipher,
        ),
    });
    return { data: result.data.categories ?? [], requestId: result.requestId };
  }

  /** Get Category Attributes — bộ thuộc tính (và giá trị hợp lệ) của MỘT danh mục. */
  async getCategoryAttributes(
    ctx: TiktokShopContext,
    categoryId: string,
    options: { locale?: string; categoryVersion?: string } = {},
  ): Promise<TiktokSdkResult<TiktokCategoryAttribute[]>> {
    const result = await this.sdk.execute<{ attributes?: TiktokCategoryAttribute[] }>({
      endpoint: 'PRODUCT_CATEGORY_ATTRIBUTES_GET',
      invoke: () =>
        this.sdk.api.ProductV202309Api.CategoriesCategoryIdAttributesGet(
          categoryId,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          options.locale,
          options.categoryVersion ?? TIKTOK_CATEGORY_VERSION,
          ctx.shopCipher,
        ),
    });
    return { data: result.data.attributes ?? [], requestId: result.requestId };
  }

  /** Get Brands — MỘT trang. */
  async getBrands(
    ctx: TiktokShopContext,
    params: { pageSize?: number; pageToken?: string; categoryId?: string; brandName?: string } = {},
  ): Promise<TiktokSdkResult<TiktokPage<TiktokBrand>>> {
    const result = await this.sdk.execute<{
      brands?: TiktokBrand[];
      nextPageToken?: string;
      totalCount?: number;
    }>({
      endpoint: 'PRODUCT_BRANDS_GET',
      invoke: () =>
        this.sdk.api.ProductV202309Api.BrandsGet(
          params.pageSize ?? TIKTOK_BRAND_PAGE_SIZE,
          ctx.accessToken,
          TIKTOK_SDK_CONTENT_TYPE,
          params.categoryId,
          undefined,
          params.brandName,
          params.pageToken,
          undefined,
          ctx.shopCipher,
        ),
    });

    return {
      data: {
        items: result.data.brands ?? [],
        nextPageToken: result.data.nextPageToken,
        totalCount: result.data.totalCount,
      },
      requestId: result.requestId,
    };
  }

  /** Get Brands — đi HẾT mọi trang (cùng nguyên tắc dừng với `searchAllProducts`). */
  async getAllBrands(
    ctx: TiktokShopContext,
    params: { categoryId?: string } = {},
  ): Promise<TiktokBrand[]> {
    const all: TiktokBrand[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < TIKTOK_PRODUCT_MAX_PAGES_PER_RUN; page++) {
      const { data } = await this.getBrands(ctx, { pageToken, categoryId: params.categoryId });
      if (data.items.length === 0) return all;

      all.push(...data.items);
      if (!data.nextPageToken) return all;
      pageToken = data.nextPageToken;
    }

    this.logger.warn({
      module: 'tiktok-sdk',
      operation: 'brand.getAll',
      organizationId: ctx.organizationId,
      collected: all.length,
      msg: 'Chạm trần số trang khi quét thương hiệu — dữ liệu có thể chưa đủ',
    });
    return all;
  }
}
