'use client';

import { CalendarClock, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { MeOrganizationPlan } from '@/features/auth/types';

/** Còn ≤ N ngày thì báo "sắp hết hạn". */
const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const CHIP =
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium tabular-nums';
const TONE = {
  normal: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

/**
 * Header Admin / Employee — **số Shop đang kết nối / giới hạn** (bên TRÁI giờ US).
 *
 * Dữ liệu từ `/auth/me` (`organization.plan`) — không gọi thêm API, không polling: làm mới ở lần tải trang kế tiếp
 * (vd sau khi liên kết TikTok xong). Cùng phép đếm với backend khi chặn kết nối vượt giới hạn.
 */
export function ShopUsageBadge({ plan }: { plan: MeOrganizationPlan }) {
  const { t } = useTranslation('common');
  const { formatNumber } = useLocaleFormat();
  const limit = plan.shopLimit;
  const tone =
    limit === null ? 'normal' : plan.connectedShopCount >= limit ? 'danger' : plan.connectedShopCount >= limit * 0.9 ? 'warning' : 'normal';
  const value = `${formatNumber(plan.connectedShopCount)} / ${limit === null ? t('orgPlan.unlimited') : formatNumber(limit)}`;

  return (
    <div className={cn(CHIP, TONE[tone])} title={t('orgPlan.shopsTitle')} aria-label={`${t('orgPlan.shopsTitle')}: ${value}`}>
      <Store className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{t('orgPlan.shops')}:</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Header Admin / Employee — **ngày hết hạn gói** (bên PHẢI giờ US). Hết hạn ⇒ "Đã hết hạn" màu đỏ; còn ≤ 7 ngày ⇒
 * màu cảnh báo. Ngày hiển thị theo giờ máy người xem — cùng cách Super Admin thấy ngày này ở màn Organizations.
 */
export function PlanExpiryBadge({ plan }: { plan: MeOrganizationPlan }) {
  const { t } = useTranslation('common');
  const { formatDate } = useLocaleFormat();
  if (!plan.expiresAt) return null;

  const remainingMs = new Date(plan.expiresAt).getTime() - Date.now();
  const tone = plan.expired ? 'danger' : remainingMs <= EXPIRING_SOON_DAYS * DAY_MS ? 'warning' : 'normal';
  const date = formatDate(plan.expiresAt);
  const title = plan.expired ? t('orgPlan.expired') : tone === 'warning' ? t('orgPlan.expiringSoon') : t('orgPlan.expiresTitle');

  return (
    <div className={cn(CHIP, TONE[tone])} title={`${title} — ${date}`} aria-label={`${title}: ${date}`}>
      <CalendarClock className="size-3.5" aria-hidden />
      {plan.expired ? (
        <span>{t('orgPlan.expired')}</span>
      ) : (
        <>
          <span className="hidden sm:inline">{t('orgPlan.expires')}:</span>
          <span>{date}</span>
        </>
      )}
    </div>
  );
}
