import Link from 'next/link';
import { Mail, MapPin } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { APP_ROUTES, PUBLIC_NAV, SITE } from '../site-config';

/** Footer website public — mọi thông tin đọc từ `SITE` (không lặp lại email / địa chỉ ở nơi khác). */
export function PublicFooter() {
  return (
    <footer className="border-t border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <BrandLogo variant="mark" size="rail" className="size-9 rounded-lg" />
            <span className="text-base font-bold text-white">{SITE.name}</span>
          </div>
          <p className="text-sm leading-relaxed text-sidebar-muted">{SITE.description}</p>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-white">Điều hướng</h2>
          <ul className="space-y-2 text-sm">
            {PUBLIC_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sidebar-muted transition-colors hover:text-white"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-white">Tài khoản</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link
                href={APP_ROUTES.login}
                className="text-sidebar-muted transition-colors hover:text-white"
              >
                Đăng nhập
              </Link>
            </li>
            <li>
              <Link
                href={APP_ROUTES.register}
                className="text-sidebar-muted transition-colors hover:text-white"
              >
                Đăng ký
              </Link>
            </li>
          </ul>
        </div>

        <div id="lien-he">
          <h2 className="mb-3 text-sm font-semibold text-white">Liên hệ</h2>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-start gap-2">
              <Mail className="mt-0.5 size-4 shrink-0 text-sidebar-active" aria-hidden />
              <a
                href={`mailto:${SITE.contact.email}`}
                className="break-all text-sidebar-muted transition-colors hover:text-white"
              >
                {SITE.contact.email}
              </a>
            </li>
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-sidebar-active" aria-hidden />
              <span className="text-sidebar-muted">{SITE.contact.location}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-sidebar-border">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-sidebar-muted sm:px-6 lg:px-8">
          © {new Date().getFullYear()} {SITE.name}. Bảo lưu mọi quyền.
        </p>
      </div>
    </footer>
  );
}
