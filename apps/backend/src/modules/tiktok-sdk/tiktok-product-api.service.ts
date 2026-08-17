import { Injectable, Logger } from '@nestjs/common';
import {
  TIKTOK_BRAND_PAGE_SIZE,
  TIKTOK_PRODUCT_MAX_PAGES_PER_RUN,
  TIKTOK_PRODUCT_SEARCH_PAGE_SIZE,
  TIKTOK_SDK_CONTENT_TYPE,
} from './tiktok-sdk.constants';
import { TikTokSdkService } from './tiktok-sdk.service';
import type {
  TiktokBrand,
  TiktokCategoryAttribute,
  TiktokCategoryNode,
  TiktokProductDetail,
  TiktokProductSearchFilter,
  TiktokProductSummary,
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
          options.categoryVersion,
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
          options.categoryVersion,
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
