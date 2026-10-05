'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useApiError } from '@/hooks/use-api-error';
import { EmployeeWorkSummary } from '@/features/employee-work/components/employee-work-summary';
import { EmployeeWorkTable } from '@/features/employee-work/components/employee-work-table';
import {
  useEmployeeWorkFilterOptions,
  useEmployeeWorkPage,
  useExportEmployeeWork,
} from '@/features/employee-work/hooks/use-employee-work';
import type { EmployeeWorkFilters, EmployeeWorkSortField } from '@/features/employee-work/types';

interface TableState {
  page: number;
  limit: number;
  sort: EmployeeWorkSortField;
  order: 'asc' | 'desc';
}

/** Yêu cầu nghiệp vụ: mặc định sắp xếp GIẢM DẦN theo số listing. */
const INITIAL_TABLE: TableState = { page: 1, limit: 20, sort: 'listings', order: 'desc' };

/**
 * Thống kê công việc nhân viên (Admin).
 *
 * 🔴 Quyền: `report.read` VÀ `pod.shop.all` — khớp `PodEmployeeWorkController`. Hai `RequirePermission`
 * lồng nhau vì component chỉ có ngữ nghĩa HOẶC khi nhận mảng. Seller (EMPLOYEE) không có cả hai ⇒ 403.
 */
export default function EmployeeWorkStatisticsPage() {
  const { t } = useTranslation('report');
  return (
    <RequirePermission permission="report.read" message={t('employeeWork.noPermission')}>
      <RequirePermission permission="pod.shop.all" message={t('employeeWork.noPermission')}>
        <EmployeeWorkView />
      </RequirePermission>
    </RequirePermission>
  );
}

function EmployeeWorkView() {
  const { t } = useTranslation(['report', 'common']);
  const translateApiError = useApiError();

  // `from` / `to` bỏ trống ⇒ backend lấy HÔM NAY theo giờ vận hành (không tự tính ngày ở trình duyệt).
  const [filters, setFilters] = useState<EmployeeWorkFilters>({});
  const [table, setTable] = useState<TableState>(INITIAL_TABLE);

  const optionsQuery = useEmployeeWorkFilterOptions(true);
  const pageQuery = useEmployeeWorkPage({ ...filters, ...table }, true);
  const exportMutation = useExportEmployeeWork();

  const data = pageQuery.data;
  const options = optionsQuery.data;
  // Ngày đang hiển thị: do backend trả về (đã quy về giờ vận hành).
  const from = filters.from ?? data?.from ?? '';
  const to = filters.to ?? data?.to ?? '';

  /** Đổi bộ lọc ⇒ quay lại trang 1, tránh rơi vào trang trống. */
  const updateFilters = (patch: Partial<EmployeeWorkFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setTable((prev) => ({ ...prev, page: 1 }));
  };

  const changeFrom = (value: string) => {
    if (!value) return;
    updateFilters({ from: value, to: to && to < value ? value : to || value });
  };
  const changeTo = (value: string) => {
    if (!value) return;
    updateFilters({ to: value, from: from && from > value ? value : from || value });
  };

  /** Bấm lại đúng cột đang sắp xếp thì đảo chiều; cột khác ⇒ chiều mặc định (tên: A→Z, số: giảm dần). */
  const toggleSort = (field: EmployeeWorkSortField) =>
    setTable((prev) => ({
      ...prev,
      page: 1,
      sort: field,
      order:
        prev.sort === field
          ? prev.order === 'desc'
            ? 'asc'
            : 'desc'
          : field === 'name'
            ? 'asc'
            : 'desc',
    }));

  const handleExport = async () => {
    try {
      await exportMutation.mutateAsync({
        ...filters,
        from,
        to,
        currency: filters.currency ?? data?.currency ?? undefined,
      });
    } catch (error) {
      toast.error(t('employeeWork.exportFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('employeeWork.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('employeeWork.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => void handleExport()}
          disabled={exportMutation.isPending || !data}
        >
          {exportMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {t('common:action.export')}
        </Button>
      </div>

      {/* Bộ lọc — áp dụng cho CẢ thẻ tóm tắt lẫn bảng. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ew-from" className="text-xs text-muted-foreground">
            {t('employeeWork.filter.from')}
          </Label>
          <Input
            id="ew-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => changeFrom(event.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ew-to" className="text-xs text-muted-foreground">
            {t('employeeWork.filter.to')}
          </Label>
          <Input
            id="ew-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => changeTo(event.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          disabled={!filters.from && !filters.to}
          onClick={() => updateFilters({ from: undefined, to: undefined })}
        >
          {t('employeeWork.filter.today')}
        </Button>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t('employeeWork.filter.employee')}
          </Label>
          <Combobox
            value={filters.userId ?? ''}
            onChange={(value) => updateFilters({ userId: value || undefined })}
            loading={optionsQuery.isLoading}
            options={[
              { value: '', label: t('employeeWork.filter.allEmployees') },
              ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name })),
            ]}
            className="w-[220px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('employeeWork.filter.shop')}</Label>
          <Combobox
            value={filters.shopId ?? ''}
            onChange={(value) => updateFilters({ shopId: value || undefined })}
            loading={optionsQuery.isLoading}
            options={[
              { value: '', label: t('employeeWork.filter.allShops') },
              ...(options?.shops ?? []).map((shop) => ({
                value: shop.id,
                label: `${shop.name} (${shop.accountName})`,
              })),
            ]}
            className="w-[260px]"
          />
        </div>
        {(options?.currencies.length ?? 0) > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="ew-currency" className="text-xs text-muted-foreground">
              {t('employeeWork.filter.currency')}
            </Label>
            <NativeSelect
              id="ew-currency"
              value={filters.currency ?? data?.currency ?? ''}
              onChange={(event) => updateFilters({ currency: event.target.value || undefined })}
              className="h-9 w-[110px]"
            >
              {options?.currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      <EmployeeWorkSummary
        summary={data?.summary}
        currency={data?.currency ?? null}
        loading={pageQuery.isLoading}
      />
      <p className="text-xs text-muted-foreground">{t('employeeWork.note')}</p>

      <EmployeeWorkTable
        data={data}
        loading={pageQuery.isFetching}
        error={pageQuery.isError ? pageQuery.error : null}
        onRetry={() => void pageQuery.refetch()}
        sortField={table.sort}
        sortOrder={table.order}
        onSortChange={toggleSort}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        onPageSizeChange={(limit) => setTable((prev) => ({ ...prev, limit, page: 1 }))}
      />
    </div>
  );
}
