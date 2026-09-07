import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  AddFlashSaleItemPayload,
  ApplyFlashSaleTemplatePayload,
  BatchUpdateFlashSaleItemsPayload,
  CreateFlashSalePayload,
  DuplicateFlashSalePayload,
  PodFlashSaleDetail,
  PodFlashSaleListResult,
  PodFlashSaleLogResult,
  PodFlashSalePublishResult,
  PodFlashSaleQuery,
  PodFlashSaleTemplate,
  PodFlashSaleTemplateQuery,
  PodFlashSaleTemplateResult,
  PodFlashSaleValidation,
  SaveFlashSaleTemplatePayload,
  UpdateFlashSalePayload,
  UpdateFlashSaleItemPayload,
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
  ): Promise<PodFlashSaleDetail> {
    const res = await apiClient.patch<ApiResponse<PodFlashSaleDetail>>(
      `${BASE}/${id}/items/batch`,
      payload,
    );
    return res.data.data;
  },

  async deleteItems(id: string, itemIds: string[]): Promise<PodFlashSaleDetail> {
    // 🔴 `DELETE` có thân request ⇒ axios đòi truyền qua `data`, không phải tham số thứ hai.
    const res = await apiClient.delete<ApiResponse<PodFlashSaleDetail>>(`${BASE}/${id}/items`, {
      data: { itemIds },
    });
    return res.data.data;
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
