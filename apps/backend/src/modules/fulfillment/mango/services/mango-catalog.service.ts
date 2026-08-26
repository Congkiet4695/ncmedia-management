import { Injectable, Logger } from '@nestjs/common';
import { MangoApiClient } from '../clients/mango-api.client';
import { MANGO_MAX_PAGES_PER_FETCH, MANGO_MAX_PAGE_LIMIT } from '../constants/mango.constants';
import { MangoCredentialService } from './mango-credential.service';
import type { MangoAccountCredentialRef } from './mango-credential.service';
import type { MangoPagination, MangoProduct, MangoVariation } from '../types/mango-api.types';

/** Một trang đã đọc — đủ để vòng lặp quyết định có đi tiếp hay không. */
interface FetchedPage<T> {
  items: T[];
  pagination?: MangoPagination;
}

/**
 * Kết quả một lượt đọc phân trang, kèm bằng chứng ĐẦY ĐỦ hay THIẾU.
 *
 * 🔴 `complete` là thứ quan trọng nhất ở đây. Sync Job dùng nó để quyết định có được phép
 * đánh dấu những bản ghi không thấy nữa là ARCHIVED hay không: nếu lượt đọc bị cụt giữa
 * chừng, "không thấy" chỉ có nghĩa là "chưa đọc tới", và archive lúc đó sẽ xoá nhầm nửa
 * danh mục.
 */
export interface CatalogFetchResult<T> {
  items: T[];
  /** Đã đọc hết mọi trang và số bản ghi khớp con số nhà cung cấp báo. */
  complete: boolean;
  /** Tổng số bản ghi nhà cung cấp báo (`pagination.total`). NULL = không báo. */
  reportedTotal: number | null;
  pagesFetched: number;
  totalPages: number;
  /** Số lần gọi API thực tế — ghi vào nhật ký đồng bộ. */
  apiCalls: number;
}

/**
 * MangoCatalogService — đọc TOÀN BỘ danh mục sản phẩm/biến thể từ MangoTeePrints.
 *
 * 🔴 Đây là service **CHỈ DÙNG CHO ĐỒNG BỘ**. Giao diện KHÔNG còn gọi vào đây: từ sprint này
 * màn hình Product Mapping đọc từ bảng `fulfillment_catalogues` / `fulfillment_products` /
 * `fulfillment_variants`. Xem `FulfillmentCatalogSyncService`.
 *
 * 🔴 Cache Redis 5 phút trước đây ĐÃ BỎ. Nó chỉ giấu được độ trễ, không làm được ba việc mà
 * tính năng thực sự cần: tìm kiếm/phân trang phía server, ánh xạ tự động (phải quét toàn bộ
 * danh mục), và hoạt động được khi nhà cung cấp đang lỗi. Giữ cả hai lớp cache là hai nguồn
 * sự thật cho cùng một dữ liệu.
 *
 * 🔴 KHÔNG hardcode sản phẩm hay SKU nào. Danh mục lấy từ đúng hai endpoint có trong tài
 * liệu: `GET /products` và `GET /products/{id}/variations`.
 *
 * **Phân trang.** Cả hai endpoint dùng phân trang THEO TRANG (`page` + `limit`) và trả về
 * `pagination { total, page, limit, pages }`. Không có cursor, không có `has_more`. Service
 * duyệt từ trang 1 tới `pagination.pages`, dùng `limit` LỚN NHẤT tài liệu cho phép để giảm
 * số request. Đọc đúng một trang đầu chính là nguyên nhân danh mục bị thiếu.
 *
 * 🔴 **`total` dẫn dắt vòng lặp, `pages` chỉ là phương án dự phòng.** Đo thực tế trên API
 * thật: Mango tôn trọng `limit` được yêu cầu (xin 100 thì trả 100) và `pages` khớp với
 * `ceil(total / limit)`. Hai trường nhất quán với nhau, nên cả hai cách dừng đều cho cùng
 * kết quả hôm nay.
 *
 * Vẫn ưu tiên `total` vì nó là phép đếm đơn giản nhất và không phụ thuộc `limit`: nếu nhà
 * cung cấp về sau giới hạn cỡ trang thấp hơn mức được yêu cầu mà vẫn tính `pages` theo
 * `limit` cũ, vòng lặp dựa vào `pages` sẽ cắt cụt danh sách trong im lặng, còn vòng lặp dựa
 * vào `total` thì không.
 *
 * Điều kiện dừng (bất kỳ điều nào tới trước) — cố ý dư thừa để một trường sai từ nhà cung
 * cấp không biến thành vòng lặp vô hạn hay danh sách cụt:
 *   1. Đã gom đủ `pagination.total` bản ghi.
 *   2. Trang trả về rỗng.
 *   3. Nhà cung cấp KHÔNG báo `total` và đã đọc hết `pagination.pages` trang.
 *   4. Chạm trần `MANGO_MAX_PAGES_PER_FETCH` (ghi log CẢNH BÁO, `complete = false`).
 *
 * Việc thử lại lỗi tạm thời và điều tiết tần suất 10 req/s do `MangoApiClient` đảm nhiệm —
 * không lặp lại ở đây.
 */
@Injectable()
export class MangoCatalogService {
  private readonly logger = new Logger(MangoCatalogService.name);

  constructor(
    private readonly client: MangoApiClient,
    private readonly credentials: MangoCredentialService,
  ) {}

  /** TOÀN BỘ sản phẩm của một tài khoản (mọi trang), giữ nguyên payload gốc. */
  fetchAllProducts(
    account: MangoAccountCredentialRef,
    search?: string,
  ): Promise<CatalogFetchResult<MangoProduct>> {
    const context = this.credentials.buildContext(account);

    return this.fetchAllPages<MangoProduct>({
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
  }

  /** TOÀN BỘ biến thể của một sản phẩm (mọi trang), giữ nguyên payload gốc. */
  fetchAllVariations(
    account: MangoAccountCredentialRef,
    productId: string,
  ): Promise<CatalogFetchResult<MangoVariation>> {
    const context = this.credentials.buildContext(account);

    return this.fetchAllPages<MangoVariation>({
      label: 'variations',
      accountId: account.id,
      productId,
      limit: MANGO_MAX_PAGE_LIMIT.variations,
      loadPage: async (page, limit) => {
        const result = await this.client.listVariations(context, productId, { page, limit });
        return { items: result.data?.items ?? [], pagination: result.data?.pagination };
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Phân trang
  // ---------------------------------------------------------------------------

  /**
   * Duyệt HẾT các trang của một endpoint phân trang theo `page`/`limit`.
   *
   * Ghi log tổng kết mỗi lần chạy, và log CẢNH BÁO kèm số liệu đối chiếu khi số bản ghi gom
   * được ít hơn `pagination.total` nhà cung cấp báo — thiếu dữ liệu phải lộ ra ở log chứ
   * không âm thầm biến mất trong giao diện.
   */
  private async fetchAllPages<T>(params: {
    label: string;
    accountId: string;
    productId?: string;
    limit: number;
    loadPage: (page: number, limit: number) => Promise<FetchedPage<T>>;
  }): Promise<CatalogFetchResult<T>> {
    const startedAt = Date.now();
    const collected: T[] = [];

    let page = 1;
    let totalPages = 1;
    let apiCalls = 0;
    let reportedTotal: number | undefined;
    let stoppedAtCap = false;
    let stoppedAtEmptyPage = false;

    for (;;) {
      if (page > MANGO_MAX_PAGES_PER_FETCH) {
        stoppedAtCap = true;
        break;
      }

      const result = await params.loadPage(page, params.limit);
      apiCalls += 1;
      collected.push(...result.items);

      // Ghi lại metadata từ CHÍNH response — không phỏng đoán.
      if (typeof result.pagination?.pages === 'number' && result.pagination.pages > 0) {
        totalPages = result.pagination.pages;
      }
      if (typeof result.pagination?.total === 'number') {
        reportedTotal = result.pagination.total;
      }

      // Trang rỗng ⇒ hết dữ liệu thật sự, dừng.
      // 🔴 Coi là ĐỌC THIẾU nếu nhà cung cấp còn báo `total` lớn hơn số đã gom — trang rỗng
      // giữa chừng nghĩa là dữ liệu bị cụt, không phải đã hết.
      if (result.items.length === 0) {
        stoppedAtEmptyPage = reportedTotal !== undefined && collected.length < reportedTotal;
        break;
      }

      // Đã gom đủ số nhà cung cấp báo ⇒ xong.
      if (reportedTotal !== undefined && collected.length >= reportedTotal) break;

      // 🔴 CHỈ dùng `pages` khi không có `total`. Mango tính `pages` theo `limit` được yêu
      // cầu nhưng phục vụ tối đa 20 bản ghi/trang, nên tin vào `pages` là cắt cụt danh sách.
      if (reportedTotal === undefined && page >= totalPages) break;

      page += 1;
    }

    const pagesFetched = page;
    const shortOfReportedTotal = reportedTotal !== undefined && collected.length < reportedTotal;
    const complete = !stoppedAtCap && !stoppedAtEmptyPage && !shortOfReportedTotal;

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
      apiCalls,
      complete,
      durationMs: Date.now() - startedAt,
    };

    if (stoppedAtCap) {
      this.logger.warn({
        ...summary,
        msg:
          `Dừng ở trần ${MANGO_MAX_PAGES_PER_FETCH} trang khi tải ${params.label}. ` +
          `Đã tải ${collected.length}/${reportedTotal ?? '?'} bản ghi — danh sách THIẾU.`,
      });
    } else if (shortOfReportedTotal || stoppedAtEmptyPage) {
      this.logger.warn({
        ...summary,
        msg:
          `Tải THIẾU ${params.label}: nhà cung cấp báo ${reportedTotal ?? '?'} bản ghi trên ` +
          `${totalPages} trang, chỉ gom được ${collected.length} sau ${pagesFetched} trang.`,
      });
    } else {
      this.logger.log({
        ...summary,
        msg: `Đã tải ${collected.length} ${params.label} từ Mango (${pagesFetched}/${totalPages} trang)`,
      });
    }

    return {
      items: collected,
      complete,
      reportedTotal: reportedTotal ?? null,
      pagesFetched,
      totalPages,
      apiCalls,
    };
  }
}
