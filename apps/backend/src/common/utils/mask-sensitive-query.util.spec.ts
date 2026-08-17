import { maskSensitiveQuery } from './mask-sensitive-query.util';

describe('maskSensitiveQuery', () => {
  it('🔴 che `code` và `state` của callback uỷ quyền TikTok', () => {
    const masked = maskSensitiveQuery(
      '/api/v1/tiktok/callback?app_key=abc&code=SUPER_SECRET&state=SECRET_STATE',
    );

    expect(masked).not.toContain('SUPER_SECRET');
    expect(masked).not.toContain('SECRET_STATE');
    // Tham số vô hại vẫn giữ nguyên để còn chẩn đoán được.
    expect(masked).toContain('app_key=abc');
  });

  it('che cả `auth_code` và token nếu lỡ xuất hiện trên URL', () => {
    const masked = maskSensitiveQuery('/x?auth_code=A&access_token=B&refresh_token=C');

    expect(masked).not.toContain('=A');
    expect(masked).not.toContain('=B');
    expect(masked).not.toContain('=C');
  });

  it('URL không có query → giữ nguyên', () => {
    expect(maskSensitiveQuery('/api/v1/health')).toBe('/api/v1/health');
  });

  it('không có tham số nhạy cảm → KHÔNG viết lại chuỗi (giữ đúng nguyên bản)', () => {
    const url = '/api/v1/pod/tiktok/accounts?page=1&sortBy=createdAt';
    expect(maskSensitiveQuery(url)).toBe(url);
  });
});
