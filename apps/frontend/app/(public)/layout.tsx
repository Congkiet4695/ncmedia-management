import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicFooter } from '@/features/public-site/components/public-footer';
import { PublicHeader } from '@/features/public-site/components/public-header';
import { SITE, SITE_OPEN_GRAPH } from '@/features/public-site/site-config';

/**
 * Layout website PUBLIC (/home, /docs, /pricing) — không cần đăng nhập: middleware không chặn các đường dẫn này và
 * `AuthProvider` bỏ qua cổng phiên cho chúng (`isPublicSitePath`). Không dùng chung shell với dashboard.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} - Nền tảng quản lý TikTok Shop & Fulfillment`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  icons: { icon: SITE.logo, apple: SITE.logo },
  openGraph: SITE_OPEN_GRAPH,
  twitter: { card: 'summary_large_image' },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Bỏ qua đến nội dung
      </a>
      <PublicHeader />
      <main id="noi-dung" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
