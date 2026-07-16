'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountService } from '../services/account.service';
import type { AccountQuery, CreateAccountPayload, CredentialsPayload, UpdateAccountPayload } from '../types';

const ACCOUNTS_KEY = 'accounts';

export function useAccounts(query: AccountQuery) {
  return useQuery({
    queryKey: [ACCOUNTS_KEY, 'list', query],
    queryFn: () => accountService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useAccount(id?: string) {
  return useQuery({
    queryKey: [ACCOUNTS_KEY, 'detail', id],
    queryFn: () => accountService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useAccountOverview() {
  return useQuery({
    queryKey: [ACCOUNTS_KEY, 'overview'],
    queryFn: () => accountService.overview(),
  });
}

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => accountService.listPlatforms(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * useSellers — chỉ fetch khi `enabled` (chỉ user có quyền chọn/gán Seller, vd account.assign).
 * EMPLOYEE truyền enabled=false → KHÔNG gọi GET /accounts/sellers.
 */
export function useSellers(enabled = true) {
  return useQuery({
    queryKey: [ACCOUNTS_KEY, 'sellers'],
    queryFn: () => accountService.listSellers(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAccountPayload) => accountService.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] }),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAccountPayload }) =>
      accountService.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] }),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] }),
  });
}

export function useUpdateCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CredentialsPayload }) =>
      accountService.updateCredentials(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] }),
  });
}
