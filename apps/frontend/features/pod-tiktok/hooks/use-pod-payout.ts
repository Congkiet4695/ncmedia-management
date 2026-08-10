'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podPayoutService } from '../services/pod-payout.service';
import type {
  PodPayoutBreakdownQuery,
  PodPayoutFilter,
  TriggerPayoutSyncPayload,
} from '../payout-types';

const POD_PAYOUT_KEY = 'pod-tiktok-payout';

export function usePodPayoutSummary(filter: PodPayoutFilter) {
  return useQuery({
    queryKey: [POD_PAYOUT_KEY, 'summary', filter],
    queryFn: () => podPayoutService.summary(filter),
    // Giữ dữ liệu cũ khi đổi bộ lọc để số liệu không nhảy về rỗng rồi hiện lại.
    placeholderData: keepPreviousData,
  });
}

export function usePodPayoutSellers(query: PodPayoutBreakdownQuery) {
  return useQuery({
    queryKey: [POD_PAYOUT_KEY, 'sellers', query],
    queryFn: () => podPayoutService.sellers(query),
    placeholderData: keepPreviousData,
  });
}

export function usePodPayoutAccounts(query: PodPayoutBreakdownQuery) {
  return useQuery({
    queryKey: [POD_PAYOUT_KEY, 'accounts', query],
    queryFn: () => podPayoutService.accounts(query),
    placeholderData: keepPreviousData,
  });
}

/** Đồng bộ payout thủ công — làm mới toàn bộ số liệu payout sau khi xong. */
export function useTriggerPayoutSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TriggerPayoutSyncPayload) => podPayoutService.triggerSync(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_PAYOUT_KEY] }),
  });
}
