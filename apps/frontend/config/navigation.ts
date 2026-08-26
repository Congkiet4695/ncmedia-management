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
  BadgeCheck,
  ClipboardList,
  Factory,
  FileStack,
  History,
  Link2,
  LayoutDashboard,
  Package,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tags,
  UserRound,
  Users,
  Wallet,
  Warehouse,
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

  // Quản trị NỀN TẢNG — chỉ Super Admin thấy.
  //
  // 🔴 `permission` ở đây chỉ ẩn/hiện MENU. Quyền thật do backend chặn bằng `SuperAdminGuard`
  // (role SUPER_ADMIN + Organization hệ thống) cộng `platform.*`. Quyền này bị loại khỏi
  // catalog cấp cho org admin, nên không tổ chức nào tự cấp cho mình được.
  {
    labelKey: 'superAdminOrganizations',
    href: '/dashboard/super-admin/organizations',
    icon: ShieldCheck,
    permission: 'platform.organization.read',
  },
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
        labelKey: 'podCategories',
        href: '/dashboard/pod/categories',
        icon: Tags,
        permission: 'pod.product.read',
      },
      // 🔴 `pod.product.sync` chứ không phải `pod.product.read`: đây là màn hình quản trị
      // danh mục dùng chung của TikTok (có nút Sync), không phải màn hình duyệt sản phẩm của
      // shop. Seller không có quyền này ⇒ menu tự ẩn, đúng §10 — và ẩn bằng QUYỀN chứ không
      // bằng mã role, vì role là động (ADR-009).
      {
        labelKey: 'podBrands',
        href: '/dashboard/pod/brands',
        icon: BadgeCheck,
        permission: 'pod.product.sync',
      },
      {
        labelKey: 'podWarehouses',
        href: '/dashboard/pod/warehouses',
        icon: Warehouse,
        permission: 'pod.product.sync',
      },
      // Cửa duy nhất kéo dữ liệu dùng chung của TikTok về cache (Category / Brand /
      // Attribute / Warehouse) — đặt ngay trên Templates vì phải chạy trước.
      {
        labelKey: 'podResources',
        href: '/dashboard/pod/resources',
        icon: RefreshCw,
        permission: 'pod.product.sync',
      },
      // Sáu loại template điều hướng bằng THANH TAB trong chính màn hình
      // (`app/(dashboard)/dashboard/pod/templates/layout.tsx`), không phải bằng menu con.
      //
      // 🔴 Đừng thêm `children` ở đây: sidebar chỉ mở menu con cho nhóm CẤP MỘT
      // (`NavGroup`), còn mục nằm trong nhóm được vẽ bằng `NavLink` — vốn bỏ qua `children`.
      // Thêm vào chỉ tạo cấu hình chết, và làm người sau tưởng menu con đang hoạt động.
      {
        labelKey: 'podTemplates',
        href: '/dashboard/pod/templates',
        icon: FileStack,
        permission: 'pod.template.read',
      },
      // Auto Listing = danh sách LƯỢT ĐĂNG (Listing Session). Import Product và Draft
      // Product không có menu riêng: chúng là các bước BÊN TRONG một lượt đăng.
      {
        labelKey: 'podAutoListing',
        href: '/dashboard/pod/auto-listing',
        icon: Rocket,
        permission: 'pod.session.read',
      },
      // Draft Listing = danh sách listing ĐÃ DỰNG XONG, chờ đưa lên sàn. Đây là nơi bấm
      // Publish; Auto Listing chỉ dừng ở việc tạo Draft trên TikTok.
      {
        labelKey: 'podDraftListings',
        href: '/dashboard/pod/draft-listings',
        icon: Send,
        permission: 'pod.draft.read',
      },
      {
        labelKey: 'podPublishHistory',
        href: '/dashboard/pod/publish-history',
        icon: History,
        permission: 'pod.listing.read',
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
