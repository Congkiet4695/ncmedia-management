'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@/i18n/config';
import { useMounted } from '@/hooks/use-mounted';
import { BUSINESS_TIME_ZONE, formatUsClock } from '@/utils/business-time';

const MS_PER_MINUTE = 60_000;

/**
 * Đồng hồ **giờ US (Los Angeles)** trên Header — cùng múi giờ với bộ lọc ngày và giờ hiển thị của Orders / Payout /
 * Dashboard (`utils/business-time`), tự đổi PST ⇄ PDT, không phụ thuộc giờ máy người xem.
 *
 * - Chạy hoàn toàn phía client: không gọi backend để lấy giờ.
 * - Cập nhật đúng lúc sang phút mới (không lệch tới 59 giây), và khi tab được mở lại sau lúc ngủ.
 * - Chỉ render sau khi mount — giờ của máy chủ khi SSR khác giờ lúc hydrate.
 * - Màn hình hẹp: chỉ còn giờ + PST/PDT (ngày và nhãn ẩn) để không chen avatar / nút đăng xuất.
 */
export function UsClock() {
  const { t, i18n } = useTranslation();
  const mounted = useMounted();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(new Date());
    // Chờ tới đầu phút kế tiếp rồi mới chạy đều mỗi phút.
    const timeout = setTimeout(
      () => {
        tick();
        interval = setInterval(tick, MS_PER_MINUTE);
      },
      MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE),
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!mounted) return null;

  const clock = formatUsClock(now, getIntlLocale(i18n.language));
  const full = `${t('usClock.label')} ${clock.date} ${clock.time} ${clock.zone}`;

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-muted/40 px-2 py-1 text-xs tabular-nums text-muted-foreground"
      title={`${full} (${BUSINESS_TIME_ZONE})`}
      aria-label={full}
      role="timer"
      aria-live="off"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden font-medium lg:inline">{t('usClock.label')}</span>
      <span className="hidden sm:inline">{clock.date}</span>
      <span className="font-semibold text-foreground">{clock.time}</span>
      <span>{clock.zone}</span>
    </div>
  );
}
