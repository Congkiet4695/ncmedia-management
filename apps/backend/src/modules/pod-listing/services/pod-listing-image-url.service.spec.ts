import * as http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { publicOnlyLookup } from '../../../common/http/safe-remote-fetch';
import {
  PodListingImageUrlFetchFailedException,
  PodListingImageUrlInvalidException,
  PodListingImageUrlService,
} from './pod-listing-image-url.service';

jest.mock('node:dns', () => ({ lookup: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require('node:dns') as { lookup: jest.Mock };

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

/**
 * **Thêm ảnh bằng URL** — máy chủ giả ở 127.0.0.1. `files.example.com` được nối tới máy chủ giả; MỌI tên miền khác
 * đi qua hàng rào THẬT `publicOnlyLookup` (DNS giả lập) ⇒ kiểm được chuyển hướng sang địa chỉ nội bộ / DNS rebinding.
 */
describe('PodListingImageUrlService.importImage', () => {
  let server: http.Server;
  let port: number;
  const routes: Record<string, Handler> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const route = routes[req.url ?? ''];
      if (!route) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      route(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const lookup: LookupFunction = (host, options, callback) => {
    if (host !== 'files.example.com') return publicOnlyLookup(host, options, callback);
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
        { address: '127.0.0.1', family: 4 },
      ]);
    } else {
      callback(null, '127.0.0.1', 4);
    }
  };

  function build() {
    const storage = {
      upload: jest.fn((file: Express.Multer.File) =>
        Promise.resolve({ id: 'file-1', originalName: file.originalname, mimeType: file.mimetype }),
      ),
      defaultFolderSegments: jest.fn(() => ['pod_tiktok', 'org-1', 'pod_listing_asset']),
    };
    const mapper = { toDto: jest.fn((stored: { id: string }) => ({ ...stored, publicUrl: `https://cdn/${stored.id}` })) };
    const service = new PodListingImageUrlService(storage as never, mapper as never);
    const run = (path: string) =>
      service.importImage('org-1', 'user-1', `http://files.example.com:${port}${path}`, {
        testNetwork: { lookup, ports: { 'http:': [String(port), ''], 'https:': [''] } },
      });
    return { service, storage, mapper, run };
  }

  const serve = (path: string, body: Buffer | string, headers: Record<string, string> = {}, status = 200) => {
    routes[path] = (_req, res) => {
      res.writeHead(status, headers);
      res.end(body);
    };
  };

  async function failure(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      const response = (error as { getResponse(): { code: string; details: { reason: string } } }).getResponse();
      return { error, code: response.code, reason: response.details.reason };
    }
    throw new Error('expected failure');
  }

  it('URL ảnh công khai hợp lệ ⇒ lưu Storage đúng loại POD_LISTING_ASSET, đuôi theo định dạng THẬT', async () => {
    serve('/tee.png', PNG, { 'Content-Type': 'image/png' });
    const h = build();
    const dto = await h.run('/tee.png');
    expect(dto).toMatchObject({ id: 'file-1', publicUrl: 'https://cdn/file-1' });
    const [file, ctx] = h.storage.upload.mock.calls[0] as unknown as [Express.Multer.File, Record<string, unknown>];
    expect(file).toMatchObject({ originalname: 'tee.png', mimetype: 'image/png' });
    expect(ctx).toMatchObject({ module: 'POD_TIKTOK', referenceType: 'POD_LISTING_ASSET', organizationId: 'org-1' });
  });

  it('máy chủ khai octet-stream / đuôi sai nhưng bytes là JPEG ⇒ nhận, đặt đuôi .jpg', async () => {
    serve('/photo.png?sig=abc', JPEG, { 'Content-Type': 'application/octet-stream' });
    const h = build();
    await h.run('/photo.png?sig=abc');
    const [file] = h.storage.upload.mock.calls[0];
    expect(file).toMatchObject({ mimetype: 'image/jpeg' });
    expect(file.originalname.endsWith('.jpg')).toBe(true);
  });

  it('khai image/png nhưng nội dung không phải ảnh ⇒ 422 UNSUPPORTED_TYPE, không lưu gì', async () => {
    serve('/fake.png', 'GIF89a-not-really', { 'Content-Type': 'image/png' });
    const h = build();
    const result = await failure(h.run('/fake.png'));
    expect(result.error).toBeInstanceOf(PodListingImageUrlFetchFailedException);
    expect(result.reason).toBe('UNSUPPORTED_TYPE');
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('URL trả trang HTML (đăng nhập / chặn hotlink) ⇒ 422 NOT_IMAGE', async () => {
    serve('/login', '<html>Sign in</html>', { 'Content-Type': 'text/html; charset=utf-8' });
    const h = build();
    expect((await failure(h.run('/login'))).reason).toBe('NOT_IMAGE');
  });

  it.each([
    [403, 'từ chối truy cập'],
    [401, 'từ chối truy cập'],
    [404, 'Không tìm thấy'],
    [410, 'Không tìm thấy'],
  ])('HTTP %s ⇒ 422 HTTP_STATUS với câu giải thích', async (status, text) => {
    serve(`/s${status}`, 'x', { 'Content-Type': 'text/plain' }, status);
    const h = build();
    const result = await failure(h.run(`/s${status}`));
    expect(result.reason).toBe('HTTP_STATUS');
    expect((result.error as Error).message).toContain(text);
  });

  it('ảnh > 5 MB ⇒ 422 TOO_LARGE (đếm byte thật, không tin Content-Length)', async () => {
    serve('/big.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), { 'Content-Type': 'image/png' });
    const h = build();
    expect((await failure(h.run('/big.png'))).reason).toBe('TOO_LARGE');
  });

  it('chuyển hướng sang tên miền phân giải về IP NỘI BỘ (DNS rebinding / metadata) ⇒ 400 NOT_PUBLIC', async () => {
    dns.lookup.mockImplementation((_host: string, _opts: unknown, cb: (e: null, a: unknown[]) => void) =>
      cb(null, [{ address: '169.254.169.254', family: 4 }]),
    );
    routes['/hop'] = (_req, res) => {
      res.writeHead(302, { Location: 'http://metadata.example.com/latest/meta-data/' });
      res.end();
    };
    const h = build();
    const result = await failure(h.run('/hop'));
    expect(result.error).toBeInstanceOf(PodListingImageUrlInvalidException);
    expect(result.reason).toBe('NOT_PUBLIC');
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1/admin.png', 'NOT_PUBLIC'],
    ['http://localhost/x.png', 'NOT_PUBLIC'],
    ['http://169.254.169.254/latest/meta-data/', 'NOT_PUBLIC'],
    ['http://10.0.0.5/x.png', 'NOT_PUBLIC'],
    ['http://[::1]/x.png', 'NOT_PUBLIC'],
    ['ftp://files.example.com/x.png', 'UNSUPPORTED_PROTOCOL'],
    ['file:///etc/passwd', 'UNSUPPORTED_PROTOCOL'],
    ['http://user:pass@files.example.com/x.png', 'CREDENTIALS_IN_URL'],
    ['http://files.example.com:8080/x.png', 'PORT_NOT_ALLOWED'],
    ['not a url', 'UNSUPPORTED_PROTOCOL'],
  ])('hàng rào THẬT (không testNetwork): %s ⇒ 400 %s, không mở kết nối', async (url, reason) => {
    const h = build();
    const result = await failure(h.service.importImage('org-1', 'user-1', url));
    expect(result.code).toBe('POD_LISTING_IMAGE_URL_INVALID');
    expect(result.reason).toBe(reason);
    expect(h.storage.upload).not.toHaveBeenCalled();
  });
});
