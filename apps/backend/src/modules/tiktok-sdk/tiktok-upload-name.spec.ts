import { sanitizeUploadName } from './tiktok-product-api.service';

/**
 * Tên file gửi kèm khi upload video/PDF lên TikTok.
 *
 * 🔴 Vì sao cần chuẩn hoá: tài liệu UploadProductFile nói rõ tên file KHÔNG được chứa dấu
 * cách, không có dấu chấm thừa và không bắt đầu bằng ký hiệu. Tên do người dùng đặt (nhất là
 * tiếng Việt có dấu, hoặc "video (1).mp4") vi phạm cả ba, và TikTok từ chối file — lỗi hiện
 * ra ở tận bước gửi sản phẩm nên rất khó lần ngược về nguyên nhân.
 */
describe('sanitizeUploadName', () => {
  it('giữ nguyên tên vốn đã hợp lệ', () => {
    expect(sanitizeUploadName('product-video.mp4')).toBe('product-video.mp4');
  });

  it('🔴 bỏ dấu cách — nguyên nhân TikTok từ chối phổ biến nhất', () => {
    expect(sanitizeUploadName('my product video.mp4')).toBe('my-product-video.mp4');
  });

  it('🔴 chỉ giữ MỘT dấu chấm, đúng dấu trước phần mở rộng', () => {
    expect(sanitizeUploadName('video.final.v2.mp4')).toBe('video-final-v2.mp4');
  });

  it('bỏ dấu tiếng Việt', () => {
    expect(sanitizeUploadName('bảng size áo.png')).toBe('bang-size-ao.png');
  });

  it('không bắt đầu/kết thúc bằng ký hiệu', () => {
    expect(sanitizeUploadName('___video___.mov')).toBe('video.mov');
  });

  it('tên rỗng sau khi lọc vẫn ra tên dùng được', () => {
    expect(sanitizeUploadName('###.mp4')).toBe('file.mp4');
  });

  it('không có phần mở rộng thì không tự thêm dấu chấm', () => {
    expect(sanitizeUploadName('video')).toBe('video');
  });

  it('cắt tên quá dài, giữ phần mở rộng', () => {
    const result = sanitizeUploadName(`${'a'.repeat(200)}.mp4`);
    expect(result.endsWith('.mp4')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(84);
  });
});
