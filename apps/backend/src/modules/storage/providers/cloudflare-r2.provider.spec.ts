import { ConfigService } from '@nestjs/config';
import { StorageProviderName } from '@prisma/client';
import {
  StorageProviderErrorKind,
  StorageProviderException,
} from '../exceptions/storage.exceptions';
import { CloudflareR2Provider } from './cloudflare-r2.provider';
import { callArg } from '../../../testing/mock-call.util';

const CONFIG: Record<string, unknown> = {
  'storage.r2.accountId': 'acc-123',
  'storage.r2.bucket': 'ncmedia',
  'storage.r2.accessKey': 'key',
  'storage.r2.secretKey': 'secret',
  'storage.r2.publicUrl': 'https://cdn.ncmedia.vn/',
  'storage.timeoutMs': 30_000,
};

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...CONFIG, ...overrides };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Thiếu cấu hình ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

/** Thay đầu gửi lệnh của S3Client để test không chạm mạng. */
function stubSend(provider: CloudflareR2Provider, impl: jest.Mock): void {
  (provider as unknown as { client: { send: jest.Mock } }).client.send = impl;
}

/** Lỗi giống hình dạng lỗi AWS SDK trả về. */
function sdkError(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error(`${name} raised`), {
    name,
    $metadata: { httpStatusCode },
  });
}

describe('CloudflareR2Provider', () => {
  let provider: CloudflareR2Provider;
  let send: jest.Mock;

  beforeEach(() => {
    provider = new CloudflareR2Provider(makeConfig());
    send = jest.fn().mockResolvedValue({});
    stubSend(provider, send);
  });

  it('khai báo đúng tên provider để ghi vào metadata', () => {
    expect(provider.name).toBe(StorageProviderName.CLOUDFLARE_R2);
  });

  describe('resolvePublicUrl', () => {
    it('bucket công khai → ghép URL, không nhân đôi dấu "/"', () => {
      expect(provider.resolvePublicUrl('pod/designs/a.png')).toBe(
        'https://cdn.ncmedia.vn/pod/designs/a.png',
      );
    });

    it('🔴 không cấu hình public URL → coi là bucket private, trả null', () => {
      const privateProvider = new CloudflareR2Provider(makeConfig({ 'storage.r2.publicUrl': '' }));
      expect(privateProvider.resolvePublicUrl('pod/designs/a.png')).toBeNull();
    });
  });

  describe('put', () => {
    it('trả về khoá, URL công khai và bucket đã ghi', async () => {
      const result = await provider.put({
        objectKey: 'pod/designs/a.png',
        body: Buffer.from('x'),
        mimeType: 'image/png',
        originalName: 'a.png',
      });

      expect(result).toEqual({
        objectKey: 'pod/designs/a.png',
        publicUrl: 'https://cdn.ncmedia.vn/pod/designs/a.png',
        bucket: 'ncmedia',
      });
    });

    it('🔴 tên file có xuống dòng → không thể chèn header (response splitting)', async () => {
      await provider.put({
        objectKey: 'pod/designs/a.png',
        body: Buffer.from('x'),
        mimeType: 'image/png',
        originalName: 'a\r\nX-Injected: 1".png',
      });

      const { input } = callArg<{ input: { ContentDisposition: string } }>(send, 0, 0);
      // Chỉ hai dấu nháy bao tên file được phép; bên trong không còn CR/LF/dấu nháy.
      expect(input.ContentDisposition).toBe('inline; filename="aX-Injected: 1.png"');
      expect(input.ContentDisposition.slice('inline; filename="'.length, -1)).not.toMatch(
        /[\r\n"]/,
      );
    });
  });

  describe('delete — idempotent', () => {
    it('object không tồn tại → coi như đã xoá, KHÔNG ném lỗi', async () => {
      send.mockRejectedValue(sdkError('NoSuchKey', 404));
      await expect(provider.delete('missing.png')).resolves.toBeUndefined();
    });

    it('lỗi khác → ném lỗi đã phân loại', async () => {
      send.mockRejectedValue(sdkError('InternalError', 500));
      await expect(provider.delete('a.png')).rejects.toBeInstanceOf(StorageProviderException);
    });
  });

  describe('exists', () => {
    it('object không tồn tại → false thay vì ném lỗi', async () => {
      send.mockRejectedValue(sdkError('NotFound', 404));
      await expect(provider.exists('missing.png')).resolves.toBe(false);
    });
  });

  describe('phân loại lỗi SDK', () => {
    const cases: Array<[string, number | undefined, StorageProviderErrorKind]> = [
      ['NoSuchKey', 404, StorageProviderErrorKind.OBJECT_NOT_FOUND],
      ['NotFound', 404, StorageProviderErrorKind.OBJECT_NOT_FOUND],
      ['NoSuchBucket', 404, StorageProviderErrorKind.BUCKET_NOT_FOUND],
      ['InvalidAccessKeyId', 403, StorageProviderErrorKind.UNAUTHORIZED],
      ['SignatureDoesNotMatch', 403, StorageProviderErrorKind.UNAUTHORIZED],
      ['AccessDenied', 403, StorageProviderErrorKind.UNAUTHORIZED],
      ['TimeoutError', undefined, StorageProviderErrorKind.TIMEOUT],
      ['ECONNRESET', undefined, StorageProviderErrorKind.TIMEOUT],
      ['InternalError', 500, StorageProviderErrorKind.UNKNOWN],
    ];

    it.each(cases)('%s → %s', async (name, status, expected) => {
      send.mockRejectedValue(sdkError(name, status));
      // `NoSuchBucket` mang status 404 nhưng phải được phân loại theo mã lỗi,
      // nên dùng `get` (không nuốt OBJECT_NOT_FOUND) để quan sát đủ mọi trường hợp.
      const error = await provider.get('a.png').catch((err: unknown) => err);
      expect(error).toBeInstanceOf(StorageProviderException);
      expect((error as StorageProviderException).kind).toBe(expected);
    });
  });

  describe('cấu hình', () => {
    it('🔴 thiếu credential → fail-fast ngay khi khởi tạo, không chạy với cấu hình sai', () => {
      expect(() => new CloudflareR2Provider(makeConfig({ 'storage.r2.accessKey': undefined }))).toThrow(
        /storage\.r2\.accessKey/,
      );
    });
  });
});
