import type { NextConfig } from 'next';
import { AUTO_FLASH_SALE_SETTINGS_PATH } from './features/pod-flash-sale/routes';

/**
 * Next.js config — NCMedia Management Platform Frontend.
 * Giữ tối giản ở giai đoạn bootstrap; cấu hình rewrites/headers sẽ bổ sung khi tích hợp API.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone server cho Docker production (self-contained .next/standalone).
  // `next dev` bỏ qua option này → KHÔNG ảnh hưởng môi trường Local Development.
  output: 'standalone',
  // Trang đã DỜI CHỖ — giữ đường dẫn cũ để bookmark / link cũ không gãy. Chạy trước middleware.
  async redirects() {
    return [
      {
        // Auto Flash Sale Scheduler: POD → Flash Sale ⇒ Settings.
        source: '/dashboard/pod/flash-sales/auto-settings',
        destination: AUTO_FLASH_SALE_SETTINGS_PATH,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
