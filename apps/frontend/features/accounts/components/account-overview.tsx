'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AccountOverview, GroupCount } from '../types';

function StatCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${className ?? ''}`}>{value}</p>
    </div>
  );
}

function GroupTable({ title, header, rows }: { title: string; header: string; rows: GroupCount[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{header}</TableHead>
            <TableHead className="text-right">Live</TableHead>
            <TableHead className="text-right">Die trắng</TableHead>
            <TableHead className="text-right">Die</TableHead>
            <TableHead className="text-right">Tổng</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key ?? '__none__'}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{r.live}</TableCell>
              <TableCell className="text-right text-amber-600 dark:text-amber-400">{r.dieTrang}</TableCell>
              <TableCell className="text-right text-destructive">{r.die}</TableCell>
              <TableCell className="text-right font-medium">{r.total}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AccountOverviewPanel({ overview }: { overview: AccountOverview }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Tổng Account" value={overview.total} />
        <StatCard label="Live" value={overview.byStatus.live} className="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Die trắng" value={overview.byStatus.dieTrang} className="text-amber-600 dark:text-amber-400" />
        <StatCard label="Die" value={overview.byStatus.die} className="text-destructive" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <GroupTable title="Account theo Seller" header="Seller" rows={overview.bySeller} />
        <GroupTable title="Account theo Nền tảng" header="Nền tảng" rows={overview.byPlatform} />
      </div>
    </div>
  );
}
