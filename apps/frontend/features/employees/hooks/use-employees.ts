'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  employeeService,
  type CreateEmployeePayload,
  type UpdateEmployeePayload,
} from '../services/employee.service';
import type { EmployeeListResult, EmployeeQuery } from '../types';

const EMPLOYEES_KEY = 'employees';
const ROLES_KEY = 'roles';

export function useEmployees(query: EmployeeQuery) {
  return useQuery({
    queryKey: [EMPLOYEES_KEY, 'list', query],
    queryFn: () => employeeService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useEmployee(id?: string) {
  return useQuery({
    queryKey: [EMPLOYEES_KEY, 'detail', id],
    queryFn: () => employeeService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: [ROLES_KEY],
    queryFn: () => employeeService.listRoles(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEmployeePayload) => employeeService.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [EMPLOYEES_KEY] }),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateEmployeePayload }) =>
      employeeService.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [EMPLOYEES_KEY] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) => employeeService.resetPassword(id),
  });
}

/** Context cho optimistic update khi xóa. */
interface DeleteContext {
  snapshots: Array<[QueryKey, EmployeeListResult | undefined]>;
}

/**
 * useDeleteEmployee — Optimistic Update: gỡ ngay khỏi cache list, rollback nếu lỗi,
 * invalidate khi settled để đồng bộ với server.
 */
export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string, DeleteContext>({
    mutationFn: (id: string) => employeeService.remove(id),
    onMutate: async (id): Promise<DeleteContext> => {
      await queryClient.cancelQueries({ queryKey: [EMPLOYEES_KEY, 'list'] });
      const snapshots = queryClient.getQueriesData<EmployeeListResult>({
        queryKey: [EMPLOYEES_KEY, 'list'],
      });
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        queryClient.setQueryData<EmployeeListResult>(key, {
          ...data,
          items: data.items.filter((e) => e.id !== id),
          meta: { ...data.meta, total: Math.max(0, data.meta.total - 1) },
        });
      });
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [EMPLOYEES_KEY] }),
  });
}
