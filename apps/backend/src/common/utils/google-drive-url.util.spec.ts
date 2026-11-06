import { isGoogleDriveUrl, toDirectDownloadUrl } from './google-drive-url.util';

describe('toDirectDownloadUrl — link chia sẻ Google Drive', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const DOWNLOAD = `https://drive.google.com/uc?export=download&id=${ID}`;

  it.each([
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/file/d/${ID}`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}`,
    `https://docs.google.com/uc?id=${ID}`,
    `https://docs.google.com/file/d/${ID}/edit`,
  ])('%s ⇒ link tải của CÙNG file', (url) => {
    expect(toDirectDownloadUrl(url)).toBe(DOWNLOAD);
  });

  it('URL khác / Drive dạng không nhận ra ⇒ giữ nguyên', () => {
    expect(toDirectDownloadUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(toDirectDownloadUrl('https://drive.google.com/drive/folders/abc')).toBe(
      'https://drive.google.com/drive/folders/abc',
    );
    expect(toDirectDownloadUrl('khong-phai-url')).toBe('khong-phai-url');
  });
});

describe('isGoogleDriveUrl', () => {
  it('chỉ nhận host của Drive', () => {
    expect(isGoogleDriveUrl('https://drive.google.com/file/d/abc/view')).toBe(true);
    expect(isGoogleDriveUrl('https://drive.google.com.evil.test/file/d/abc/view')).toBe(false);
    expect(isGoogleDriveUrl('https://cdn.example.com/a.png')).toBe(false);
    expect(isGoogleDriveUrl('khong-phai-url')).toBe(false);
  });
});
