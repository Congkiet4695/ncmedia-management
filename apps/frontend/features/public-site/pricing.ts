/**
 * Bảng giá PUBLIC — chỉ là phần TRÌNH BÀY. Hệ thống KHÔNG có thanh toán / subscription: gói được áp bằng giới hạn
 * Shop của tổ chức (`organizations.shop_limit`), do Super Admin cập nhật (docs/organization-lifecycle.md).
 *
 * Mọi thứ khác (tính năng) giống nhau ở mọi gói — backend không giới hạn tính năng theo gói, nên trang giá không
 * được hứa khác.
 */
export interface PricingPlan {
  id: string;
  name: string;
  /** USD / tháng. */
  priceUsd: number;
  /** Số Shop TikTok tối đa được kết nối đồng thời. */
  shops: number;
  audience: string;
  highlight?: boolean;
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    priceUsd: 15,
    shops: 10,
    audience: 'Người bán cá nhân bắt đầu với vài shop',
  },
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 30,
    shops: 20,
    audience: 'Người bán đang mở rộng thêm shop',
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: 70,
    shops: 50,
    audience: 'Đội ngũ vận hành nhiều shop cùng lúc',
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: 120,
    shops: 100,
    audience: 'Đội ngũ chuyên nghiệp quy mô lớn',
  },
  {
    id: 'business',
    name: 'Business',
    priceUsd: 350,
    shops: 300,
    audience: 'Doanh nghiệp / agency nhiều đội ngũ',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceUsd: 550,
    shops: 500,
    audience: 'Hệ thống bán hàng quy mô rất lớn',
  },
] as const;

export const BILLING_PERIOD_LABEL = 'tháng';

/** Tính năng có trong MỌI gói — đúng những gì hệ thống đang có. */
export const INCLUDED_IN_EVERY_PLAN = [
  'Kết nối và quản lý nhiều TikTok Shop',
  'Đồng bộ sản phẩm, đơn hàng, đơn hoàn trả và payout',
  'Đăng sản phẩm hàng loạt với template',
  'Flash Sale và Auto Flash Sale',
  'Fulfillment với Mango Tee Prints và Sellerwix',
  'Nhân viên, vai trò và phân quyền theo shop',
  'Dashboard vận hành và thông báo Telegram',
] as const;

export const PRICING_FAQ = [
  {
    question: 'Sau khi đăng ký tôi dùng được ngay không?',
    answer:
      'Hồ sơ đăng ký được Super Admin xét duyệt. Khi được duyệt, tổ chức bắt đầu với giới hạn 10 Shop và thời hạn 30 ngày tính từ ngày đăng ký.',
  },
  {
    question: 'Các gói khác nhau ở điểm nào?',
    answer: 'Ở số Shop TikTok được kết nối cùng lúc. Mọi tính năng có trong tất cả các gói.',
  },
  {
    question: 'Làm sao để nâng gói hoặc gia hạn?',
    answer:
      'Liên hệ qua email ở cuối trang. Quản trị viên cập nhật giới hạn Shop và ngày hết hạn cho tổ chức của bạn — không cần tạo tài khoản mới, dữ liệu giữ nguyên.',
  },
  {
    question: 'Đến giới hạn Shop thì sao?',
    answer:
      'Shop đang kết nối vẫn hoạt động bình thường; hệ thống chỉ chặn kết nối thêm shop mới. Gỡ liên kết một shop là giải phóng chỗ ngay.',
  },
  {
    question: 'Hết hạn gói thì dữ liệu có mất không?',
    answer:
      'Không. Tài khoản của tổ chức tạm thời không đăng nhập được cho tới khi được gia hạn; dữ liệu được giữ nguyên.',
  },
] as const;

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
