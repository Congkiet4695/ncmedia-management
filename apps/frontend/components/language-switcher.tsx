'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LOCALES, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { useMounted } from '@/hooks/use-mounted';
import { useLocaleStore } from '@/stores/locale.store';

/**
 * Nút đổi ngôn ngữ trên Header.
 *
 * Danh sách ngôn ngữ lấy từ `LOCALES` nên thêm ngôn ngữ mới KHÔNG phải sửa file này.
 * Đổi ngôn ngữ áp dụng ngay (react-i18next re-render toàn cây), không reload trang,
 * và được ghi nhớ trong localStorage bởi `useLocaleStore`.
 */
export function LanguageSwitcher() {
  const { t } = useTranslation();
  const mounted = useMounted();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Đóng khi bấm ra ngoài hoặc nhấn Escape — hành vi chuẩn của dropdown.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = LOCALES.find((item) => item.code === locale) ?? LOCALES[0];

  function select(code: Locale) {
    setLocale(code);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('language.switch')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!mounted}
        onClick={() => setOpen((value) => !value)}
        className="gap-2"
      >
        <Globe className="size-4" />
        {/* Trước khi mount thì chưa biết ngôn ngữ đã lưu ⇒ chỉ hiện icon để không lệch hydration. */}
        {mounted && (
          <span className="hidden sm:inline">
            {current.flag} {current.label}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-44 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
        >
          {LOCALES.map((item) => (
            <button
              key={item.code}
              type="button"
              role="menuitemradio"
              aria-checked={item.code === locale}
              onClick={() => select(item.code)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                item.code === locale
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span aria-hidden>{item.flag}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.code === locale && <Check className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
