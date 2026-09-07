'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClampedPage } from '@/hooks/use-clamped-page';
import { useApiError } from '@/hooks/use-api-error';
import { DeleteDialog } from '@/features/employees/components/delete-dialog';
import { EmployeeDialog } from '@/features/employees/components/employee-dialog';
import { EmployeeFilter } from '@/features/employees/components/employee-filter';
import { EmployeeImportExportBar } from '@/features/employees/components/employee-import-export-bar';
import { EmployeeTable } from '@/features/employees/components/employee-table';
import { RequireAdmin } from '@/features/employees/components/require-admin';
import {
  useDeleteEmployee,
  useEmployees,
} from '@/features/employees/hooks/use-employees';
import type { EmployeeListItem, EmployeeQuery } from '@/features/employees/types';

export default function EmployeesPage() {
  return (
    <RequireAdmin>
      <EmployeesView />
    </RequireAdmin>
  );
}

function EmployeesView() {
  const { t } = useTranslation(['employee', 'common']);
  const translateApiError = useApiError();
  const [query, setQuery] = useState<EmployeeQuery>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const [departmentInput, setDepartmentInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const debouncedDepartment = useDebouncedValue(departmentInput, 350);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EmployeeListItem | null>(null);

  const queryClient = useQueryClient();
  const employeesQuery = useEmployees(query);
  const deleteMutation = useDeleteEmployee();

  const patchQuery = (patch: Partial<EmployeeQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  useEffect(() => {
    const next = debouncedDepartment || undefined;
    setQuery((prev) => (prev.department === next ? prev : { ...prev, department: next, page: 1 }));
  }, [debouncedDepartment]);

  const items = employeesQuery.data?.items ?? [];
  const meta = employeesQuery.data?.meta;
  // Xoá nốt record cuối của trang cuối ⇒ lùi về trang còn dữ liệu,
  // không để giao diện kẹt ở "Trang 3 / 2" với một cái bảng trống.
  useClampedPage(meta, (next) => patchQuery({ page: next }));

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success(t('deleted'), { description: deleting.fullName });
      setDeleting(null);
    } catch (error) {
      toast.error(t('deleteFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EmployeeImportExportBar
            query={query}
            onImported={() => queryClient.invalidateQueries({ queryKey: ['employees'] })}
          />
          <Button asChild>
            <Link href="/dashboard/employees/create">
              <Plus className="size-4" />
              {t('create')}
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <EmployeeFilter
            search={searchInput}
            status={query.status}
            department={departmentInput}
            startDate={query.startDate ?? ''}
            onSearchChange={setSearchInput}
            onStatusChange={(status) => patchQuery({ status, page: 1 })}
            onDepartmentChange={setDepartmentInput}
            onStartDateChange={(startDate) => patchQuery({ startDate: startDate || undefined, page: 1 })}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {employeesQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(employeesQuery.error)}
            </p>
          ) : (
            <EmployeeTable
              employees={items}
              loading={employeesQuery.isLoading}
              onView={(e) => setViewingId(e.id)}
              onDelete={setDeleting}
            />
          )}

          <DataPagination
            meta={meta}
            onPageChange={(next) => patchQuery({ page: next })}
            onPageSizeChange={(next) => patchQuery({ limit: next, page: 1 })}
          />
        </CardContent>
      </Card>

      <EmployeeDialog
        employeeId={viewingId}
        open={Boolean(viewingId)}
        onClose={() => setViewingId(null)}
      />
      <DeleteDialog
        open={Boolean(deleting)}
        employeeName={deleting?.fullName}
        loading={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
