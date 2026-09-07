'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { DataPagination } from '@/components/ui/data-pagination';
import { Button } from '@/components/ui/button';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useFlashSaleLogs } from '../hooks';

/** Cỡ trang MẶC ĐỊNH — người dùng đổi được. */
const PAGE_SIZE = 10;

/** Màu badge theo mức nghiêm trọng — cùng bảng ba màu của toàn hệ thống. */
const LEVEL_VARIANT = {
  INFO: 'muted',
  WARN: 'warning',
  ERROR: 'destructive',
} as const;

/**
 * **History** của một đợt Flash Sale: mỗi lượt gọi sàn là một dòng, mở ra thấy **request đã
 * gửi** và **response nhận về**.
 *
 * 🔴 Hiển thị `request_id` của TikTok ở vị trí dễ sao chép: đó là thứ đầu tiên TikTok
 * Support hỏi khi mở ticket, và không có nó thì mọi mô tả lỗi đều vô dụng.
 *
 * 🔴 Payload để trong `<pre>` có thanh cuộn RIÊNG. JSON một dòng dài không được phép làm cả
 * trang cuộn ngang.
 */
export function FlashSaleLogPanel({ flashSaleId }: { flashSaleId: string }) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const logs = useFlashSaleLogs(flashSaleId, { page, limit });

  const items = logs.data?.items ?? [];
  const meta = logs.data?.meta;

  if (logs.isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t('flashSale.logs.empty')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((log) => {
        const isOpen = expanded === log.id;
        return (
          <div key={log.id} className="rounded-md border">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : log.id)}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent/50"
            >
              {isOpen ? (
                <ChevronDown className="mt-0.5 size-4 shrink-0" />
              ) : (
                <ChevronRight className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={LEVEL_VARIANT[log.level]}>{log.level}</Badge>
                  <span className="text-sm font-medium">
                    {t(`flashSale.logAction.${log.action}`, { defaultValue: log.action })}
                  </span>
                  {log.attempt > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('flashSale.logs.attempt', { attempt: log.attempt })}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 break-words text-sm text-muted-foreground">{log.message}</p>
                {log.errorCode && (
                  <p className="mt-0.5 text-xs text-destructive">
                    {t('flashSale.logs.errorCode')}:{' '}
                    <span className="font-mono">{log.errorCode}</span>
                    {log.errorMessage ? ` — ${log.errorMessage}` : ''}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDateTime(log.createdAt)}
              </span>
            </button>

            {isOpen && (
              <div className="space-y-3 border-t px-3 py-3 text-xs">
                {log.requestId && (
                  <p>
                    <span className="text-muted-foreground">{t('flashSale.logs.requestId')}: </span>
                    <span className="select-all font-mono">{log.requestId}</span>
                  </p>
                )}
                <LogPayload title={t('flashSale.logs.request')} value={log.request} />
                <LogPayload title={t('flashSale.logs.response')} value={log.response} />
              </div>
            )}
          </div>
        );
      })}

      <DataPagination
        meta={meta}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setLimit(next);
          setPage(1);
        }}
      />
    </div>
  );
}

/** Một khối JSON — có thanh cuộn riêng, không kéo cả trang cuộn ngang. */
function LogPayload({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
