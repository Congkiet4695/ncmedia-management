'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Thời gian giữ dấu tick sau khi copy. */
const FEEDBACK_MS = 1400;

/**
 * Nút Copy dùng chung cho Order ID và Tracking Number (§1, §5).
 *
 * 🔴 Có `navigator.clipboard` thì dùng, không thì rơi về `document.execCommand`: trình duyệt
 * chặn Clipboard API trên kết nối không phải HTTPS, mà nhiều môi trường nội bộ chạy HTTP
 * thuần — mất nút copy ở đó là mất đúng thao tác được dùng nhiều nhất màn hình này.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation('pod');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dọn timer khi component biến mất (đổi trang, đổi bộ lọc) — tránh setState sau unmount.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    (event: React.MouseEvent) => {
      // Dòng bảng có thể click để mở rộng; copy KHÔNG được kéo theo hành động đó.
      event.stopPropagation();

      const done = (): void => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
      };

      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value).then(done, fallback);
        return;
      }
      fallback();

      function fallback(): void {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
          document.execCommand('copy');
          done();
        } finally {
          area.remove();
        }
      }
    },
    [value],
  );

  return (
    <Tooltip content={copied ? t('orders.copied') : (label ?? t('orders.copy'))}>
      <button
        type="button"
        onClick={copy}
        aria-label={label ?? t('orders.copy')}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </button>
    </Tooltip>
  );
}
