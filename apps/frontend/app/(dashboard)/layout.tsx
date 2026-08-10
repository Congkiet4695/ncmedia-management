'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronDown, Loader2, LogOut, Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { MENU_NAMESPACE, resolveNavigation, type NavItemConfig } from '@/config/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useUiStore } from '@/stores/ui.store';

function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_LINK_BASE =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors';

/** Link menu phẳng. */
function NavLink({
  item,
  onNavigate,
  nested,
}: {
  item: NavItemConfig;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useTranslation(MENU_NAMESPACE);
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        NAV_LINK_BASE,
        nested && 'py-1.5 pl-9 text-[13px]',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {!nested && <Icon className="size-4" />}
      {t(item.labelKey)}
    </Link>
  );
}

/** Nhóm menu có thể mở rộng (vd nhóm POD) — tự mở khi 1 menu con đang active. */
function NavGroup({ item, onNavigate }: { item: NavItemConfig; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation(MENU_NAMESPACE);
  const groupActive = isActive(pathname, item.href);
  const [open, setOpen] = useState(groupActive);
  const Icon = item.icon;

  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          NAV_LINK_BASE,
          'w-full',
          groupActive
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Icon className="size-4" />
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {item.children!.map((child) => (
            <NavLink key={child.href} item={child} onNavigate={onNavigate} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarNav({ items, onNavigate }: { items: NavItemConfig[]; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-4">
      {items.map((item) =>
        item.children?.length ? (
          <NavGroup key={item.href} item={item} onNavigate={onNavigate} />
        ) : (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

/**
 * Layout Dashboard (shell): sidebar + header + main.
 * Guard phía client: đã qua AuthProvider (đợi /me) + middleware. Ở đây chỉ chốt lần cuối:
 * hết loading mà không có user → về /login. KHÔNG chứa nghiệp vụ Dashboard.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation(['common', 'menu']);
  const { user, organization, role, loading, logout, hasPermission } = useAuth();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const orgName = organization?.name ?? t('appName');
  const navItems = resolveNavigation(hasPermission);

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Building2 className="size-5 text-primary" />
          <span className="truncate font-semibold">{orgName}</span>
        </div>
        <SidebarNav items={navItems} />
      </aside>

      {/* Drawer mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={t('menu:closeMenu')}
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-card">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                <span className="truncate font-semibold">{orgName}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(false)}
                aria-label={t('menu:closeMenu')}
              >
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav items={navItems} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Nội dung chính */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('menu:openMenu')}
          >
            <Menu className="size-4" />
          </Button>

          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">{user.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {role?.name ?? role?.code ?? t('member')}
              </p>
            </div>
            <Avatar src={user.avatar} name={user.fullName} className="size-8" />
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">{t('action.logout')}</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
