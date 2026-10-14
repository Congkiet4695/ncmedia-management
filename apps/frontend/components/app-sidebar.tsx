'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/components/brand-logo';
import { Tooltip } from '@/components/ui/tooltip';
import { MENU_NAMESPACE, type NavItemConfig } from '@/config/navigation';
import { cn } from '@/lib/utils';

function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * Khung điều hướng NAVY (token `sidebar-*`). Active = nền vàng đồng của logo pha nhẹ + vạch trái + icon
 * vàng ⇒ trạng thái không chỉ dựa vào màu nền. Hover: nền sáng hơn + chữ / icon trắng. Focus ring vàng.
 * Menu con: chữ nhỏ, màu phụ, nằm sau đường kẻ dọc — phân biệt rõ với menu cấp một.
 */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active';
const NAV_LINK_BASE = cn(
  'group/nav relative flex min-h-9 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
  FOCUS,
);
const NAV_IDLE =
  'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
const NAV_ACTIVE =
  'bg-gradient-to-r from-sidebar-active/25 to-sidebar-active/5 text-sidebar-active-foreground ring-1 ring-inset ring-sidebar-active/25';
const NESTED_IDLE =
  'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
const NESTED_ACTIVE = 'bg-sidebar-active/15 font-semibold text-sidebar-active-foreground';
/** Icon chưa active: màu icon riêng, sáng lên khi hover hàng. */
const ICON_IDLE =
  'text-sidebar-icon transition-colors group-hover/nav:text-sidebar-accent-foreground';

/** Sidebar thu gọn: chỉ icon, nhãn hiện bằng tooltip bên phải (hover + focus bàn phím + chạm). */
function RailTooltip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return collapsed ? (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  ) : (
    <>{children}</>
  );
}

/** Link menu phẳng (cấp một hoặc menu con trong nhóm). */
function NavLink({
  item,
  onNavigate,
  nested,
  collapsed = false,
}: {
  item: NavItemConfig;
  onNavigate?: () => void;
  nested?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useTranslation(MENU_NAMESPACE);
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <RailTooltip label={label} collapsed={collapsed}>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          NAV_LINK_BASE,
          nested && 'min-h-8 py-1.5 pl-3 text-[13px]',
          collapsed && 'mx-auto size-10 justify-center px-0',
          active ? (nested ? NESTED_ACTIVE : NAV_ACTIVE) : nested ? NESTED_IDLE : NAV_IDLE,
        )}
      >
        {/* Vạch chỉ báo bên trái — trạng thái active không chỉ dựa vào màu nền. */}
        {active && !nested && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-sidebar-active"
          />
        )}
        <Icon
          className={cn(
            'shrink-0',
            nested ? 'size-3.5' : 'size-[18px]',
            active ? 'text-sidebar-active' : ICON_IDLE,
          )}
        />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    </RailTooltip>
  );
}

/**
 * Nhóm menu có thể mở rộng — tự mở khi một menu con đang active.
 *
 * `navigateToFirstChild` (vd Listing): tên nhóm là LINK tới menu con đầu tiên CÒN LẠI sau khi lọc quyền
 * (`children` ở đây đã qua `resolveNavigation`) — không bao giờ dẫn tới trang bị từ chối; mũi tên riêng
 * bên phải để mở / thu gọn. Không có cờ ⇒ cả hàng là nút mở / thu gọn như cũ.
 *
 * Sidebar thu gọn: nhóm chỉ còn icon; bấm ⇒ mở rộng sidebar và mở sẵn nhóm (menu con cần nhãn để chọn).
 */
function NavGroup({
  item,
  onNavigate,
  collapsed = false,
  onExpand,
}: {
  item: NavItemConfig;
  onNavigate?: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
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

  const headerTone = groupActive ? 'text-sidebar-accent-foreground' : NAV_IDLE;
  const icon = (
    <Icon className={cn('size-[18px] shrink-0', groupActive ? 'text-sidebar-active' : ICON_IDLE)} />
  );

  if (collapsed) {
    return (
      <RailTooltip label={label} collapsed>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            onExpand?.();
          }}
          aria-label={label}
          className={cn(
            NAV_LINK_BASE,
            'mx-auto size-10 justify-center px-0',
            groupActive ? 'bg-sidebar-accent text-sidebar-active-foreground' : NAV_IDLE,
          )}
        >
          {icon}
        </button>
      </RailTooltip>
    );
  }

  const content = (
    <>
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
    </>
  );
  const chevron = (
    <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
  );

  return (
    <div>
      {item.navigateToFirstChild && children[0] ? (
        <div className={cn('group/nav flex items-center rounded-lg', headerTone)}>
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
            aria-label={t('menu:toggleGroup', { label })}
            className={cn('mr-1 rounded-md p-1.5 hover:bg-sidebar-accent', FOCUS)}
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
        <div
          id={panelId}
          className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2"
        >
          {children.map((child) => (
            <NavLink key={child.href} item={child} onNavigate={onNavigate} nested />
          ))}
        </div>
      )}
    </div>
  );
}

interface AppSidebarProps {
  items: NavItemConfig[];
  orgName: string;
  /** Desktop thu gọn — chỉ còn icon. Drawer mobile luôn mở rộng. */
  collapsed?: boolean;
  /** Bấm một nhóm khi đang thu gọn ⇒ mở rộng sidebar. */
  onExpand?: () => void;
  /** Đóng drawer mobile sau khi điều hướng. */
  onNavigate?: () => void;
  /** Vùng phụ ở góc đầu sidebar (nút đóng drawer mobile). */
  headerAction?: ReactNode;
}

/**
 * Nội dung sidebar (logo + tên tổ chức + menu) — dùng chung cho sidebar desktop và drawer mobile.
 * Menu sinh từ `config/navigation.ts` đã lọc quyền; component KHÔNG tự quyết định quyền hay route.
 */
export function AppSidebar({
  items,
  orgName,
  collapsed = false,
  onExpand,
  onNavigate,
  headerAction,
}: AppSidebarProps) {
  const { t } = useTranslation(MENU_NAMESPACE);
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          'relative flex shrink-0 flex-col items-center gap-2 border-b border-sidebar-border',
          collapsed ? 'px-2 py-4' : 'px-4 pb-4 pt-5',
        )}
      >
        {collapsed ? (
          <BrandLogo variant="mark" size="rail" priority />
        ) : (
          <>
            <BrandLogo variant="full" size="sidebar" priority />
            <p
              className="w-full truncate text-center text-xs font-medium text-sidebar-muted"
              title={orgName}
            >
              {orgName}
            </p>
          </>
        )}
        {headerAction && <div className="absolute right-2 top-2">{headerAction}</div>}
      </div>

      <nav
        aria-label={t('menu:mainNavigation')}
        className={cn(
          'sidebar-scroll flex-1 space-y-1 overflow-y-auto py-4',
          collapsed ? 'px-2' : 'px-3',
        )}
      >
        {items.map((item) =>
          item.children?.length ? (
            <NavGroup
              key={item.href}
              item={item}
              onNavigate={onNavigate}
              collapsed={collapsed}
              onExpand={onExpand}
            />
          ) : (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} collapsed={collapsed} />
          ),
        )}
      </nav>
    </div>
  );
}
