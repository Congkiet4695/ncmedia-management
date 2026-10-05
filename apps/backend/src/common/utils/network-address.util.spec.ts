import { isPublicHostname, isPublicIpAddress } from './network-address.util';
import { detectImageMime } from './image-signature.util';

describe('network-address.util — chống SSRF', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254', // metadata endpoint của cloud
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('🔴 %s ⇒ KHÔNG công khai', (ip) => {
    expect(isPublicIpAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '172.32.0.1', '142.250.72.14', '2607:f8b0:4005:80b::200e', '::ffff:8.8.8.8'])(
    '%s ⇒ công khai',
    (ip) => {
      expect(isPublicIpAddress(ip)).toBe(true);
    },
  );

  it('hostname: tên miền nội bộ / không có TLD / IP nội bộ ⇒ chặn; tên miền công khai ⇒ nhận', () => {
    expect(isPublicHostname('localhost')).toBe(false);
    expect(isPublicHostname('printer.local')).toBe(false);
    expect(isPublicHostname('db.internal')).toBe(false);
    expect(isPublicHostname('intranet')).toBe(false);
    expect(isPublicHostname('[::1]')).toBe(false);
    expect(isPublicHostname('169.254.169.254')).toBe(false);
    expect(isPublicHostname('drive.google.com')).toBe(true);
    expect(isPublicHostname('8.8.8.8')).toBe(true);
  });

  it('không phải IP ⇒ isPublicIpAddress = false (không đoán)', () => {
    expect(isPublicIpAddress('example.com')).toBe(false);
  });
});

describe('detectImageMime — chữ ký file', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

  it('PNG / JPEG / WEBP theo magic bytes', () => {
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(detectImageMime(webp)).toBe('image/webp');
  });

  it('🔴 HTML / GIF / PDF / rỗng ⇒ null (không nhận dù đuôi hay header nói là ảnh)', () => {
    expect(detectImageMime(Buffer.from('<!DOCTYPE html><html>'))).toBeNull();
    expect(detectImageMime(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageMime(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});
