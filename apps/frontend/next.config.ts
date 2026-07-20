import type { NextConfig } from 'next';

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
};

export default nextConfig;
