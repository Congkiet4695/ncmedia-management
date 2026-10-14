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
  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const NAV_IDLE = 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground';
const NAV_ACTIVE = 'bg-primary/10 text-primary';

/** Link menu phẳng (cấp một hoặc menu con trong nhóm). */
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
      aria-current={active ? 'page' : undefined}
      className={cn(NAV_LINK_BASE, nested && 'py-1.5 pl-3 text-[13px]', active ? NAV_ACTIVE : NAV_IDLE)}
    >
      {/* Vạch chỉ báo bên trái — trạng thái active không chỉ dựa vào màu nền. */}
      {active && !nested && (
        <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-sidebar-active" />
      )}
      <Icon className={cn('shrink-0', nested ? 'size-3.5' : 'size-4', active ? 'text-primary' : 'opacity-80')} />
      <span className="truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

/**
 * Nhóm menu có thể mở rộng — tự mở khi một menu con đang active.
 *
 * `navigateToFirstChild` (vd Listing): tên nhóm là LINK tới menu con đầu tiên CÒN LẠI sau khi lọc quyền
 * (`children` ở đây đã qua `resolveNavigation`) — không bao giờ dẫn tới trang bị từ chối; mũi tên riêng
 * bên phải để mở / thu gọn. Không có cờ ⇒ cả hàng là nút mở / thu gọn như cũ.
 */
function NavGroup({ item, onNavigate }: { item: NavItemConfig; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation(MENU_NAMESPACE);
  const children = item.children ?? [];
  // Nhóm sáng khi MỘT MENU CON đang mở — không theo tiền tố URL của nhóm (route thật nằm dưới
  // `/dashboard/pod/*`, `href` của nhóm chỉ là khoá).
  const groupActive = children.some((child) => isActive(pathname, child.href));
  const [open, setOpen] = useState(groupActive);
  const Icon = item.icon;
  const label = t(item.labelKey);
  const panelId = `nav-group-${item.labelKey}`;

  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);

  const headerTone = groupActive ? 'text-foreground' : NAV_IDLE;
  const content = (
    <>
      <Icon className={cn('size-4 shrink-0', groupActive ? 'text-primary' : 'opacity-80')} />
      <span className="flex-1 truncate text-left">{label}</span>
    </>
  );
  const chevron = <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />;

  return (
    <div>
      {item.navigateToFirstChild && children[0] ? (
        <div className={cn('flex items-center rounded-lg', headerTone)}>
          <Link
            href={children[0].href}
            onClick={() => {
              setOpen(true);
              onNavigate?.();
            }}
            className={cn(NAV_LINK_BASE, 'min-w-0 flex-1 text-inherit hover:bg-transparent')}
          >
            {content}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t('toggleGroup', { label })}
            className="mr-1 rounded-md p-1.5 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(NAV_LINK_BASE, 'w-full', headerTone)}
        >
          {content}
          {chevron}
        </button>
      )}
      {open && (
        <div id={panelId} className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
          {children.map((child) => (
            <NavLink key={child.href} item={child} onNavigate={onNavigate} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarNav({ items, onNavigate }: { items: NavItemConfig[]; onNavigate?: () => void }) {
  const { t } = useTranslation(MENU_NAMESPACE);
  return (
    <nav aria-label={t('mainNavigation')} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
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

/** Logo + tên tổ chức ở đầu sidebar. */
function SidebarBrand({ orgName, appName }: { orgName: string; appName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info text-primary-foreground shadow-sm">
        <Building2 className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight text-foreground">{orgName}</p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">{appName}</p>
      </div>
    </div>
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

  // Esc đóng drawer menu trên mobile.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen, setSidebarOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const appName = t('appName');
  const orgName = organization?.name ?? appName;
  const navItems = resolveNavigation(hasPermission);

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <SidebarBrand orgName={orgName} appName={appName} />
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
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar shadow-xl">
            <div className="flex h-16 items-center justify-between gap-2 border-b border-sidebar-border px-4">
              <SidebarBrand orgName={orgName} appName={appName} />
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/90 px-4 supports-[backdrop-filter]:bg-card/75 supports-[backdrop-filter]:backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('menu:openMenu')}
          >
            <Menu className="size-4" />
          </Button>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            <div className="mx-1 hidden h-8 w-px bg-border sm:block" aria-hidden />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">{user.fullName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {role?.name ?? role?.code ?? t('member')}
              </p>
            </div>
            <Avatar src={user.avatar} name={user.fullName} className="size-9 ring-2 ring-primary/15" />
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">{t('action.logout')}</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
