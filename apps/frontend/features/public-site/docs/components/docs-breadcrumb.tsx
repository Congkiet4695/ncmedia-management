import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { PUBLIC_ROUTES } from '../../site-config';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Breadcrumb: Trang chủ › … (mục cuối là trang hiện tại, không có link). */
export function DocsBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const all: BreadcrumbItem[] = [{ label: 'Trang chủ', href: PUBLIC_ROUTES.home }, ...items];
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {all.map((item, index) => {
          const last = index === all.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-foreground hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'text-foreground' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
