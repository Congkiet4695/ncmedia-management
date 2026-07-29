'use client';

import Link from 'next/link';
import { KeyRound, Loader2, Pencil, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatUSD } from '@/lib/format';
import { AccountStatusBadge } from './account-status-badge';
import type { AccountListItem } from '../types';

interface AccountTableProps {
  accounts: AccountListItem[];
  loading?: boolean;
  onDelete: (account: AccountListItem) => void;
}

export function AccountTable({ accounts, loading, onDelete }: AccountTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ShoppingBag className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chưa có Account nào.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tên Account</TableHead>
          <TableHead>Nền tảng</TableHead>
          <TableHead>Seller</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead>Ngày cấp</TableHead>
          <TableHead>Ngày die</TableHead>
          <TableHead>Tuổi thọ</TableHead>
          <TableHead className="whitespace-nowrap text-right">Hold</TableHead>
          <TableHead className="whitespace-nowrap text-right">Net</TableHead>
          <TableHead className="whitespace-nowrap text-right">Paid</TableHead>
          <TableHead className="text-right">Thao tác</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <div className="flex items-center gap-2 font-medium">
                {a.name}
                {a.hasCredentials && <KeyRound className="size-3.5 text-muted-foreground" />}
              </div>
            </TableCell>
            <TableCell>{a.platformName ?? '—'}</TableCell>
            <TableCell>{a.sellerName ?? '—'}</TableCell>
            <TableCell>
              <AccountStatusBadge status={a.status} />
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDate(a.issuedAt)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDate(a.diedAt)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {a.lifespanDays != null ? `${a.lifespanDays} ngày` : '—'}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatUSD(a.holdAmount)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatUSD(a.netAmount)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatUSD(a.paidAmount)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button asChild variant="ghost" size="icon" aria-label="Chi tiết / Sửa">
                  <Link href={`/dashboard/accounts/${a.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" aria-label="Xóa" onClick={() => onDelete(a)}>
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
