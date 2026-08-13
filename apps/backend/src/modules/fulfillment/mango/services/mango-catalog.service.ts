import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../redis/redis.service';
import { MangoApiClient } from '../clients/mango-api.client';
import {
  MANGO_MAX_PAGES_PER_FETCH,
  MANGO_MAX_PAGE_LIMIT,
} from '../constants/mango.constants';
import { MangoCredentialService } from './mango-credential.service';
import type { MangoAccountCredentialRef } from './mango-credential.service';
import type { MangoPagination, MangoProduct, MangoVariation } from '../types/mango-api.types';

/** Sản phẩm nhà cung cấp, đã chuẩn hoá cho giao diện chọn ánh xạ. */
export interface ProviderCatalogProduct {
  id: string;
  sku: string | null;
  name: string;
  catalogName: string | null;
  basePrice: string | null;
  currency: string | null;
  imageUrl: string | null;
  isActive: boolean;
  /** Số biến thể nhà cung cấp báo — giúp người dùng biết trước quy mô danh sách bước sau. */
  variationsCount: number | null;
}

/** Biến thể nhà cung cấp — `sku` là giá trị sẽ gửi trong `items[].sku` khi tạo đơn. */
export interface ProviderCatalogVariation {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  isAvailable: boolean;
}

/** Một trang đã đọc — đủ để vòng lặp quyết định có đi tiếp hay không. */
interface FetchedPage<T> {
  items: T[];
  pagination?: MangoPagination;
}

/**
 * MangoCatalogService — đọc TOÀN BỘ danh mục sản phẩm/biến thể của nhà cung cấp.
 *
 * 🔴 KHÔNG hardcode sản phẩm hay SKU nào. Danh mục lấy trực tiếp từ hai endpoint có trong
 * tài liệu: `GET /products` và `GET /products/{id}/variations`.
 *
 * **Phân trang.** Cả hai endpoint dùng phân trang THEO TRANG (`page` + `limit`) và trả về
 * `pagination { total, page, limit, pages }`. Không có cursor, không có `has_more`.
 * Service duyệt từ trang 1 tới `pagination.pages` và gộp lại, dùng `limit` LỚN NHẤT mà tài
 * liệu cho phép để giảm số request. Đọc đúng một trang đầu là nguyên nhân danh mục bị thiếu.
 *
 * Điều kiện dừng (bất kỳ điều nào tới trước) — cố ý dư thừa để một trường sai từ nhà cung
 * cấp không biến thành vòng lặp vô hạn hay danh sách cụt:
 *   1. Đã đọc đủ `pagination.pages` trang.
 *   2. Trang trả về rỗng.
 *   3. Đã gom đủ `pagination.total` bản ghi.
 *   4. Chạm trần `MANGO_MAX_PAGES_PER_FETCH` (ghi log CẢNH BÁO).
 *
 * **Cache 5 phút** trong Redis vì màn hình ánh xạ mở/đóng liên tục và danh mục xưởng in gần
 * như tĩnh. Khoá cache gắn với TÀI KHOẢN — hai tài khoản Mango có danh mục khác nhau.
 * Redis hỏng KHÔNG được làm hỏng tính năng: mọi lỗi cache đều bỏ qua và gọi thẳng API.
 */
@Injectable()
export class MangoCatalogService {
  private readonly logger = new Logger(MangoCatalogService.name);

  /** 5 phút theo yêu cầu nghiệp vụ. */
  private static readonly CACHE_TTL_SECONDS = 300;
  private static readonly CACHE_PREFIX = 'fulfillment:mango:catalog';

  constructor(
    private readonly redis: RedisService,
    private readonly client: MangoApiClient,
    private readonly credentials: MangoCredentialService,
  ) {}

  /**
   * TOÀN BỘ sản phẩm của nhà cung cấp (mọi trang).
   * `search` lọc theo tên ở phía nhà cung cấp (tham số `name` của Get Products).
   */
  async listProducts(
    account: MangoAccountCredentialRef,
    search?: string,
  ): Promise<ProviderCatalogProduct[]> {
    const key = this.cacheKey(account.id, 'products', search ?? '');

    return this.withCache(key, async () => {
      const context = this.credentials.buildContext(account);

      const raw = await this.fetchAllPages<MangoProduct>({
        label: 'products',
        accountId: account.id,
        limit: MANGO_MAX_PAGE_LIMIT.products,
        loadPage: async (page, limit) => {
          const result = await this.client.listProducts(context, {
            page,
            limit,
            ...(search ? { name: search } : {}),
          });
          return { items: result.data?.items ?? [], pagination: result.data?.pagination };
        },
      });

      return raw.map((item) => this.toProduct(item));
    });
  }

  /** TOÀN BỘ biến thể của một sản phẩm (mọi trang). */
  async listVariations(
    account: MangoAccountCredentialRef,
    productId: string,
  ): Promise<ProviderCatalogVariation[]> {
    const key = this.cacheKey(account.id, 'variations', productId);

    return this.withCache(key, async () => {
      const context = this.credentials.buildContext(account);

      const raw = await this.fetchAllPages<MangoVariation>({
        label: 'variations',
        accountId: account.id,
        productId,
        limit: MANGO_MAX_PAGE_LIMIT.variations,
        loadPage: async (page, limit) => {
          const result = await this.client.listVariations(context, productId, { page, limit });
          return { items: result.data?.items ?? [], pagination: result.data?.pagination };
        },
      });

      return raw.map((item) => this.toVariation(item));
    });
  }

  /** Xoá cache danh mục của một tài khoản (nút "Đọc lại danh mục"). */
  async invalidate(accountId: string): Promise<void> {
    try {
      const keys = await this.redis.client.keys(
        `${MangoCatalogService.CACHE_PREFIX}:${accountId}:*`,
      );
      if (keys.length > 0) await this.redis.client.del(...keys);

      this.logger.log({
        module: 'fulfillment',
        provider: 'MANGO',
        operation: 'catalog.invalidate',
        accountId,
        clearedKeys: keys.length,
        msg: `Đã xoá ${keys.length} khoá cache danh mục`,
      });
    } catch (error) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.invalidate',
        accountId,
        msg: `Không xoá được cache danh mục: ${(error as Error).message}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Phân trang
  // ---------------------------------------------------------------------------

  /**
   * Duyệt HẾT các trang của một endpoint phân trang theo `page`/`limit`.
   *
   * Ghi log tổng kết mỗi lần chạy, và log CẢNH BÁO kèm số liệu đối chiếu khi số bản ghi
   * gom được ít hơn `pagination.total` nhà cung cấp báo — thiếu dữ liệu phải lộ ra ở log
   * chứ không âm thầm biến mất trong giao diện.
   */
  private async fetchAllPages<T>(params: {
    label: string;
    accountId: string;
    productId?: string;
    limit: number;
    loadPage: (page: number, limit: number) => Promise<FetchedPage<T>>;
  }): Promise<T[]> {
    const startedAt = Date.now();
    const collected: T[] = [];

    let page = 1;
    let totalPages = 1;
    let reportedTotal: number | undefined;
    let stoppedAtCap = false;

    while (page <= totalPages) {
      if (page > MANGO_MAX_PAGES_PER_FETCH) {
        stoppedAtCap = true;
        break;
      }

      const result = await params.loadPage(page, params.limit);
      collected.push(...result.items);

      // Cập nhật tổng số trang từ CHÍNH response — không phỏng đoán, không tính từ total.
      if (typeof result.pagination?.pages === 'number' && result.pagination.pages > 0) {
        totalPages = result.pagination.pages;
      }
      if (typeof result.pagination?.total === 'number') {
        reportedTotal = result.pagination.total;
      }

      // Trang rỗng ⇒ dừng, kể cả khi `pages` báo còn trang. Bảo vệ trước metadata sai.
      if (result.items.length === 0) break;
      // Đã gom đủ số nhà cung cấp báo ⇒ không cần gọi thêm.
      if (reportedTotal !== undefined && collected.length >= reportedTotal) break;

      page += 1;
    }

    const pagesFetched = Math.min(page, totalPages);
    const summary = {
      module: 'fulfillment',
      provider: 'MANGO',
      operation: `catalog.${params.label}`,
      accountId: params.accountId,
      ...(params.productId ? { productId: params.productId } : {}),
      pagesFetched,
      totalPages,
      pageLimit: params.limit,
      loaded: collected.length,
      reportedTotal: reportedTotal ?? null,
      durationMs: Date.now() - startedAt,
    };

    if (stoppedAtCap) {
      this.logger.warn({
        ...summary,
        msg:
          `Dừng ở trần ${MANGO_MAX_PAGES_PER_FETCH} trang khi tải ${params.label}. ` +
          `Đã tải ${collected.length}/${reportedTotal ?? '?'} bản ghi — danh sách CÓ THỂ THIẾU.`,
      });
    } else if (reportedTotal !== undefined && collected.length < reportedTotal) {
      this.logger.warn({
        ...summary,
        msg:
          `Tải THIẾU ${params.label}: nhà cung cấp báo ${reportedTotal} bản ghi trên ` +
          `${totalPages} trang, chỉ gom được ${collected.length} sau ${pagesFetched} trang.`,
      });
    } else {
      this.logger.log({
        ...summary,
        msg: `Loaded ${collected.length} ${params.label} from Mango (${pagesFetched}/${totalPages} pages)`,
      });
    }

    return collected;
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  private cacheKey(accountId: string, kind: string, suffix: string): string {
    return `${MangoCatalogService.CACHE_PREFIX}:${accountId}:${kind}:${suffix}`;
  }

  /**
   * Đọc cache → miss thì gọi `loader` → ghi cache.
   *
   * Mọi lỗi Redis đều bị nuốt CÓ CHỦ Ý: cache là tối ưu, không phải phụ thuộc bắt buộc.
   * Redis chết thì tính năng chậm hơn chứ không được hỏng.
   */
  private async withCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.client.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.cacheRead',
        msg: `Bỏ qua cache: ${(error as Error).message}`,
      });
    }

    const fresh = await loader();

    try {
      await this.redis.client.set(
        key,
        JSON.stringify(fresh),
        'EX',
        MangoCatalogService.CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn({
        module: 'fulfillment',
        operation: 'catalog.cacheWrite',
        msg: `Không ghi được cache: ${(error as Error).message}`,
      });
    }

    return fresh;
  }

  // ---------------------------------------------------------------------------
  // Chuẩn hoá
  // ---------------------------------------------------------------------------

  private toProduct(item: MangoProduct): ProviderCatalogProduct {
    return {
      id: item.id ?? '',
      sku: item.sku ?? null,
      name: item.name ?? item.sku ?? '',
      catalogName: item.catalog_name ?? null,
      basePrice: item.base_price ?? null,
      currency: item.currency ?? null,
      imageUrl: item.images?.[0] ?? null,
      // Nhà cung cấp không trả cờ ⇒ coi như đang bán, để không ẩn nhầm sản phẩm hợp lệ.
      isActive: item.is_active ?? true,
      variationsCount: item.variations_count ?? null,
    };
  }

  private toVariation(item: MangoVariation): ProviderCatalogVariation {
    const parts = [item.color, item.size].filter(Boolean);
    return {
      id: item.id ?? '',
      // `sku` của biến thể chính là giá trị gửi trong `items[].sku` lúc tạo đơn.
      sku: item.sku ?? '',
      name: item.name ?? parts.join(' / '),
      color: item.color ?? null,
      size: item.size ?? null,
      price: item.price ?? null,
      isAvailable: item.is_available ?? true,
    };
  }
}
