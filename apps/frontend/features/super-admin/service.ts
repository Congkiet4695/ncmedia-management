import { apiClient } from '@/services/api-client';
import type { ApiResponse, Paginated } from '@/types/api';
import type {
  OrganizationDetail,
  OrganizationQuery,
  OrganizationRow,
  SuperAdminDashboard,
} from './types';

const BASE = '/super-admin';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/**
 * API quản trị NỀN TẢNG — duyệt / từ chối Organization đăng ký mới.
 *
 * 🔴 Mọi endpoint ở đây đòi role `SUPER_ADMIN` **và** Organization hệ thống ở phía backend.
 * Frontend ẩn menu theo permission `platform.organization.read`, nhưng đó chỉ là lớp hiển
 * thị — quyền thật do backend quyết.
 */
export const superAdminService = {
  /** §10 — bốn con số Dashboard. */
  async dashboard(): Promise<SuperAdminDashboard> {
    const res = await apiClient.get<ApiResponse<SuperAdminDashboard>>(`${BASE}/dashboard`);
    return res.data.data;
  },

  /** §6 — danh sách Organization, lọc theo trạng thái + tìm theo tên/owner/email. */
  async organizations(query: OrganizationQuery = {}): Promise<Paginated<OrganizationRow>> {
    const res = await apiClient.get<ApiResponse<Paginated<OrganizationRow>>>(
      `${BASE}/organizations`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  /** §7 — chi tiết Organization + Owner + lịch sử duyệt. */
  async organization(id: string): Promise<OrganizationDetail> {
    const res = await apiClient.get<ApiResponse<OrganizationDetail>>(
      `${BASE}/organizations/${id}`,
    );
    return res.data.data;
  },

  /** §8 — Duyệt. */
  async approve(id: string): Promise<OrganizationDetail> {
    const res = await apiClient.post<ApiResponse<OrganizationDetail>>(
      `${BASE}/organizations/${id}/approve`,
      {},
    );
    return res.data.data;
  },

  /** §9 — Từ chối. `reason` bắt buộc; backend từ chối nếu dưới 10 ký tự. */
  async reject(id: string, reason: string): Promise<OrganizationDetail> {
    const res = await apiClient.post<ApiResponse<OrganizationDetail>>(
      `${BASE}/organizations/${id}/reject`,
      { reason },
    );
    return res.data.data;
  },
};
