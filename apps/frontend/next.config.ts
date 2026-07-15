import type { NextConfig } from 'next';

/**
 * Next.js config — NCMedia Management Platform Frontend.
 * Giữ tối giản ở giai đoạn bootstrap; cấu hình rewrites/headers sẽ bổ sung khi tích hợp API.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
