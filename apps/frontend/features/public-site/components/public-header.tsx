'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { APP_ROUTES, PUBLIC_NAV, SITE } from '../site-config';

/** Đường dẫn đang mở có thuộc mục menu này không (vd /docs/abc thuộc "Tài liệu"). */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Header website public: Logo | Trang chủ | Tài liệu | Bảng giá | Đăng nhập | Đăng ký.
 * Mobile (< md): nút menu mở danh sách dọc — đóng bằng Esc, khi chọn mục, hoặc khi đổi trang.
 */
export function PublicHeader() {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href="/home"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandLogo variant="mark" size="rail" className="size-9 rounded-lg" priority />
          <span className="text-base font-bold tracking-tight">{SITE.name}</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="hidden flex-1 items-center gap-1 md:flex">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive(pathname, item.href) && 'text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button variant="ghost" asChild>
            <Link href={APP_ROUTES.login}>Đăng nhập</Link>
          </Button>
          <Button asChild>
            <Link href={APP_ROUTES.register}>Đăng ký</Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto md:hidden"
          aria-label={open ? 'Đóng menu' : 'Mở menu'}
          aria-expanded={open}
          aria-controls="public-mobile-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {open && (
        <div id="public-mobile-menu" className="border-t border-border/70 bg-background md:hidden">
          <nav
            aria-label="Điều hướng chính (mobile)"
            className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3"
          >
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive(pathname, item.href) && 'bg-muted text-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
              <Button variant="outline" asChild>
                <Link href={APP_ROUTES.login}>Đăng nhập</Link>
              </Button>
              <Button asChild>
                <Link href={APP_ROUTES.register}>Đăng ký</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
