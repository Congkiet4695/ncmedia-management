/**
 * Link CHIA SẺ Google Drive → link TẢI file của chính file đó.
 *
 * 🔴 Link chia sẻ (`/file/d/{id}/view`) trả về TRANG HTML xem trước, không phải ảnh — tải về là
 * luôn nhận HTML. Đổi sang `uc?export=download&id={id}` (cùng file, cùng quyền chia sẻ) để Drive
 * trả nội dung file. Đây KHÔNG phải giả định "URL Drive là ảnh": kết quả vẫn đi qua đủ kiểm tra
 * Content-Type + chữ ký file; file không công khai ⇒ Drive trả trang đăng nhập (HTML) ⇒ báo lỗi rõ.
 *
 * URL khác (kể cả URL Drive dạng không nhận ra) ⇒ giữ nguyên.
 */
export function toDirectDownloadUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname.toLowerCase() !== 'drive.google.com') return raw;

  const fromPath = /^\/file\/d\/([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(url.pathname)?.[1];
  const fromQuery =
    url.pathname === '/open' || url.pathname === '/uc' ? url.searchParams.get('id') : null;
  const id = fromPath ?? (fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery) ? fromQuery : null);
  if (!id) return raw;
  return `https://drive.google.com/uc?export=download&id=${id}`;
}
