'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { POD_DATE_PRESETS, type PodDatePreset } from '../order-types';

interface OrderDateFilterProps {
  preset?: PodDatePreset;
  from?: string;
  to?: string;
  /** `from`/`to` chỉ có giá trị khi preset = CUSTOM. */
  onChange: (value: { preset?: PodDatePreset; from?: string; to?: string }) => void;
}

/**
 * Bộ lọc thời gian theo Ngày đặt đơn.
 *
 * Chỉ gửi `datePreset` (và `orderedFrom`/`orderedTo` khi chọn "Tùy chọn") lên backend —
 * việc quy đổi mốc thời gian do BACKEND làm theo múi giờ vận hành, frontend KHÔNG tự lọc.
 */
export function OrderDateFilter({ preset, from, to, onChange }: OrderDateFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from ?? '');
  const [customTo, setCustomTo] = useState(to ?? '');
  const [rangeErrorKey, setRangeErrorKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = preset ?? 'ALL';

  // Đóng dropdown khi click ra ngoài.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    setCustomFrom(from ?? '');
    setCustomTo(to ?? '');
  }, [from, to]);

  const label =
    active === 'CUSTOM' && from && to
      ? `${from} → ${to}`
      : t(`date.preset.${active}`);

  const handlePreset = (value: PodDatePreset) => {
    if (value === 'CUSTOM') {
      // Giữ dropdown mở để người dùng nhập khoảng ngày.
      onChange({ preset: 'CUSTOM', from: customFrom || undefined, to: customTo || undefined });
      return;
    }
    setRangeErrorKey(null);
    onChange({ preset: value === 'ALL' ? undefined : value, from: undefined, to: undefined });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) {
      setRangeErrorKey('date.rangeRequired');
      return;
    }
    if (customFrom > customTo) {
      setRangeErrorKey('date.rangeInvalid');
      return;
    }
    setRangeErrorKey(null);
    onChange({ preset: 'CUSTOM', from: customFrom, to: customTo });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="min-w-[190px] justify-between"
      >
        <span className="flex items-center gap-2 truncate">
          <CalendarRange className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[280px] rounded-md border bg-card p-1 shadow-lg">
          {POD_DATE_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handlePreset(value)}
              className={cn(
                'flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm',
                'hover:bg-accent hover:text-accent-foreground',
                active === value && 'bg-accent/60 font-medium',
              )}
            >
              {t(`date.preset.${value}`)}
              {active === value && <Check className="size-4" />}
            </button>
          ))}

          {active === 'CUSTOM' && (
            <div className="space-y-2 border-t p-3">
              <div className="space-y-1">
                <Label htmlFor="date-from" className="text-xs">
                  {t('date.from')}
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="date-to" className="text-xs">
                  {t('date.to')}
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9"
                />
              </div>
              {rangeErrorKey && (
                <p className="text-xs text-destructive">{t(rangeErrorKey)}</p>
              )}
              <Button type="button" size="sm" className="w-full" onClick={applyCustom}>
                {t('action.apply')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
