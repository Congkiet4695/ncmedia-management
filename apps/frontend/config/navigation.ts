/**
 * Cấu hình menu Sidebar — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Sidebar được sinh hoàn toàn từ mảng `NAVIGATION` dưới đây, nên muốn thêm / bớt / ẩn
 * một menu chỉ cần sửa ĐÚNG file này, không đụng tới component layout.
 *
 * Ẩn menu: đặt `hidden: true`. Đây là ẩn Ở TẦNG GIAO DIỆN — route, permission, API,
 * service và database đều giữ nguyên, người dùng gõ thẳng URL vẫn vào được như cũ.
 * Bật lại chỉ cần xoá dòng `hidden: true`.
 */

import {
  BarChart3,
  ClipboardList,
  Factory,
  Link2,
  LayoutDashboard,
  Package,
  ShoppingBag,
  Store,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Namespace } from '@/i18n/config';

export interface NavItemConfig {
  /** Khoá dịch trong namespace `menu` (vd `menu:employees`). */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** Mã permission cần có để thấy menu. Bỏ trống ⇒ ai cũng thấy. */
  permission?: string;
  /**
   * Mã permission KHÔNG được có thì mới hiện (menu self-service).
   * Vd "Hồ sơ của tôi" chỉ dành cho người không quản lý nhân viên.
   */
  hiddenWhenPermission?: string;
  /**
   * `true` ⇒ ẩn khỏi Sidebar. Không xoá route/permission/API — chỉ ẩn trên giao diện.
   * Xoá dòng này là menu hiện lại ngay.
   */
  hidden?: boolean;
  children?: NavItemConfig[];
}

/** Namespace chứa toàn bộ nhãn menu. */
export const MENU_NAMESPACE: Namespace = 'menu';

export const NAVIGATION: NavItemConfig[] = [
  { labelKey: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    labelKey: 'employees',
    href: '/dashboard/employees',
    icon: Users,
    permission: 'employee.read',
  },

  // ⛔ TẠM ẨN theo yêu cầu vận hành — giữ nguyên route/permission/API/DB.
  {
    labelKey: 'accounts',
    href: '/dashboard/accounts',
    icon: ShoppingBag,
    permission: 'account.read',
    hidden: true,
  },
  // ⛔ TẠM ẨN
  {
    labelKey: 'orders',
    href: '/dashboard/orders',
    icon: ClipboardList,
    permission: 'order.read',
    hidden: true,
  },
  // ⛔ TẠM ẨN (ẩn cả nhóm, gồm 5 báo cáo con)
  {
    labelKey: 'reports',
    href: '/dashboard/reports',
    icon: BarChart3,
    permission: 'report.read',
    hidden: true,
    children: [
      { labelKey: 'reportOverview', href: '/dashboard/reports/overview', icon: BarChart3 },
      { labelKey: 'reportSeller', href: '/dashboard/reports/seller', icon: BarChart3 },
      {
        labelKey: 'reportSellerPerformance',
        href: '/dashboard/reports/seller-performance',
        icon: BarChart3,
      },
      {
        labelKey: 'reportWarehouse',
        href: '/dashboard/reports/warehouse-performance',
        icon: BarChart3,
      },
      {
        labelKey: 'reportSellerRanking',
        href: '/dashboard/reports/seller-ranking',
        icon: BarChart3,
      },
    ],
  },

  {
    labelKey: 'pod',
    href: '/dashboard/pod',
    icon: Package,
    children: [
      {
        labelKey: 'podTiktokAccounts',
        href: '/dashboard/pod/tiktok-accounts',
        icon: Store,
        permission: 'pod.tiktok.account.read',
      },
      {
        labelKey: 'podProducts',
        href: '/dashboard/pod/products',
        icon: Package,
        permission: 'pod.product.read',
      },
      {
        labelKey: 'podOrders',
        href: '/dashboard/pod/orders',
        icon: ClipboardList,
        permission: 'pod.tiktok.order.read',
      },
      {
        labelKey: 'podFulfillmentProviders',
        href: '/dashboard/pod/fulfillment-providers',
        icon: Factory,
        permission: 'fulfillment.config',
      },
      {
        labelKey: 'podProductMapping',
        href: '/dashboard/pod/product-mapping',
        icon: Link2,
        permission: 'fulfillment.config',
      },
      {
        labelKey: 'podPayout',
        href: '/dashboard/pod/payout',
        icon: Wallet,
        permission: 'pod.tiktok.payout.read',
      },
    ],
  },

  {
    labelKey: 'profile',
    href: '/dashboard/profile',
    icon: UserRound,
    permission: 'profile.read',
    hiddenWhenPermission: 'employee.read',
  },
];

/**
 * Lọc cấu hình menu theo quyền của người dùng hiện tại và cờ `hidden`.
 *
 * Nhóm menu (có `children`) chỉ hiện khi còn ít nhất một menu con qua được bộ lọc —
 * tránh trường hợp bấm vào nhóm rỗng.
 */
export function resolveNavigation(
  has: (code: string) => boolean,
  items: NavItemConfig[] = NAVIGATION,
): NavItemConfig[] {
  const result: NavItemConfig[] = [];
  for (const item of items) {
    if (item.hidden) continue;
    if (item.permission && !has(item.permission)) continue;
    if (item.hiddenWhenPermission && has(item.hiddenWhenPermission)) continue;

    if (item.children?.length) {
      const children = resolveNavigation(has, item.children);
      if (children.length === 0) continue;
      result.push({ ...item, children });
      continue;
    }
    result.push(item);
  }
  return result;
}
