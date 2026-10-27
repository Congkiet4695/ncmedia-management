'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from '@/components/app-sidebar';
import { BrandLogo } from '@/components/brand-logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { UsClock } from '@/components/us-clock';
import { ThemeToggle } from '@/components/theme-toggle';
import { resolveNavigation } from '@/config/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useUiStore } from '@/stores/ui.store';

/**
 * Layout Dashboard (shell): sidebar navy + header sáng + khung nội dung (nền `content`) trên canvas.
 * Guard phía client: đã qua AuthProvider (đợi /me) + middleware. Ở đây chỉ chốt lần cuối:
 * hết loading mà không có user → về /login. KHÔNG chứa nghiệp vụ Dashboard.
 *
 * Sidebar desktop mở rộng (w-64) / thu gọn chỉ icon (w-[76px]) — nút ở đầu header, ghi nhớ theo trình duyệt.
 * Mobile (< md): sidebar là drawer, mở bằng nút menu; Esc / bấm nền / chọn menu để đóng.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation(['common', 'menu']);
  const { user, organization, role, loading, logout, hasPermission } = useAuth();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const setCollapsed = useUiStore((state) => state.setSidebarCollapsed);
  const initSidebar = useUiStore((state) => state.initSidebar);

  useEffect(() => {
    initSidebar();
  }, [initSidebar]);

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
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas"
        role="status"
      >
        <BrandLogo variant="mark" size="splash" priority />
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <span className="sr-only">{t('common:state.loading')}</span>
      </div>
    );
  }

  const appName = t('appName');
  const orgName = organization?.name ?? appName;
  const navItems = resolveNavigation(hasPermission);
  const roleName = role?.name ?? role?.code ?? t('member');

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border transition-[width] duration-200 motion-reduce:transition-none md:flex',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <AppSidebar
          items={navItems}
          orgName={orgName}
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
        />
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
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-sidebar-border shadow-xl">
            <AppSidebar
              items={navItems}
              orgName={orgName}
              onNavigate={() => setSidebarOpen(false)}
              headerAction={
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  aria-label={t('menu:closeMenu')}
                  className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active"
                >
                  <X className="size-4" />
                </button>
              }
            />
          </aside>
        </div>
      )}

      {/* Nội dung chính */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/90 px-4 shadow-sm supports-[backdrop-filter]:bg-card/80 supports-[backdrop-filter]:backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('menu:openMenu')}
            aria-expanded={sidebarOpen}
          >
            <Menu className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t('menu:expandSidebar') : t('menu:collapseSidebar')}
            title={collapsed ? t('menu:expandSidebar') : t('menu:collapseSidebar')}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </Button>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {/* Giờ US (Los Angeles) — bên trái nút đổi ngôn ngữ; cùng múi giờ với Orders / Payout / Dashboard. */}
            <UsClock />
            <LanguageSwitcher />
            <ThemeToggle />
            <div className="mx-1 hidden h-8 w-px bg-border sm:block" aria-hidden />
            <div className="flex items-center gap-3 rounded-full py-1 pl-1 pr-1 sm:pr-3">
              <Avatar
                src={user.avatar}
                name={user.fullName}
                className="size-9 ring-2 ring-primary/15"
              />
              <div className="hidden min-w-0 max-w-44 sm:block">
                <p className="truncate text-sm font-semibold leading-tight">{user.fullName}</p>
                <p className="truncate text-xs leading-tight text-muted-foreground">{roleName}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={logout} aria-label={t('action.logout')}>
              <LogOut className="size-4" />
              <span className="hidden lg:inline">{t('action.logout')}</span>
            </Button>
          </div>
        </header>

        {/*
          Khung nội dung chính: nền `content` sáng hơn canvas, bo góc + viền + bóng nhẹ ⇒ tách khỏi nền
          ứng dụng; card trắng bên trong nổi trên khung. Padding trong giữ như cũ. Mobile: khung tràn
          viền (không lề / bo góc) để không mất chiều ngang. KHÔNG `overflow-hidden` — giữ `sticky` của trang.
        */}
        <main className="flex flex-1 flex-col md:p-3 xl:p-4">
          <div className="flex-1 bg-content p-4 md:rounded-2xl md:border md:border-border/80 md:p-6 md:shadow-sm xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
