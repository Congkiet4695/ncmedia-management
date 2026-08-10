'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useTranslation } from 'react-i18next';
import { EMPLOYEE_STATUSES } from '../schemas/employee.schema';
import type { EmployeeStatus } from '../types';

interface EmployeeFilterProps {
  search: string;
  status?: EmployeeStatus;
  department: string;
  startDate: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value?: EmployeeStatus) => void;
  onDepartmentChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
}

export function EmployeeFilter({
  search,
  status,
  department,
  startDate,
  onSearchChange,
  onStatusChange,
  onDepartmentChange,
  onStartDateChange,
}: EmployeeFilterProps) {
  const { t } = useTranslation('employee');
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="flex-1 space-y-1.5 lg:min-w-56">
        <Label htmlFor="emp-search" className="text-xs text-muted-foreground">
          {t('searchLabel')}
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="emp-search"
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5 lg:w-44">
        <Label htmlFor="emp-status" className="text-xs text-muted-foreground">
          {t('field.status')}
        </Label>
        <NativeSelect
          id="emp-status"
          value={status ?? ''}
          onChange={(e) => onStatusChange((e.target.value || undefined) as EmployeeStatus | undefined)}
        >
          <option value="">{t('all')}</option>
          {EMPLOYEE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5 lg:w-44">
        <Label htmlFor="emp-department" className="text-xs text-muted-foreground">
          {t('field.department')}
        </Label>
        <Input
          id="emp-department"
          placeholder="VD: Kinh doanh"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 lg:w-44">
        <Label htmlFor="emp-start" className="text-xs text-muted-foreground">
          {t('startedFrom')}
        </Label>
        <Input
          id="emp-start"
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
        />
      </div>
    </div>
  );
}
