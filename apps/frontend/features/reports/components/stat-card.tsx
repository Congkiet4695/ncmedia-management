'use client';

import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
}

/**
 * StatCard — thẻ KPI (Dashboard summary). Số lớn `text-3xl font-bold tabular-nums`
 * theo Design System (Stat/KPI card). Dark-mode qua token.
 */
export function StatCard({ label, value, icon: Icon, loading, className }: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon && <Icon className="size-4 text-muted-foreground" />}
        </div>
        <div className="mt-2 min-h-9">
          {loading ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <p className="text-3xl font-bold tabular-nums tracking-tight">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
