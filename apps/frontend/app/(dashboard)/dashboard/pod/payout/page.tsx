'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useApiError } from '@/hooks/use-api-error';
import { OrderDateFilter } from '@/features/pod-tiktok/components/order-date-filter';
import { PayoutAccountTable } from '@/features/pod-tiktok/components/payout-account-table';
import { PayoutSellerTable } from '@/features/pod-tiktok/components/payout-seller-table';
import { PayoutSummaryCard } from '@/features/pod-tiktok/components/payout-summary-card';
import {
  usePodPayoutAccounts,
  usePodPayoutSellers,
  usePodPayoutSummary,
  useTriggerPayoutSync,
} from '@/features/pod-tiktok/hooks/use-pod-payout';
import type { PodDatePreset } from '@/features/pod-tiktok/order-types';
import {
  POD_PAYOUT_STATUSES,
  type PodPayoutFilter,
  type PodPayoutSortField,
  type PodPayoutStatus,
} from '@/features/pod-tiktok/payout-types';

/** Trạng thái sắp xếp của một bảng. */
interface TableState {
  page: number;
  search: string;
  sortField: PodPayoutSortField;
  sortOrder: 'asc' | 'desc';
}

const INITIAL_TABLE: TableState = {
  page: 1,
  // Yêu cầu nghiệp vụ: mặc định sắp xếp GIẢM DẦN theo Payout.
  search: '',
  sortField: 'totalPayout',
  sortOrder: 'desc',
};

/**
 * POD → Tiktok Payout — màn hình THỐNG KÊ chi trả từ TikTok Shop.
 *
 * Số liệu lấy từ TikTok Finance API đã đồng bộ về hệ thống; trang này KHÔNG tự tính
 * lại tiền. Mọi bộ lọc (thời gian, trạng thái, tìm kiếm, phân trang, sắp xếp) đều được
 * gửi lên BACKEND — frontend không lọc dữ liệu tại chỗ.
 *
 * Phạm vi dữ liệu do backend quyết định: Admin thấy toàn tổ chức, Seller chỉ thấy
 * Account do chính mình quản lý.
 */
export default function TiktokPayoutPage() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.tiktok.payout.sync');

  const [filter, setFilter] = useState<PodPayoutFilter>({ datePreset: 'LAST_30_DAYS' });
  const [sellerTable, setSellerTable] = useState<TableState>(INITIAL_TABLE);
  const [accountTable, setAccountTable] = useState<TableState>(INITIAL_TABLE);

  // Gõ tới đâu gọi API tới đó sẽ tạo request thừa — chờ người dùng ngừng gõ.
  const sellerSearch = useDebouncedValue(sellerTable.search, 400);
  const accountSearch = useDebouncedValue(accountTable.search, 400);

  const summaryQuery = usePodPayoutSummary(filter);
  const sellersQuery = usePodPayoutSellers({
    ...filter,
    page: sellerTable.page,
    search: sellerSearch || undefined,
    sortField: sellerTable.sortField,
    sortOrder: sellerTable.sortOrder,
  });
  const accountsQuery = usePodPayoutAccounts({
    ...filter,
    page: accountTable.page,
    search: accountSearch || undefined,
    sortField: accountTable.sortField,
    sortOrder: accountTable.sortOrder,
  });
  const syncMutation = useTriggerPayoutSync();

  // Đổi bộ lọc/từ khoá ⇒ quay lại trang 1, tránh rơi vào trang trống.
  useEffect(() => {
    setSellerTable((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    setAccountTable((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [filter]);
  useEffect(() => {
    setSellerTable((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [sellerSearch]);
  useEffect(() => {
    setAccountTable((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [accountSearch]);

  const handleDateChange = (value: { preset?: PodDatePreset; from?: string; to?: string }) => {
    setFilter((prev) => ({
      ...prev,
      datePreset: value.preset,
      fromDate: value.from,
      toDate: value.to,
    }));
  };

  /** Bấm lại đúng cột đang sắp xếp thì đảo chiều; bấm cột khác thì mặc định giảm dần. */
  const toggleSort = (
    setState: React.Dispatch<React.SetStateAction<TableState>>,
    field: PodPayoutSortField,
  ) => {
    setState((prev) => ({
      ...prev,
      page: 1,
      sortField: field,
      sortOrder: prev.sortField === field && prev.sortOrder === 'desc' ? 'asc' : 'desc',
    }));
  };

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync({});
      toast.success(t('payout.syncSuccess'), {
        description: t('payout.syncSummary', {
          succeeded: result.shopsSucceeded,
          total: result.shopsTotal,
          payments: result.paymentsCreated,
          statements: result.statementsCreated,
          apiCalls: result.apiCalls,
        }),
      });
    } catch (error) {
      toast.error(t('payout.syncFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('payout.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('payout.subtitle')}</p>
        </div>
        {canSync && (
          <Button onClick={() => void handleSync()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('payout.syncAction')}
          </Button>
        )}
      </div>

      {/* Bộ lọc — áp dụng cho CẢ Report Card lẫn hai bảng bên dưới. */}
      <div className="flex flex-wrap items-center gap-2">
        <OrderDateFilter
          preset={filter.datePreset}
          from={filter.fromDate}
          to={filter.toDate}
          onChange={handleDateChange}
        />
        <Combobox
          value={filter.payoutStatus ?? ''}
          onChange={(value) =>
            setFilter((prev) => ({
              ...prev,
              payoutStatus: (value || undefined) as PodPayoutStatus | undefined,
            }))
          }
          options={[
            { value: '', label: t('common:filter.allStatuses') },
            ...POD_PAYOUT_STATUSES.map((status) => ({
              value: status,
              label: t(`payout.status.${status}`),
            })),
          ]}
          className="w-[180px]"
        />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Wallet className="size-3.5" />
          {t('payout.statusNote')}
        </span>
      </div>

      <PayoutSummaryCard
        data={summaryQuery.data}
        loading={summaryQuery.isLoading}
        error={summaryQuery.isError ? summaryQuery.error : null}
      />

      <PayoutSellerTable
        data={sellersQuery.data}
        loading={sellersQuery.isFetching}
        error={sellersQuery.isError ? sellersQuery.error : null}
        search={sellerTable.search}
        onSearchChange={(value) => setSellerTable((prev) => ({ ...prev, search: value }))}
        sortField={sellerTable.sortField}
        sortOrder={sellerTable.sortOrder}
        onSortChange={(field) => toggleSort(setSellerTable, field)}
        onPageChange={(page) => setSellerTable((prev) => ({ ...prev, page }))}
      />

      <PayoutAccountTable
        data={accountsQuery.data}
        loading={accountsQuery.isFetching}
        error={accountsQuery.isError ? accountsQuery.error : null}
        search={accountTable.search}
        onSearchChange={(value) => setAccountTable((prev) => ({ ...prev, search: value }))}
        sortField={accountTable.sortField}
        sortOrder={accountTable.sortOrder}
        onSortChange={(field) => toggleSort(setAccountTable, field)}
        onPageChange={(page) => setAccountTable((prev) => ({ ...prev, page }))}
      />
    </div>
  );
}
