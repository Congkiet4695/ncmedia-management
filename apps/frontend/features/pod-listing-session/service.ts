import { apiClient } from '@/services/api-client';
import type { ApiResponse, Paginated } from '@/types/api';
import type { PreviewResult } from '@/features/pod-listing/types';
import type {
  CreateSessionPayload,
  PodListingSession,
  PodListingSessionDetail,
  PodSessionImportMode,
  PodSessionImportResult,
  PodSessionProduct,
  PodSessionProductQuery,
  PodSessionQuery,
  PodSessionValidation,
  StartSessionListingResult,
  UpdateSessionPayload,
  UpdateSessionProductPayload,
} from './types';

const BASE = '/pod/listing-sessions';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/** Mảng an toàn: `undefined` / `null` / giá trị lạ đều thành `[]`. */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Chuẩn hoá một Draft Product trả về từ API.
 *
 * 🔴 Giao diện KHÔNG được sập chỉ vì API trả về một hình dạng hơi khác — phiên bản backend
 * cũ, response cache của trình duyệt, hay một endpoint tương lai trả bản rút gọn. Chuẩn hoá
 * MỘT chỗ ở đây rẻ hơn rải `?.` khắp mọi component.
 */
function normalizeProduct(product: PodSessionProduct): PodSessionProduct {
  return {
    ...product,
    images: toArray<PodSessionProduct['images'][number]>(product?.images),
    results: toArray<NonNullable<PodSessionProduct['results']>[number]>(product?.results),
    issues: Array.isArray(product?.issues) ? product.issues : null,
    errorCount: typeof product?.errorCount === 'number' ? product.errorCount : 0,
  };
}

/**
 * API Listing Session.
 *
 * 🔴 Chỉ `start` dẫn tới sàn — và nó cũng chỉ tạo Listing Job. Tạo lượt đăng, import, sửa,
 * validate, preview đều không chạm TikTok.
 */
export const podListingSessionService = {
  async list(query: PodSessionQuery = {}): Promise<Paginated<PodListingSession>> {
    const res = await apiClient.get<ApiResponse<Paginated<PodListingSession>>>(BASE, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodListingSessionDetail> {
    const res = await apiClient.get<ApiResponse<PodListingSessionDetail>>(`${BASE}/${id}`);
    return res.data.data;
  },

  async create(payload: CreateSessionPayload): Promise<PodListingSessionDetail> {
    const res = await apiClient.post<ApiResponse<PodListingSessionDetail>>(BASE, payload);
    return res.data.data;
  },

  async update(id: string, payload: UpdateSessionPayload): Promise<PodListingSessionDetail> {
    const res = await apiClient.patch<ApiResponse<PodListingSessionDetail>>(
      `${BASE}/${id}`,
      payload,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`${BASE}/${id}`);
  },

  /** Import Excel/CSV vào MỘT session. KHÔNG gọi TikTok — chỉ đọc file và ghi database. */
  async import(
    id: string,
    file: File,
    mode: PodSessionImportMode = 'APPEND',
  ): Promise<PodSessionImportResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);

    const res = await apiClient.post<ApiResponse<PodSessionImportResult>>(
      `${BASE}/${id}/import`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  /** Tải file mẫu đúng bộ cột hệ thống đọc được. */
  async downloadTemplate(): Promise<void> {
    const res = await apiClient.get<Blob>(`${BASE}/import/template`, { responseType: 'blob' });
    const url = URL.createObjectURL(
      new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'listing-session-template.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  async listProducts(
    id: string,
    query: PodSessionProductQuery = {},
  ): Promise<Paginated<PodSessionProduct>> {
    const res = await apiClient.get<ApiResponse<Paginated<PodSessionProduct>>>(
      `${BASE}/${id}/products`,
      { params: clean(query as Record<string, unknown>) },
    );
    return {
      ...res.data.data,
      items: toArray<PodSessionProduct>(res.data.data?.items).map(normalizeProduct),
    };
  },

  async getProduct(id: string, productId: string): Promise<PodSessionProduct> {
    const res = await apiClient.get<ApiResponse<PodSessionProduct>>(
      `${BASE}/${id}/products/${productId}`,
    );
    return normalizeProduct(res.data.data);
  },

  async updateProduct(
    id: string,
    productId: string,
    payload: UpdateSessionProductPayload,
  ): Promise<PodSessionProduct> {
    const res = await apiClient.patch<ApiResponse<PodSessionProduct>>(
      `${BASE}/${id}/products/${productId}`,
      payload,
    );
    return normalizeProduct(res.data.data);
  },

  async removeProducts(id: string, ids: string[]): Promise<{ deleted: number }> {
    const res = await apiClient.post<ApiResponse<{ deleted: number }>>(
      `${BASE}/${id}/products/delete`,
      { ids },
    );
    return res.data.data;
  },

  /** Dọn sạch danh sách để nhập lại từ đầu. */
  async removeAllProducts(id: string): Promise<{ deleted: number }> {
    const res = await apiClient.delete<ApiResponse<{ deleted: number }>>(`${BASE}/${id}/products`);
    return res.data.data;
  },

  /** Xem trước payload sau khi áp template của lượt đăng. KHÔNG upload. */
  async previewProduct(id: string, productId: string, shopId?: string): Promise<PreviewResult> {
    const res = await apiClient.post<ApiResponse<PreviewResult>>(
      `${BASE}/${id}/products/${productId}/preview`,
      clean({ shopId }),
    );
    return res.data.data;
  },

  async validate(id: string): Promise<PodSessionValidation> {
    const res = await apiClient.post<ApiResponse<PodSessionValidation>>(`${BASE}/${id}/validate`, {});
    return res.data.data;
  },

  /** 🔴 Đường DUY NHẤT dẫn tới sàn — và cũng chỉ tạo Listing Job (`save_mode = AS_DRAFT`). */
  async start(id: string, name?: string): Promise<StartSessionListingResult> {
    const res = await apiClient.post<ApiResponse<StartSessionListingResult>>(
      `${BASE}/${id}/start`,
      clean({ name }),
    );
    return res.data.data;
  },
};
