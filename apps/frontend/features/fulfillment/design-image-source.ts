/**
 * Ảnh design nào được thu nhỏ qua bộ tối ưu ảnh của Next (`/_next/image`). Không React ⇒ `next.config.ts` dùng chung và
 * kiểm bằng `npm run test:design-image`.
 *
 * Chỉ nhận đúng các host Storage đã khai: bộ tối ưu tải ảnh từ phía server, nên mở rộng hơn là cho phép dùng nó để gọi
 * tới địa chỉ tuỳ ý. Design nguồn URL (Google Drive…) và đường tải qua API có kiểm quyền vẫn dùng nguyên `fileUrl`.
 */

export interface StorageImagePattern {
  protocol: 'http' | 'https';
  hostname: string;
  port: string;
}

/**
 * Hình mẫu host cho `images.remotePatterns`, từ danh sách URL cách nhau bởi dấu phẩy. Phải là danh sách: `public_url` được
 * lưu theo từng file, nên file cũ vẫn trỏ về host cũ sau khi đổi bucket. URL sai dạng bị bỏ qua.
 */
export function storageImagePatterns(publicBaseUrls: string | undefined): StorageImagePattern[] {
  return (publicBaseUrls ?? '').split(',').flatMap((entry) => {
    try {
      const { protocol, hostname, port } = new URL(entry.trim());
      if (protocol !== 'http:' && protocol !== 'https:') return [];
      return [{ protocol: protocol === 'http:' ? ('http' as const) : ('https' as const), hostname, port }];
    } catch {
      return [];
    }
  });
}

/** `fileUrl` có nằm trên một host Storage đã khai với `images.remotePatterns` không. */
export function isOptimizableDesignUrl(fileUrl: string, publicBaseUrls: string | undefined): boolean {
  try {
    const url = new URL(fileUrl);
    return storageImagePatterns(publicBaseUrls).some(
      (pattern) =>
        url.protocol === `${pattern.protocol}:` && url.hostname === pattern.hostname && url.port === pattern.port,
    );
  } catch {
    // Đường tương đối (`/api/v1/storage/:id/download`) cần phiên đăng nhập, bộ tối ưu không tải được.
    return false;
  }
}
