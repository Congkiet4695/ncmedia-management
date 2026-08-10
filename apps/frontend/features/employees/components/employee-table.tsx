'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { Eye, Loader2, Pencil, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { EmployeeStatusBadge } from './employee-status-badge';
import type { EmployeeListItem } from '../types';

interface EmployeeTableProps {
  employees: EmployeeListItem[];
  loading?: boolean;
  onView: (employee: EmployeeListItem) => void;
  onDelete: (employee: EmployeeListItem) => void;
}

export function EmployeeTable({ employees, loading, onView, onDelete }: EmployeeTableProps) {
  const { t } = useTranslation(['employee', 'common']);
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Users className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('column')}</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>{t('phoneShort')}</TableHead>
          <TableHead>{t('field.department')}</TableHead>
          <TableHead>{t('field.status')}</TableHead>
          <TableHead>{t('field.startDate')}</TableHead>
          <TableHead>{t('resignedAt')}</TableHead>
          <TableHead className="text-right">{t('common:table.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((employee) => (
          <TableRow key={employee.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar src={employee.avatar} name={employee.fullName} />
                <span className="font-medium">{employee.fullName}</span>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{employee.email}</TableCell>
            <TableCell className="whitespace-nowrap">{employee.phone ?? '—'}</TableCell>
            <TableCell>{employee.department ?? '—'}</TableCell>
            <TableCell>
              <EmployeeStatusBadge status={employee.status} />
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDate(employee.startDate)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDate(employee.resignedAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:action.viewDetail')}
                  onClick={() => onView(employee)}
                >
                  <Eye className="size-4" />
                </Button>
                <Button asChild variant="ghost" size="icon" aria-label={t('common:action.edit')}>
                  <Link href={`/dashboard/employees/${employee.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:action.delete')}
                  onClick={() => onDelete(employee)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
