'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Sáu tab của Template Engine — thứ tự đúng theo luồng dựng listing. */
const TABS = [
  { href: '/dashboard/pod/templates/categories', labelKey: 'listing.tabs.categories' },
  { href: '/dashboard/pod/templates/skus', labelKey: 'listing.tabs.skus' },
  { href: '/dashboard/pod/templates/descriptions', labelKey: 'listing.tabs.descriptions' },
  { href: '/dashboard/pod/templates/images', labelKey: 'listing.tabs.images' },
  { href: '/dashboard/pod/templates/pricing', labelKey: 'listing.tabs.pricing' },
  { href: '/dashboard/pod/templates/listings', labelKey: 'listing.tabs.listings' },
] as const;

/**
 * Khung chung của khu Templates.
 *
 * Thanh tab chỉ để ĐIỀU HƯỚNG — mỗi loại template vẫn là một trang riêng, có URL riêng,
 * bộ lọc riêng và trạng thái riêng. Nhồi cả sáu vào một màn hình sẽ biến chỗ này thành
 * một form khổng lồ không ai dùng nổi.
 */
export default function PodTemplatesLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('pod');
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <nav
        aria-label={t('listing.tabs.ariaLabel')}
        className="flex flex-wrap gap-1 overflow-x-auto border-b pb-px"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted hover:text-foreground',
              )}
            >
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
