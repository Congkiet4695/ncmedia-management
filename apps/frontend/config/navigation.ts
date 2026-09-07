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
  Globe,
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
  Zap,
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
   * Có MỘT trong các quyền này là thấy menu (ngữ nghĩa HOẶC).
   *
   * 🔴 Cần cho những màn hình mà hai loại người dùng không chung quyền nào cùng phải vào
   * được — vd TikTok Master Data: Admin tổ chức có `pod.product.read`, còn Super Admin nền
   * tảng chỉ có `platform.*`. Khớp với `@RequireAnyPermission` phía backend.
   */
  anyPermission?: string[];
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
      // 🔴 `pod.product.read` (đổi từ `pod.product.sync`): màn hình này KHÔNG còn nút Sync —
      // thương hiệu là dữ liệu master toàn cục, chỉ Super Admin đồng bộ. Giữ nguyên quyền cũ
      // nghĩa là Seller vẫn không xem được một danh sách chỉ-đọc mà họ cần khi chọn brand.
      {
        labelKey: 'podBrands',
        href: '/dashboard/pod/brands',
        icon: BadgeCheck,
        permission: 'pod.product.read',
      },
      {
        labelKey: 'podWarehouses',
        href: '/dashboard/pod/warehouses',
        icon: Warehouse,
        permission: 'pod.product.sync',
      },
      // TikTok Master Data TOÀN CỤC (Category / Brand / Category Attribute).
      // 🔴 `pod.product.read` chứ không phải quyền sync: Admin tổ chức PHẢI xem được số liệu
      // và lần đồng bộ gần nhất — không thì dropdown danh mục trống mà họ không biết vì sao.
      // Nút "Sync Now" trong trang tự ẩn theo cờ `canSync` do server trả về.
      {
        labelKey: 'podMasterData',
        href: '/dashboard/pod/master-data',
        icon: Globe,
        anyPermission: ['pod.product.read', 'platform.masterdata.read'],
      },
      // Tài nguyên của TỔ CHỨC (kho hàng) — đặt ngay trên Templates vì phải chạy trước.
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
      // Flash Sale — khuyến mãi giới hạn thời gian (Promotion Activity của TikTok).
      // 🔴 Gate bằng `pod.flashsale.read`: Seller được cấp quyền này theo mặc định nhưng
      // vẫn chỉ thấy shop được Admin gán (PodAccessScopeService), giống mọi màn hình POD.
      // Chưa có menu Promotion — sprint này chỉ làm Flash Sale.
      {
        labelKey: 'podFlashSales',
        href: '/dashboard/pod/flash-sales',
        icon: Zap,
        permission: 'pod.flashsale.read',
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
    if (item.anyPermission?.length && !item.anyPermission.some(has)) continue;
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
