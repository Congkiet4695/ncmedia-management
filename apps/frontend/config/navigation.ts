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
  Bell,
  BellRing,
  ClipboardList,
  Copy,
  Database,
  Factory,
  FileStack,
  Globe,
  History,
  LayoutDashboard,
  Package,
  RefreshCw,
  RotateCcw,
  Rocket,
  Send,
  Settings,
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
import { AUTO_FLASH_SALE_SETTINGS_PATH } from '@/features/pod-flash-sale/routes';
import { POD_RETURNS_PATH } from '@/features/pod-return/routes';

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
  /**
   * Chỉ cho nhóm (có `children`): bấm tên nhóm ⇒ điều hướng tới menu con ĐẦU TIÊN còn lại sau khi lọc
   * quyền (`resolveNavigation`) — không bao giờ dẫn tới trang bị từ chối. Mũi tên bên phải vẫn chỉ
   * mở / thu gọn. Bỏ trống ⇒ bấm tên nhóm chỉ mở / thu gọn như cũ.
   */
  navigateToFirstChild?: boolean;
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
    // Nhà cung cấp fulfillment DÙNG CHUNG — cùng nhóm quản trị nền tảng với Organizations.
    labelKey: 'superAdminFulfillmentProviders',
    href: '/dashboard/super-admin/fulfillment-providers',
    icon: Factory,
    permission: 'platform.fulfillment.read',
  },
  {
    labelKey: 'employees',
    href: '/dashboard/employees',
    icon: Users,
    permission: 'employee.read',
  },
  // Thống kê công việc nhân viên (Admin) — listing · shop · đơn · lợi nhuận theo người, theo ngày.
  // 🔴 Menu chỉ ẩn/hiện. API `/pod/employee-work-statistics` đòi `report.read` VÀ `pod.shop.all`;
  // trang tự chặn cả hai (RequirePermission lồng nhau).
  {
    labelKey: 'employeeWorkStatistics',
    href: '/dashboard/employee-work',
    icon: BarChart3,
    permission: 'report.read',
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

  // ---------------------------------------------------------------------------------------------
  // Khu POD / TikTok Shop — mỗi chức năng là menu CẤP MỘT (nhóm POD cũ đã bỏ). 🔴 URL GIỮ NGUYÊN
  // `/dashboard/pod/*`: chỉ đổi vị trí trong menu, không gãy bookmark / link nội bộ; quyền giữ nguyên.
  // ---------------------------------------------------------------------------------------------
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

  // Listing — luồng đưa sản phẩm lên sàn, theo đúng thứ tự thao tác. Bấm "Listing" mở thẳng menu con
  // ĐẦU TIÊN người dùng được phép vào (Auto Listing, hoặc mục kế tiếp nếu thiếu quyền) — xem
  // `navigateToFirstChild`. `href` của nhóm chỉ là khoá định danh, KHÔNG phải route.
  {
    labelKey: 'listing',
    href: '/dashboard/listing',
    icon: Rocket,
    navigateToFirstChild: true,
    children: [
      // Auto Listing = danh sách LƯỢT ĐĂNG (Listing Session). Import Product và Draft Product không có
      // menu riêng: chúng là các bước BÊN TRONG một lượt đăng.
      {
        labelKey: 'podAutoListing',
        href: '/dashboard/pod/auto-listing',
        icon: Rocket,
        permission: 'pod.session.read',
      },
      // Clone Products: sản phẩm đang được nhân bản + lịch sử các lượt (Seller thấy của mình,
      // Admin thấy cả tổ chức). Cùng quyền với nút Nhân bản ở màn Sản phẩm.
      {
        labelKey: 'podCloneProducts',
        href: '/dashboard/pod/clone-products',
        icon: Copy,
        permission: 'pod.product.clone',
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
    ],
  },

  // Sáu loại template điều hướng bằng THANH TAB trong chính màn hình
  // (`app/(dashboard)/dashboard/pod/templates/layout.tsx`), không phải bằng menu con — đừng thêm `children`.
  {
    labelKey: 'podTemplates',
    href: '/dashboard/pod/templates',
    icon: FileStack,
    permission: 'pod.template.read',
  },
  // Flash Sale — khuyến mãi giới hạn thời gian (Promotion Activity của TikTok).
  // 🔴 Gate bằng `pod.flashsale.read`: Seller được cấp quyền này theo mặc định nhưng
  // vẫn chỉ thấy shop được Admin gán (PodAccessScopeService), giống mọi màn hình POD.
  {
    labelKey: 'podFlashSales',
    href: '/dashboard/pod/flash-sales',
    icon: Zap,
    permission: 'pod.flashsale.read',
  },

  // Order — đơn TikTok và yêu cầu Return/Refund. URL của POD Orders GIỮ NGUYÊN (`/dashboard/pod/orders`,
  // cùng quyền `pod.tiktok.order.read`) — chỉ đổi vị trí trong menu, không gãy link / bookmark.
  {
    labelKey: 'orderGroup',
    href: '/dashboard/pod/orders',
    icon: ShoppingBag,
    children: [
      {
        labelKey: 'podOrders',
        href: '/dashboard/pod/orders',
        icon: ClipboardList,
        permission: 'pod.tiktok.order.read',
      },
      {
        labelKey: 'podReturns',
        href: POD_RETURNS_PATH,
        icon: RotateCcw,
        permission: 'pod.tiktok.return.read',
      },
    ],
  },

  // TikTok Payout — menu CHÍNH. Route giữ nguyên `/dashboard/pod/payout` để không gãy link / bookmark.
  {
    labelKey: 'podPayout',
    href: '/dashboard/pod/payout',
    icon: Wallet,
    permission: 'pod.tiktok.payout.read',
  },

  // Syncs Master Data — dữ liệu master dùng khi dựng listing (danh mục, thương hiệu, kho, master data
  // TikTok toàn cục, tài nguyên của tổ chức). Chỉ gom MENU — mỗi trang giữ nguyên chức năng đồng bộ của nó.
  {
    labelKey: 'syncsMasterData',
    href: '/dashboard/master-data',
    icon: Database,
    children: [
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
      // Tài nguyên của TỔ CHỨC (kho hàng…) — phải chạy trước khi dựng Templates.
      {
        labelKey: 'podResources',
        href: '/dashboard/pod/resources',
        icon: RefreshCw,
        permission: 'pod.product.sync',
      },
    ],
  },

  // Setting Fulfillment — cấu hình nhà cung cấp fulfillment của TỔ CHỨC (credentials do backend giữ,
  // giao diện không hiển thị lại secret). Product Mapping KHÔNG còn trên menu; route
  // `/dashboard/pod/product-mapping` và API vẫn giữ nguyên.
  {
    labelKey: 'settingFulfillment',
    href: '/dashboard/fulfillment-settings',
    icon: Factory,
    children: [
      {
        labelKey: 'podFulfillmentProviders',
        href: '/dashboard/pod/fulfillment-providers',
        icon: Factory,
        permission: 'fulfillment.config',
      },
    ],
  },

  // Cài đặt của TỔ CHỨC: Thông báo (Telegram — Bot Token là secret, chỉ `notification.config`) và
  // Auto Flash Sale Scheduler (`pod.flashsale.auto.config`). Nhóm tự ẩn khi không còn mục con nào.
  {
    labelKey: 'settings',
    href: '/dashboard/settings',
    icon: Settings,
    children: [
      {
        labelKey: 'settingsNotifications',
        href: '/dashboard/settings/notifications',
        icon: Bell,
        permission: 'notification.config',
      },
      // Kênh Telegram CÁ NHÂN (Employee) — chỉ nhận đơn của shop được gán. API `/notifications/me/*` tự chặn bằng
      // cùng quyền `notification.self`; menu chỉ ẩn/hiện.
      {
        labelKey: 'settingsMyNotifications',
        href: '/dashboard/settings/my-notifications',
        icon: BellRing,
        permission: 'notification.self',
      },
      // 🔴 Menu chỉ ẩn/hiện. API `/pod/flash-sale-auto/*` tự chặn bằng cùng quyền `pod.flashsale.auto.config`.
      {
        labelKey: 'settingsAutoFlashSale',
        href: AUTO_FLASH_SALE_SETTINGS_PATH,
        icon: Zap,
        permission: 'pod.flashsale.auto.config',
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
