import {
  Bell,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  PackageCheck,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Nội dung Landing Page — tập trung một chỗ.
 *
 * 🔴 CHỈ chức năng đang có thật trong hệ thống (menu `config/navigation.ts`, không tính mục `hidden`). Không quảng
 * cáo chức năng chưa có; không dùng khẳng định không chứng minh được ("số 1", "100% tự động"…).
 */

export const HERO = {
  eyebrow: 'Quản lý TikTok Shop cho đội ngũ',
  title: 'Vận hành mọi TikTok Shop của bạn từ một nơi',
  subtitle:
    'Kết nối nhiều shop, đăng sản phẩm hàng loạt, chạy Flash Sale, xử lý đơn hàng và gửi fulfillment cho xưởng in — cả đội cùng làm việc trên một nền tảng, mỗi người đúng phạm vi của mình.',
} as const;

export interface LandingFeature {
  icon: LucideIcon;
  title: string;
  description: string;
  points: readonly string[];
}

export const FEATURES: readonly LandingFeature[] = [
  {
    icon: Store,
    title: 'Quản lý nhiều TikTok Shop',
    description:
      'Kết nối tài khoản TikTok Shop bằng uỷ quyền chính thức và quản lý mọi shop trong một danh sách.',
    points: [
      'Một tài khoản, nhiều shop',
      'Theo dõi trạng thái Live / Die / mất uỷ quyền',
      'Gán nhân viên phụ trách',
    ],
  },
  {
    icon: Boxes,
    title: 'Sản phẩm & đăng hàng loạt',
    description:
      'Đồng bộ sản phẩm từ shop, dựng listing bằng template và đăng lên nhiều shop cùng lúc.',
    points: [
      'Template danh mục, mô tả, ảnh, SKU, giá',
      'Auto Listing, Custom Listing, Clone',
      'Draft và lịch sử đăng',
    ],
  },
  {
    icon: Megaphone,
    title: 'Flash Sale',
    description: 'Tạo và quản lý Flash Sale cho nhiều shop, hoặc để hệ thống tự tạo theo cấu hình.',
    points: [
      'Tạo Flash Sale theo shop',
      'Auto Flash Sale theo lịch',
      'Theo dõi trạng thái chương trình',
    ],
  },
  {
    icon: ClipboardList,
    title: 'Đơn hàng tập trung',
    description:
      'Đơn của mọi shop về một màn hình — lọc, xem chi tiết, in nhãn và theo dõi tiền về.',
    points: [
      'Đồng bộ đơn từ TikTok',
      'Nhãn vận chuyển và đơn hoàn trả',
      'Payout và tiền đang hold',
    ],
  },
  {
    icon: PackageCheck,
    title: 'Fulfillment cho POD',
    description:
      'Gửi đơn sang xưởng in ngay trong hệ thống, với ánh xạ sản phẩm, design và giá vốn rõ ràng.',
    points: [
      'Mango Tee Prints, Sellerwix và Pressify',
      'Ánh xạ sản phẩm & design theo biến thể',
      'Base Cost, đồng bộ trạng thái, huỷ đơn',
    ],
  },
  {
    icon: Users,
    title: 'Đội ngũ & phân quyền',
    description:
      'Thêm nhân viên, gán vai trò và giới hạn từng người trong đúng các shop họ phụ trách.',
    points: [
      'Vai trò Admin, Seller, Fulfillment',
      'Phạm vi dữ liệu theo shop',
      'Thống kê công việc nhân viên',
    ],
  },
  {
    icon: LayoutDashboard,
    title: 'Dashboard vận hành',
    description:
      'Nắm nhanh tình hình kinh doanh: đơn theo kỳ, doanh thu ước tính, payout và trạng thái shop.',
    points: ['Đơn hôm nay / tháng này', 'Tiền đang hold theo nhân sự', 'Lọc theo shop và seller'],
  },
  {
    icon: Bell,
    title: 'Thông báo Telegram',
    description:
      'Nhận thông báo các sự kiện vận hành quan trọng qua Telegram cho tổ chức hoặc từng người.',
    points: ['Cấu hình theo tổ chức', 'Thông báo cá nhân', 'Bật / tắt theo nhu cầu'],
  },
] as const;

/** Quy trình bắt đầu — đúng luồng thật: đăng ký → chờ duyệt → kết nối → cấu hình → vận hành. */
export const STEPS = [
  {
    title: 'Đăng ký tổ chức',
    description: 'Tạo tài khoản cho tổ chức của bạn. Hồ sơ được xét duyệt trước khi sử dụng.',
  },
  {
    title: 'Kết nối TikTok Shop',
    description: 'Uỷ quyền tài khoản TikTok Shop — các shop của tài khoản được thêm tự động.',
  },
  {
    title: 'Thiết lập đội ngũ & fulfillment',
    description: 'Thêm nhân viên, gán shop, khai báo tài khoản xưởng in.',
  },
  {
    title: 'Đăng sản phẩm & xử lý đơn',
    description: 'Đăng sản phẩm bằng template, chạy Flash Sale, gửi đơn sang xưởng in.',
  },
  {
    title: 'Theo dõi tập trung',
    description: 'Xem đơn, doanh thu ước tính, payout và hiệu quả đội ngũ trên Dashboard.',
  },
] as const;

export const AUDIENCES = [
  {
    title: 'Người bán cá nhân',
    description:
      'Bắt đầu với vài shop, gom mọi thứ về một nơi thay vì đổi qua lại giữa các tài khoản.',
  },
  {
    title: 'Đội ngũ vận hành nhiều shop',
    description: 'Phân công shop cho từng người, mỗi người chỉ thấy đúng phần việc của mình.',
  },
  {
    title: 'Seller POD',
    description:
      'Ánh xạ sản phẩm với xưởng in, quản lý design và giá vốn, gửi đơn không cần nhập tay.',
  },
  {
    title: 'Agency & doanh nghiệp',
    description: 'Quản lý hàng trăm shop với giới hạn phù hợp quy mô, nâng gói khi cần.',
  },
] as const;

export interface ProductPreview {
  title: string;
  description: string;
  /** Ảnh chụp màn hình THẬT từ môi trường dữ liệu mẫu (không dữ liệu thật / bí mật). */
  image: string;
}

export const PRODUCT_PREVIEWS: readonly ProductPreview[] = [
  {
    title: 'Dashboard',
    description: 'Đơn hàng, doanh thu ước tính và payout theo kỳ.',
    image: '/docs-screens/dashboard.webp',
  },
  {
    title: 'TikTok Accounts',
    description: 'Tài khoản đã kết nối và các shop của từng tài khoản.',
    image: '/docs-screens/dashboard-pod-tiktok-accounts.webp',
  },
  {
    title: 'Đơn hàng',
    description: 'Đơn của mọi shop với trạng thái fulfillment ngay trên danh sách.',
    image: '/docs-screens/dashboard-pod-orders.webp',
  },
  {
    title: 'Fulfillment',
    description: 'Khai báo tài khoản xưởng in và đồng bộ danh mục sản phẩm.',
    image: '/docs-screens/dashboard-pod-fulfillment-providers.webp',
  },
] as const;
