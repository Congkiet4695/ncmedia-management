'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PUBLIC_ROUTES } from '../../site-config';
import type { DocSearchEntry } from '../search-text';
import { DocsSearch } from './docs-search';

export interface SidebarGroup {
  id: string;
  title: string;
  items: { slug: string; title: string }[];
}

/**
 * Menu tài liệu. Desktop (lg+): cột trái cố định khi cuộn. Mobile/tablet: nút "Danh mục tài liệu" mở/đóng danh sách,
 * tự đóng khi chuyển bài.
 */
export function DocsSidebar({
  groups,
  searchIndex,
}: {
  groups: SidebarGroup[];
  searchIndex: DocSearchEntry[];
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const nav = (
    <nav aria-label="Danh mục tài liệu" className="space-y-6">
      {groups.map((group) => (
        <div key={group.id}>
          <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </h2>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const href = `${PUBLIC_ROUTES.docs}/${item.slug}`;
              const active = pathname === href;
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active &&
                        'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile / tablet */}
      <div className="space-y-3 lg:hidden">
        <DocsSearch index={searchIndex} />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="docs-mobile-nav"
          className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Danh mục tài liệu
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {open && (
          <div id="docs-mobile-nav" className="rounded-lg border bg-card p-3">
            {nav}
          </div>
        )}
      </div>

      {/* Desktop */}
      <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto pb-8 pr-2 lg:block">
        <DocsSearch index={searchIndex} />
        {nav}
      </aside>
    </>
  );
}
