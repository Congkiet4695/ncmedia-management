import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isPublicHostname, isPublicIpAddress } from '../utils/network-address.util';

/**
 * Tải MỘT file từ URL do người dùng nhập — có hàng rào SSRF đầy đủ.
 *
 * 🔴 Vì sao không dùng `fetch(url, { redirect: 'follow' })`:
 *   1. Chuyển hướng được đi theo TỰ ĐỘNG ⇒ `https://site-cong-khai/x` trả `302 → http://169.254.169.254/`
 *      là vượt qua mọi kiểm tra đặt trên URL ban đầu.
 *   2. Kiểm hostname là chưa đủ: tên miền công khai vẫn phân giải được về `127.0.0.1` (DNS rebinding).
 *
 * Ở đây:
 *   - Chỉ `http:` / `https:`, cổng mặc định (80/443), không có tài khoản trong URL.
 *   - IP được kiểm NGAY LÚC KẾT NỐI qua `lookup` tuỳ biến — IP bị chặn thì socket không bao giờ mở,
 *     và không có khoảng hở giữa "kiểm" và "kết nối".
 *   - Chuyển hướng đi TAY, tối đa `maxRedirects`, mỗi bước kiểm lại từ đầu.
 *   - Một deadline cho TOÀN BỘ lần tải (gồm mọi bước chuyển hướng), và trần dung lượng đếm theo
 *     byte thật nhận được (không tin `Content-Length`). Vượt trần ⇒ huỷ ngay, không đọc tiếp.
 *   - Chỉ giữ trong bộ nhớ — không ghi file tạm xuống đĩa.
 */

export type RemoteFetchFailure =
  | 'UNSUPPORTED_PROTOCOL'
  | 'CREDENTIALS_IN_URL'
  | 'PORT_NOT_ALLOWED'
  | 'NOT_PUBLIC'
  | 'TOO_MANY_REDIRECTS'
  | 'HTTP_STATUS'
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'TIMEOUT'
  | 'NETWORK';

export class RemoteFetchError extends Error {
  constructor(
    readonly reason: RemoteFetchFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteFetchError';
  }
}

export interface RemoteFetchOptions {
  /** Trần dung lượng (byte). */
  maxBytes: number;
  /** Deadline cho TOÀN BỘ lần tải, kể cả chuyển hướng. */
  timeoutMs: number;
  maxRedirects: number;
  /**
   * 🔴 CHỈ dành cho unit test (máy chủ giả chạy ở 127.0.0.1, cổng ngẫu nhiên). Code nghiệp vụ KHÔNG
   * BAO GIỜ truyền field này — bỏ trống là dùng hàng rào thật (`publicOnlyLookup`, cổng 80/443).
   */
  testNetwork?: { lookup: LookupFunction; ports: Readonly<Record<string, string[]>> };
}

export interface RemoteFile {
  buffer: Buffer;
  /** `Content-Type` máy chủ khai (đã bỏ tham số, chữ thường) — CHƯA được tin, nơi gọi tự kiểm. */
  contentType: string;
  /** Tên file gợi ý (Content-Disposition, hoặc đoạn cuối đường dẫn) — chỉ để hiển thị. */
  fileName: string | null;
  /** URL cuối cùng sau chuyển hướng. */
  finalUrl: string;
  redirects: number;
}

const ALLOWED_PORTS: Readonly<Record<string, string[]>> = {
  'http:': ['', '80'],
  'https:': ['', '443'],
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Kiểm HÌNH THỨC một URL trước khi kết nối. */
export function assertFetchableUrl(
  raw: string | URL,
  allowedPorts: Readonly<Record<string, string[]>> = ALLOWED_PORTS,
): URL {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new RemoteFetchError('UNSUPPORTED_PROTOCOL', 'URL không đúng định dạng.');
  }
  const ports = allowedPorts[url.protocol];
  if (!ports) throw new RemoteFetchError('UNSUPPORTED_PROTOCOL', 'Chỉ nhận URL http/https.');
  if (url.username || url.password) {
    throw new RemoteFetchError('CREDENTIALS_IN_URL', 'URL không được chứa tài khoản/mật khẩu.');
  }
  if (!ports.includes(url.port)) {
    throw new RemoteFetchError('PORT_NOT_ALLOWED', 'Chỉ nhận cổng mặc định (80/443).');
  }
  if (!isPublicHostname(url.hostname)) {
    throw new RemoteFetchError('NOT_PUBLIC', 'URL trỏ vào địa chỉ nội bộ — không được phép.');
  }
  return url;
}

/**
 * `lookup` cho socket: phân giải rồi CHẶN nếu bất kỳ IP nào không công khai. Chặn cả khi chỉ một
 * trong nhiều bản ghi là nội bộ — không chọn hộ "IP tốt".
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses;
    const blocked = list.find((entry) => !isPublicIpAddress(entry.address));
    if (list.length === 0 || blocked) {
      const denied = new RemoteFetchError(
        'NOT_PUBLIC',
        `Tên miền ${hostname} phân giải về địa chỉ nội bộ — không được phép.`,
      );
      return callback(denied, '', 0);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    }
    return callback(null, list[0].address, list[0].family);
  });
};

export async function fetchRemoteFile(
  rawUrl: string,
  options: RemoteFetchOptions,
): Promise<RemoteFile> {
  const deadline = Date.now() + options.timeoutMs;
  const ports = options.testNetwork?.ports ?? ALLOWED_PORTS;
  const lookup = options.testNetwork?.lookup ?? publicOnlyLookup;
  let url = assertFetchableUrl(rawUrl, ports);

  for (let redirects = 0; ; redirects += 1) {
    const response = await requestOnce(url, deadline, options.maxBytes, lookup);
    if ('location' in response) {
      if (redirects >= options.maxRedirects) {
        throw new RemoteFetchError(
          'TOO_MANY_REDIRECTS',
          `Quá ${options.maxRedirects} lần chuyển hướng.`,
        );
      }
      // Mỗi bước chuyển hướng là một URL MỚI do máy chủ ngoài quyết định ⇒ kiểm lại từ đầu.
      url = assertFetchableUrl(new URL(response.location, url), ports);
      continue;
    }
    return { ...response, finalUrl: url.toString(), redirects };
  }
}

type SingleResponse =
  { location: string } | { buffer: Buffer; contentType: string; fileName: string | null };

function requestOnce(
  url: URL,
  deadline: number,
  maxBytes: number,
  lookup: LookupFunction,
): Promise<SingleResponse> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(timeoutError());

  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<SingleResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const request = transport.get(
      url,
      {
        lookup,
        headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'NCMedia-Fulfillment/1.0' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status)) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            return finish(() =>
              reject(
                new RemoteFetchError(
                  'HTTP_STATUS',
                  `Máy chủ chuyển hướng (${status}) nhưng không có địa chỉ đích.`,
                  status,
                ),
              ),
            );
          }
          return finish(() => resolve({ location }));
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return finish(() =>
            reject(new RemoteFetchError('HTTP_STATUS', `Máy chủ trả về HTTP ${status}.`, status)),
          );
        }

        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          response.destroy();
          return finish(() => reject(tooLarge(maxBytes)));
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            finish(() => reject(tooLarge(maxBytes)));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          finish(() => {
            if (received === 0)
              return reject(new RemoteFetchError('EMPTY', 'Máy chủ trả về nội dung rỗng.'));
            resolve({
              buffer: Buffer.concat(chunks, received),
              contentType: (response.headers['content-type'] ?? '')
                .split(';')[0]
                .trim()
                .toLowerCase(),
              fileName: fileNameOf(response.headers['content-disposition'], url),
            });
          }),
        );
        response.on('error', (error) => finish(() => reject(networkError(error))));
      },
    );

    const timer = setTimeout(() => {
      request.destroy();
      finish(() => reject(timeoutError()));
    }, remaining);

    request.on('error', (error) => finish(() => reject(networkError(error))));
  });
}

function fileNameOf(disposition: string | undefined, url: URL): string | null {
  const match = disposition
    ? /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition)
    : null;
  const raw = match ? (match[1] ?? match[2]) : url.pathname.split('/').pop();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

function tooLarge(maxBytes: number): RemoteFetchError {
  return new RemoteFetchError(
    'TOO_LARGE',
    `File vượt giới hạn ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
  );
}

function timeoutError(): RemoteFetchError {
  return new RemoteFetchError('TIMEOUT', 'Hết thời gian chờ tải file.');
}

function networkError(error: Error): RemoteFetchError {
  return error instanceof RemoteFetchError
    ? error
    : new RemoteFetchError('NETWORK', `Không kết nối được máy chủ chứa file: ${error.message}`);
}
