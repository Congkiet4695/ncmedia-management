import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  Account,
  AccountCredentials,
  AccountListResult,
  AccountOverview,
  AccountPlatform,
  AccountQuery,
  CreateAccountPayload,
  CredentialsPayload,
  SellerOption,
  UpdateAccountPayload,
} from '../types';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

export const accountService = {
  async list(query: AccountQuery): Promise<AccountListResult> {
    const res = await apiClient.get<ApiResponse<AccountListResult>>('/accounts', {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<Account> {
    const res = await apiClient.get<ApiResponse<Account>>(`/accounts/${id}`);
    return res.data.data;
  },

  async create(payload: CreateAccountPayload): Promise<Account> {
    const res = await apiClient.post<ApiResponse<Account>>('/accounts', payload);
    return res.data.data;
  },

  async update(id: string, payload: UpdateAccountPayload): Promise<Account> {
    const res = await apiClient.patch<ApiResponse<Account>>(`/accounts/${id}`, payload);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`/accounts/${id}`);
  },

  async overview(): Promise<AccountOverview> {
    const res = await apiClient.get<ApiResponse<AccountOverview>>('/accounts/overview');
    return res.data.data;
  },

  async listSellers(): Promise<SellerOption[]> {
    const res = await apiClient.get<ApiResponse<SellerOption[]>>('/accounts/sellers');
    return res.data.data;
  },

  /** Reveal credentials (giải mã) — backend ghi audit. */
  async revealCredentials(id: string): Promise<AccountCredentials> {
    const res = await apiClient.get<ApiResponse<AccountCredentials>>(`/accounts/${id}/credentials`);
    return res.data.data;
  },

  async updateCredentials(id: string, payload: CredentialsPayload): Promise<Account> {
    const res = await apiClient.patch<ApiResponse<Account>>(`/accounts/${id}/credentials`, payload);
    return res.data.data;
  },

  async listPlatforms(): Promise<AccountPlatform[]> {
    const res = await apiClient.get<ApiResponse<AccountPlatform[]>>('/platforms');
    return res.data.data;
  },
};
