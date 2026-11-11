/**
 * Cấu hình website PUBLIC (Landing / Tài liệu / Bảng giá) — MỘT nơi cho thương hiệu, liên hệ, điều hướng.
 *
 * 🔴 Không lặp lại email / địa chỉ / route ở nơi khác: header, footer, CTA và metadata đều đọc từ đây.
 */

/** Đường dẫn của hệ thống đang chạy — KHÔNG tạo luồng mới. `/register` là màn đăng ký Organization hiện có. */
export const APP_ROUTES = {
  login: '/login',
  register: '/register',
} as const;

/** Các trang public. */
export const PUBLIC_ROUTES = {
  home: '/home',
  docs: '/docs',
  pricing: '/pricing',
} as const;

/**
 * Trang public KHÔNG đi qua cổng phiên đăng nhập của `AuthProvider` (không gọi `/auth/me`, không chuyển về `/login`,
 * render ngay ở server cho SEO). Middleware vốn không chặn các đường dẫn này.
 */
export function isPublicSitePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return Object.values(PUBLIC_ROUTES).some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export const SITE = {
  name: 'Startly Ecom',
  tagline: 'Nền tảng quản lý vận hành TikTok Shop & Fulfillment',
  /** Domain công khai — dùng cho canonical / Open Graph. Ghi đè bằng NEXT_PUBLIC_SITE_URL khi cần. */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://startly-ecom.us').replace(/\/+$/, ''),
  description:
    'Quản lý tập trung nhiều TikTok Shop: sản phẩm, đăng sản phẩm hàng loạt, Flash Sale, đơn hàng và fulfillment — cho cả đội ngũ, trên một nền tảng.',
  logo: '/logo.jpg',
  contact: {
    email: 'nguyenminhchinh000@gmail.com',
    location: 'Liên Chiểu, Đà Nẵng',
  },
} as const;

/**
 * Open Graph mặc định. Next.js THAY THẾ (không gộp) `openGraph` của layout khi trang khai báo `openGraph` riêng,
 * nên mọi trang phải spread object này để giữ ảnh / siteName / locale.
 */
export const SITE_OPEN_GRAPH = {
  type: 'website' as const,
  siteName: SITE.name,
  locale: 'vi_VN',
  images: [{ url: SITE.logo, width: 1280, height: 1280, alt: SITE.name }],
};

/** Menu chính của header / footer. */
export const PUBLIC_NAV = [
  { label: 'Trang chủ', href: PUBLIC_ROUTES.home },
  { label: 'Tài liệu', href: PUBLIC_ROUTES.docs },
  { label: 'Bảng giá', href: PUBLIC_ROUTES.pricing },
] as const;
