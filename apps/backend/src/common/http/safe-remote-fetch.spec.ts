import * as http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { fetchRemoteFile, publicOnlyLookup, RemoteFetchError } from './safe-remote-fetch';

jest.mock('node:dns', () => ({ lookup: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require('node:dns') as { lookup: jest.Mock };

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Máy chủ giả ở 127.0.0.1 — hàng rào thật CHẶN địa chỉ này, nên các ca kiểm logic tải (chuyển
 * hướng, trần dung lượng, timeout) đi qua `testNetwork`: tên miền công khai giả `files.example.com`
 * được nối tới máy chủ giả. Hàng rào IP thật được kiểm riêng ở `publicOnlyLookup` và ở ca cuối.
 */
describe('fetchRemoteFile', () => {
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

  const toLocal: LookupFunction = (_host, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(
        null,
        [{ address: '127.0.0.1', family: 4 }],
      );
    } else {
      callback(null, '127.0.0.1', 4);
    }
  };
  const fetchLocal = (path: string, timeoutMs = 2000) =>
    fetchRemoteFile(`http://files.example.com:${port}${path}`, {
      maxBytes: 1024,
      timeoutMs,
      maxRedirects: 3,
      testNetwork: { lookup: toLocal, ports: { 'http:': [String(port)], 'https:': [String(port)] } },
    });
  const reasonOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteFetchError);
      return (error as RemoteFetchError).reason;
    }
    throw new Error('expected failure');
  };
  const redirect =
    (location: string, status = 302): Handler =>
    (_req, res) => {
      res.writeHead(status, { Location: location.replace('{port}', String(port)) });
      res.end();
    };

  it('200 ⇒ buffer + content-type + tên file', async () => {
    routes['/ok.png'] = (_req, res) => {
      res.setHeader('Content-Type', 'image/png; charset=binary');
      res.end(Buffer.from('PNGDATA'));
    };
    const file = await fetchLocal('/ok.png');
    expect(file.buffer.toString()).toBe('PNGDATA');
    expect(file.contentType).toBe('image/png');
    expect(file.fileName).toBe('ok.png');
    expect(file.redirects).toBe(0);
  });

  it('chuyển hướng hợp lệ ⇒ đi theo, đếm số bước, trả URL cuối', async () => {
    routes['/r1'] = redirect('/r2');
    routes['/r2'] = redirect('/ok.png', 301);
    const file = await fetchLocal('/r1');
    expect(file.redirects).toBe(2);
    expect(file.finalUrl).toContain('/ok.png');
  });

  it('🔴 chuyển hướng tới metadata endpoint / localhost ⇒ chặn (NOT_PUBLIC), không kết nối', async () => {
    routes['/evil'] = redirect('http://169.254.169.254:{port}/latest/meta-data');
    routes['/evil-local'] = redirect('http://localhost:{port}/ok.png');
    expect(await reasonOf(fetchLocal('/evil'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(fetchLocal('/evil-local'))).toBe('NOT_PUBLIC');
  });

  it('🔴 quá số lần chuyển hướng ⇒ TOO_MANY_REDIRECTS', async () => {
    routes['/loop'] = redirect('/loop');
    expect(await reasonOf(fetchLocal('/loop'))).toBe('TOO_MANY_REDIRECTS');
  });

  it('404 / 410 (link hết hạn / bị xoá) ⇒ HTTP_STATUS kèm mã', async () => {
    routes['/gone'] = (_req, res) => {
      res.statusCode = 410;
      res.end();
    };
    await expect(fetchLocal('/missing')).rejects.toMatchObject({ reason: 'HTTP_STATUS', status: 404 });
    await expect(fetchLocal('/gone')).rejects.toMatchObject({ reason: 'HTTP_STATUS', status: 410 });
  });

  it('🔴 vượt trần dung lượng — kể cả khi KHÔNG khai Content-Length ⇒ TOO_LARGE', async () => {
    routes['/big-declared'] = (_req, res) => {
      res.setHeader('Content-Length', '5000');
      res.end(Buffer.alloc(5000));
    };
    routes['/big-chunked'] = (_req, res) => {
      res.write(Buffer.alloc(800));
      res.write(Buffer.alloc(800));
      res.end();
    };
    expect(await reasonOf(fetchLocal('/big-declared'))).toBe('TOO_LARGE');
    expect(await reasonOf(fetchLocal('/big-chunked'))).toBe('TOO_LARGE');
  });

  it('🔴 máy chủ treo ⇒ TIMEOUT theo deadline', async () => {
    routes['/slow'] = () => undefined; // không bao giờ trả lời
    expect(await reasonOf(fetchLocal('/slow', 200))).toBe('TIMEOUT');
  });

  it('nội dung rỗng ⇒ EMPTY', async () => {
    routes['/empty'] = (_req, res) => res.end();
    expect(await reasonOf(fetchLocal('/empty'))).toBe('EMPTY');
  });

  it('🔴 hàng rào thật: localhost / IP nội bộ / cổng lạ / giao thức lạ bị chặn TRƯỚC khi kết nối', async () => {
    const real = (url: string) =>
      fetchRemoteFile(url, { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1 });
    expect(await reasonOf(real('http://127.0.0.1/ok.png'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(real('http://169.254.169.254/latest/meta-data'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(real('http://localhost/ok.png'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(real('http://[::1]/ok.png'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(real('http://0.0.0.0/ok.png'))).toBe('NOT_PUBLIC');
    expect(await reasonOf(real('http://cdn.example.com:8080/a.png'))).toBe('PORT_NOT_ALLOWED');
    expect(await reasonOf(real('ftp://cdn.example.com/a.png'))).toBe('UNSUPPORTED_PROTOCOL');
    expect(await reasonOf(real('file:///etc/passwd'))).toBe('UNSUPPORTED_PROTOCOL');
    expect(await reasonOf(real('https://u:p@cdn.example.com/a.png'))).toBe('CREDENTIALS_IN_URL');
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe('publicOnlyLookup — kiểm IP lúc KẾT NỐI (chống DNS rebinding)', () => {
  const run = (addresses: Array<{ address: string; family: number }>) =>
    new Promise<{ error: unknown; address?: string }>((resolve) => {
      dns.lookup.mockImplementationOnce(
        (_host: string, _options: unknown, callback: (e: null, a: unknown) => void) =>
          callback(null, addresses),
      );
      publicOnlyLookup('cdn.example.com', {}, (error, address) =>
        resolve({ error, address: address as string }),
      );
    });

  it('tên miền công khai phân giải về IP công khai ⇒ cho kết nối', async () => {
    const result = await run([{ address: '93.184.216.34', family: 4 }]);
    expect(result.error).toBeNull();
    expect(result.address).toBe('93.184.216.34');
  });

  it('🔴 tên miền "công khai" phân giải về 127.0.0.1 / 169.254.169.254 ⇒ chặn', async () => {
    expect((await run([{ address: '127.0.0.1', family: 4 }])).error).toMatchObject({
      reason: 'NOT_PUBLIC',
    });
    expect((await run([{ address: '169.254.169.254', family: 4 }])).error).toMatchObject({
      reason: 'NOT_PUBLIC',
    });
  });

  it('🔴 MỘT trong nhiều bản ghi là nội bộ ⇒ chặn (không chọn hộ IP tốt)', async () => {
    const result = await run([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    expect(result.error).toMatchObject({ reason: 'NOT_PUBLIC' });
  });
});
