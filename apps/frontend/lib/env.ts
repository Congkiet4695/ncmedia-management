/**
 * Truy cập biến môi trường tập trung (typed).
 * Chỉ dùng biến NEXT_PUBLIC_* ở client. Có fallback để build/dev không cần .env.
 */
export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'NCMedia Management Platform',
  /**
   * Giới hạn dung lượng MỘT file upload (byte). Mặc định 104857600 = 100MB.
   *
   * Phải KHỚP `STORAGE_MAX_FILE_BYTES` của backend. Đây chỉ là kiểm tra sớm cho trải nghiệm
   * người dùng — backend vẫn là nơi quyết định cuối cùng, nên hai giá trị lệch nhau chỉ làm
   * thông báo hiện sai lúc nào, không tạo ra lỗ hổng.
   */
  maxUploadBytes: Number.parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES ?? '104857600', 10),
  /**
   * Thời gian tối đa cho MỘT request upload (ms). Mặc định 180000 = 3 phút.
   *
   * 🔴 Chỉ áp cho request upload, KHÔNG phải cho mọi API: `apiClient` giữ nguyên 15 giây để
   * một endpoint treo không khiến màn hình đứng ba phút. File 100MB trên đường truyền chậm
   * cần vài phút, nên riêng đường upload mới được nới.
   *
   * Phải KHỚP với `UPLOAD_TIMEOUT_MS` của backend và `proxy_read_timeout` của Nginx
   * (`deploy/nginx.conf`, khối `/api/`): mắt xích nào ngắn hơn thì mắt xích đó quyết định.
   */
  uploadTimeoutMs: Number.parseInt(process.env.NEXT_PUBLIC_UPLOAD_TIMEOUT_MS ?? '180000', 10),
  /**
   * Thời gian chờ tối đa cho request "Sync Products" / "Sync Shops" (ms). Mặc định 290000.
   *
   * 🔴 Chỉ áp cho hai request đồng bộ thủ công. Chuỗi phải giữ thứ tự:
   * `TIKTOK_PRODUCT_SYNC_REQUEST_DEADLINE_MS` (backend, 180s — hết giờ thì phần còn lại chạy
   * nền) < giá trị này (290s) < `proxy_read_timeout` của Nginx (300s). Nhờ vậy backend luôn trả
   * lời TRƯỚC khi trình duyệt hay Nginx bỏ cuộc.
   */
  syncTimeoutMs: Number.parseInt(process.env.NEXT_PUBLIC_PRODUCT_SYNC_TIMEOUT_MS ?? '290000', 10),
} as const;

export type Env = typeof env;
