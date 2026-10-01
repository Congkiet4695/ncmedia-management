'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { cn } from '@/lib/utils';

interface WidgetCardProps {
  title: string;
  icon?: LucideIcon;
  /** Giải thích nguồn số liệu (icon "?" cạnh tiêu đề). */
  hint?: string;
  /** Vùng bên phải tiêu đề (bộ lọc riêng, nút…). */
  toolbar?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Khung chung của MỌI widget Dashboard: tiêu đề + icon + chú thích nguồn số liệu, và tự xử lý
 * Loading (skeleton) / Error (riêng widget, có nút thử lại). Một widget lỗi không làm trắng Dashboard.
 */
export function WidgetCard({
  title,
  icon: Icon,
  hint,
  toolbar,
  loading,
  error,
  onRetry,
  className,
  contentClassName,
  children,
}: WidgetCardProps) {
  const { t } = useTranslation('dashboard');
  const translateApiError = useApiError();

  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
          {hint && (
            <Tooltip content={hint}>
              <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" aria-label={hint} />
            </Tooltip>
          )}
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      <CardContent className={cn('flex-1 p-5', contentClassName)}>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : error ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-destructive">{translateApiError(error)}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t('retry')}
              </Button>
            )}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** "Không có dữ liệu" gọn trong widget. */
export function WidgetEmpty({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}
