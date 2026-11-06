import type { NextConfig } from 'next';
import { storageImagePatterns } from './features/fulfillment/design-image-source';
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
  // Thu nhỏ ảnh design (`DesignImage`). Chỉ host Storage; file Storage không đổi nội dung (đổi design là object key mới)
  // nên bản thu nhỏ được giữ lâu, cuộn lên xuống hay mở lại trang đều không tải lại.
  images: {
    remotePatterns: storageImagePatterns(process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URLS),
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
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
