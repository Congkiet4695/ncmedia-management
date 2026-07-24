'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Building2,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ShoppingBag,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useUiStore } from '@/stores/ui.store';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Menu con (nhóm có thể mở rộng) — vd nhóm Báo cáo. */
  children?: NavItem[];
}

/** 5 sub-menu của nhóm Báo cáo (Reports). */
const REPORT_CHILDREN: NavItem[] = [
  { label: 'Tổng quan', href: '/dashboard/reports/overview', icon: BarChart3 },
  { label: 'Doanh thu / Đơn Seller', href: '/dashboard/reports/seller', icon: BarChart3 },
  { label: 'Hiệu suất Seller', href: '/dashboard/reports/seller-performance', icon: BarChart3 },
  { label: 'Hiệu suất Kho', href: '/dashboard/reports/warehouse-performance', icon: BarChart3 },
  { label: 'Xếp hạng Seller', href: '/dashboard/reports/seller-ranking', icon: BarChart3 },
];

/**
 * Menu render theo PERMISSION (không hardcode role):
 * - employee.read → Nhân viên · account.read → Account · order.read → Order · profile.read → Hồ sơ của tôi.
 * - "Hồ sơ của tôi" chỉ hiện với người KHÔNG quản lý nhân viên (self-service); người có employee.read
 *   (ADMIN/quản lý) dùng menu "Nhân viên".
 *
 * ⇒ ADMIN: Dashboard, Nhân viên, Account, Order. EMPLOYEE: Dashboard, Account, Order, Hồ sơ của tôi.
 */
function buildNavItems(has: (code: string) => boolean): NavItem[] {
  const items: NavItem[] = [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }];
  if (has('employee.read')) {
    items.push({ label: 'Nhân viên', href: '/dashboard/employees', icon: Users });
  }
  if (has('account.read')) {
    items.push({ label: 'Account', href: '/dashboard/accounts', icon: ShoppingBag });
  }
  if (has('order.read')) {
    items.push({ label: 'Order', href: '/dashboard/orders', icon: ClipboardList });
  }
  if (has('report.read')) {
    items.push({ label: 'Báo cáo', href: '/dashboard/reports', icon: BarChart3, children: REPORT_CHILDREN });
  }
  if (has('profile.read') && !has('employee.read')) {
    items.push({ label: 'Hồ sơ của tôi', href: '/dashboard/profile', icon: UserRound });
  }
  return items;
}

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
  item: NavItem;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const pathname = usePathname();
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
      {item.label}
    </Link>
  );
}

/** Nhóm menu có thể mở rộng (vd Báo cáo) — tự mở khi 1 menu con đang active. */
function NavGroup({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
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
        <span className="flex-1 text-left">{item.label}</span>
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

function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
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

  const orgName = organization?.name ?? 'NCMedia';
  const navItems = buildNavItems(hasPermission);

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
            aria-label="Đóng menu"
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
                aria-label="Đóng menu"
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
            aria-label="Mở menu"
          >
            <Menu className="size-4" />
          </Button>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">{user.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {role?.name ?? role?.code ?? 'Thành viên'}
              </p>
            </div>
            <Avatar src={user.avatar} name={user.fullName} className="size-8" />
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
