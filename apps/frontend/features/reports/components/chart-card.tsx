'use client';

import type { ReactNode } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';

interface ChartCardProps {
  title: string;
  description?: string;
  /** Toolbar (dropdown metric/groupBy…) hiển thị bên phải tiêu đề. */
  toolbar?: ReactNode;
  loading?: boolean;
  error?: unknown;
  /** Rỗng khi không có dữ liệu để vẽ. */
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Chiều cao vùng nội dung (px). */
  height?: number;
  children: ReactNode;
}

/**
 * ChartCard — khung Card chuẩn cho biểu đồ: tiêu đề + toolbar + xử lý đủ trạng thái
 * Loading / Error / Empty / Populated (Design System §16–18). Dark-mode qua token.
 */
export function ChartCard({
  title,
  description,
  toolbar,
  loading,
  error,
  isEmpty,
  emptyMessage,
  height = 320,
  children,
}: ChartCardProps) {
  const { t } = useTranslation('report');
  const translateApiError = useApiError();
  const emptyText = emptyMessage ?? t('noData');

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ height }} className="w-full">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm text-destructive">
                {translateApiError(error)}
              </p>
            </div>
          ) : isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <BarChart3 className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{emptyText}</p>
            </div>
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  );
}
