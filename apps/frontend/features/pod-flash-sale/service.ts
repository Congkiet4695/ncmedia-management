import { apiClient } from '@/services/api-client';
import { FLASH_SALE_MAX_ADD_PER_CALL, FLASH_SALE_MAX_BATCH_PER_CALL } from './types';
import type { ApiResponse } from '@/types/api';
import type {
  AddFlashSaleItemPayload,
  ApplyFlashSaleTemplatePayload,
  BatchUpdateFlashSaleItemsPayload,
  CreateFlashSalePayload,
  DuplicateFlashSalePayload,
  PodFlashSaleBatchResult,
  PodFlashSaleBatchUpdateResponse,
  PodFlashSaleChunkProgress,
  PodFlashSaleDetail,
  PodFlashSaleListResult,
  PodFlashSaleLogResult,
  PodFlashSaleProductQuery,
  PodFlashSaleProductResult,
  PodFlashSalePublishResult,
  PodFlashSalePublishStatus,
  PodFlashSaleQuery,
  PodFlashSaleTemplate,
  PodFlashSaleTemplateQuery,
  PodFlashSaleTemplateResult,
  PodFlashSaleValidation,
  SaveFlashSaleTemplatePayload,
  UpdateFlashSaleItemPayload,
  UpdateFlashSalePayload,
} from './types';

const BASE = '/pod/flash-sales';
const TEMPLATE_BASE = '/pod/flash-sale-templates';

/**
 * Bỏ trường rỗng khỏi payload/query — `?status=` gửi lên là một bộ lọc RỖNG, không phải
 * "tất cả", và `{ description: '' }` là "xoá mô tả", không phải "không đổi".
 *
 * `T extends object` (không phải `Record<string, unknown>`) để mọi DTO có khoá cố định
 * truyền thẳng vào được — ép kiểu ở từng chỗ gọi chỉ để chiều lòng trình biên dịch là cách
 * đánh mất chính sự kiểm tra kiểu đang cần.
 */
function clean<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/**
 * API module Flash Sale.
 *
 * 🔴 Chỉ **bốn** hàm dưới đây chạm tới TikTok: `publish`, `retry`, `cancel`, `sync`. Mọi
 * hàm còn lại — kể cả danh sách và chi tiết — chỉ đọc/ghi database của hệ thống. Nhịp tự
 * làm mới 30 giây dùng `list`/`get`, KHÔNG dùng `sync`; nếu không thì mỗi màn hình đang mở
 * là một dòng request đều đặn đổ vào quota của cả tổ chức.
 */
export const podFlashSaleService = {
  async list(query: PodFlashSaleQuery = {}): Promise<PodFlashSaleListResult> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleListResult>>(BASE, {
      params: clean(query),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodFlashSaleDetail> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}`);
    return res.data.data;
  },

  async validate(id: string): Promise<PodFlashSaleValidation> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleValidation>>(`${BASE}/${id}/validate`);
    return res.data.data;
  },

  async logs(
    id: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<PodFlashSaleLogResult> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleLogResult>>(`${BASE}/${id}/logs`, {
      params: clean(params),
    });
    return res.data.data;
  },

  async create(payload: CreateFlashSalePayload): Promise<PodFlashSaleDetail> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleDetail>>(BASE, clean(payload));
    return res.data.data;
  },

  async update(id: string, payload: UpdateFlashSalePayload): Promise<PodFlashSaleDetail> {
    const res = await apiClient.patch<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}`, payload);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/${id}`);
  },

  async duplicate(
    id: string,
    payload: DuplicateFlashSalePayload = {},
  ): Promise<PodFlashSaleDetail> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleDetail>>(
      `${BASE}/${id}/duplicate`,
      clean(payload),
    );
    return res.data.data;
  },

  // --- Sản phẩm trong đợt sale ---

  async addItems(id: string, items: AddFlashSaleItemPayload[]): Promise<PodFlashSaleDetail> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}/items`, {
      items,
    });
    return res.data.data;
  },

  /**
   * Thêm sản phẩm, tự chia thành nhiều request khi danh sách dài.
   *
   * 🔴 `FLASH_SALE_MAX_ADD_PER_CALL` là trần KÍCH THƯỚC MỘT REQUEST, không phải trần số
   * sản phẩm được chọn. Người dùng chọn 3.000 sản phẩm thì đây chia thành 3 lượt gọi —
   * chặn ở ô chọn là nhầm lẫn đúng loại đã khiến hệ thống dừng ở 300 SKU.
   *
   * Tuần tự chứ không song song: mỗi lượt ghi vào cùng một đợt sale và trả về bản chi tiết
   * MỚI NHẤT — bắn song song thì bản trả về cuối cùng là bản nào là chuyện may rủi.
   */
  async addItemsInChunks(
    id: string,
    items: AddFlashSaleItemPayload[],
  ): Promise<PodFlashSaleDetail> {
    let detail: PodFlashSaleDetail | null = null;
    for (let index = 0; index < items.length; index += FLASH_SALE_MAX_ADD_PER_CALL) {
      detail = await podFlashSaleService.addItems(
        id,
        items.slice(index, index + FLASH_SALE_MAX_ADD_PER_CALL),
      );
    }
    if (!detail) throw new Error('Danh sách sản phẩm rỗng');
    return detail;
  },

  /**
   * Sản phẩm của đợt sale — phân trang theo SẢN PHẨM, kèm SKU bên trong.
   *
   * 🔴 Dùng thay cho `detail.items`: endpoint chi tiết trả về TOÀN BỘ dòng, và với một đợt
   * 10.000 SKU đó là vài MB cho mỗi lần tải màn hình.
   */
  async products(id: string, query: PodFlashSaleProductQuery = {}): Promise<PodFlashSaleProductResult> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleProductResult>>(
      `${BASE}/${id}/products`,
      { params: clean(query) },
    );
    return res.data.data;
  },

  /** Tiến độ lượt publish — payload nhẹ, dùng cho polling khi đợt sale đang PUBLISHING. */
  async publishStatus(id: string): Promise<PodFlashSalePublishStatus> {
    const res = await apiClient.get<ApiResponse<PodFlashSalePublishStatus>>(
      `${BASE}/${id}/publish-status`,
    );
    return res.data.data;
  },

  async updateItem(
    id: string,
    itemId: string,
    payload: UpdateFlashSaleItemPayload,
  ): Promise<PodFlashSaleDetail> {
    const res = await apiClient.patch<ApiResponse<PodFlashSaleDetail>>(
      `${BASE}/${id}/items/${itemId}`,
      payload,
    );
    return res.data.data;
  },

  async batchUpdateItems(
    id: string,
    payload: BatchUpdateFlashSaleItemsPayload,
  ): Promise<PodFlashSaleBatchUpdateResponse> {
    const res = await apiClient.patch<ApiResponse<PodFlashSaleBatchUpdateResponse>>(
      `${BASE}/${id}/items/batch`,
      payload,
    );
    return res.data.data;
  },

  /**
   * Batch Update, tự chia thành nhiều request khi chọn nhiều dòng — cùng lý do và cùng cách
   * làm với `addItemsInChunks`. Tuần tự, và gộp kết quả của mọi lượt để giao diện nói được
   * "Cập nhật 3.080 / 3.107 · 27 dòng bỏ qua" thay vì một con số của lượt cuối.
   *
   * Trả về bản chi tiết của lượt CUỐI (mới nhất) kèm kết quả gộp.
   */
  async batchUpdateItemsInChunks(
    id: string,
    itemIds: string[],
    payload: UpdateFlashSaleItemPayload,
    onProgress?: (progress: PodFlashSaleChunkProgress) => void,
  ): Promise<PodFlashSaleBatchUpdateResponse> {
    const total = Math.ceil(itemIds.length / FLASH_SALE_MAX_BATCH_PER_CALL);
    const merged: PodFlashSaleBatchResult = { requested: 0, updated: 0, skipped: 0, failures: [] };
    let last: PodFlashSaleBatchUpdateResponse | null = null;

    for (let index = 0; index < itemIds.length; index += FLASH_SALE_MAX_BATCH_PER_CALL) {
      onProgress?.({ done: index / FLASH_SALE_MAX_BATCH_PER_CALL, total });
      last = await podFlashSaleService.batchUpdateItems(id, {
        ...payload,
        itemIds: itemIds.slice(index, index + FLASH_SALE_MAX_BATCH_PER_CALL),
      });
      merged.requested += last.batchResult.requested;
      merged.updated += last.batchResult.updated;
      merged.skipped += last.batchResult.skipped;
      merged.failures.push(...last.batchResult.failures);
    }
    onProgress?.({ done: total, total });

    if (!last) throw new Error('Chưa chọn dòng nào');
    return { ...last, batchResult: merged };
  },

  async deleteItems(id: string, itemIds: string[]): Promise<PodFlashSaleDetail> {
    // 🔴 `DELETE` có thân request ⇒ axios đòi truyền qua `data`, không phải tham số thứ hai.
    const res = await apiClient.delete<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}/items`, {
      data: { itemIds },
    });
    return res.data.data;
  },

  /** Batch Delete chia lượt — cùng giới hạn body với Batch Update. */
  async deleteItemsInChunks(id: string, itemIds: string[]): Promise<PodFlashSaleDetail> {
    let detail: PodFlashSaleDetail | null = null;
    for (let index = 0; index < itemIds.length; index += FLASH_SALE_MAX_BATCH_PER_CALL) {
      detail = await podFlashSaleService.deleteItems(
        id,
        itemIds.slice(index, index + FLASH_SALE_MAX_BATCH_PER_CALL),
      );
    }
    if (!detail) throw new Error('Chưa chọn dòng nào');
    return detail;
  },

  // --- Chạm tới sàn ---

  async publish(id: string, skipInvalidItems = false): Promise<PodFlashSalePublishResult> {
    const res = await apiClient.post<ApiResponse<PodFlashSalePublishResult>>(
      `${BASE}/${id}/publish`,
      {
        skipInvalidItems,
      },
    );
    return res.data.data;
  },

  async retry(id: string, skipInvalidItems = false): Promise<PodFlashSalePublishResult> {
    const res = await apiClient.post<ApiResponse<PodFlashSalePublishResult>>(
      `${BASE}/${id}/retry`,
      {
        skipInvalidItems,
      },
    );
    return res.data.data;
  },

  async cancel(id: string): Promise<PodFlashSalePublishResult> {
    const res = await apiClient.post<ApiResponse<PodFlashSalePublishResult>>(
      `${BASE}/${id}/cancel`,
    );
    return res.data.data;
  },

  async sync(id: string): Promise<PodFlashSaleDetail> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}/sync`);
    return res.data.data;
  },

  // --- Template ---

  async saveAsTemplate(
    id: string,
    payload: SaveFlashSaleTemplatePayload,
  ): Promise<PodFlashSaleTemplate> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleTemplate>>(
      `${BASE}/${id}/save-as-template`,
      clean(payload),
    );
    return res.data.data;
  },

  async listTemplates(query: PodFlashSaleTemplateQuery = {}): Promise<PodFlashSaleTemplateResult> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleTemplateResult>>(TEMPLATE_BASE, {
      params: clean(query),
    });
    return res.data.data;
  },

  async getTemplate(id: string): Promise<PodFlashSaleTemplate> {
    const res = await apiClient.get<ApiResponse<PodFlashSaleTemplate>>(`${TEMPLATE_BASE}/${id}`);
    return res.data.data;
  },

  async updateTemplate(
    id: string,
    payload: { name?: string; description?: string },
  ): Promise<PodFlashSaleTemplate> {
    const res = await apiClient.patch<ApiResponse<PodFlashSaleTemplate>>(
      `${TEMPLATE_BASE}/${id}`,
      payload,
    );
    return res.data.data;
  },

  async removeTemplate(id: string): Promise<void> {
    await apiClient.delete(`${TEMPLATE_BASE}/${id}`);
  },

  async applyTemplate(
    id: string,
    payload: ApplyFlashSaleTemplatePayload,
  ): Promise<PodFlashSaleDetail> {
    const res = await apiClient.post<ApiResponse<PodFlashSaleDetail>>(
      `${TEMPLATE_BASE}/${id}/apply`,
      clean(payload),
    );
    return res.data.data;
  },
};
