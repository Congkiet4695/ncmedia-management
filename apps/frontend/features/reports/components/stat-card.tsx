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
  /** Bấm icon / con số ⇒ mở chi tiết (vd popup danh sách). Không truyền ⇒ thẻ tĩnh như cũ. */
  onClick?: () => void;
  /** Nhãn cho trình đọc màn hình / tooltip của nút. */
  actionLabel?: string;
}

/**
 * StatCard — thẻ KPI (Dashboard summary). Số lớn `text-3xl font-bold tabular-nums`
 * theo Design System (Stat/KPI card). Dark-mode qua token.
 */
export function StatCard({ label, value, icon: Icon, loading, className, onClick, actionLabel }: StatCardProps) {
  const action = onClick
    ? {
        type: 'button' as const,
        onClick,
        title: actionLabel,
        'aria-label': actionLabel,
        className:
          'rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      }
    : null;
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon &&
            (action ? (
              <button {...action} className={cn(action.className, 'p-1 text-muted-foreground hover:bg-primary/10')}>
                <Icon className="size-4" />
              </button>
            ) : (
              <Icon className="size-4 text-muted-foreground" />
            ))}
        </div>
        <div className="mt-2 min-h-9">
          {loading ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <p className="text-3xl font-bold tabular-nums tracking-tight">
              {action ? (
                <button {...action} className={cn(action.className, 'underline-offset-4 hover:underline')}>
                  {value}
                </button>
              ) : (
                value
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
