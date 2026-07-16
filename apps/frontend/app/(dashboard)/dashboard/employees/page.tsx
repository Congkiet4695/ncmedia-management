'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getApiErrorMessage } from '@/utils/http';
import { DeleteDialog } from '@/features/employees/components/delete-dialog';
import { EmployeeDialog } from '@/features/employees/components/employee-dialog';
import { EmployeeFilter } from '@/features/employees/components/employee-filter';
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

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Đã xóa nhân viên', { description: deleting.fullName });
      setDeleting(null);
    } catch (error) {
      toast.error('Xóa thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nhân viên</h1>
          <p className="text-sm text-muted-foreground">Quản lý nhân viên trong tổ chức của bạn.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/employees/create">
            <Plus className="size-4" />
            Thêm nhân viên
          </Link>
        </Button>
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
              {getApiErrorMessage(employeesQuery.error, 'Không tải được danh sách nhân viên')}
            </p>
          ) : (
            <EmployeeTable
              employees={items}
              loading={employeesQuery.isLoading}
              onView={(e) => setViewingId(e.id)}
              onDelete={setDeleting}
            />
          )}

          {meta && meta.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Trang {meta.page}/{meta.totalPages} · {meta.total} nhân viên
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  Sau
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
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
