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
} as const;

export type Env = typeof env;
