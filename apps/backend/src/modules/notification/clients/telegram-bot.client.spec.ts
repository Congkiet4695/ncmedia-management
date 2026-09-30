import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_ERROR_CODES } from '../constants/notification.constants';
import { TelegramApiError, TelegramBotClient } from './telegram-bot.client';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawSECRET';

function client(timeoutMs = 50): TelegramBotClient {
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'notification.telegram.timeoutMs' ? timeoutMs : fallback,
  } as unknown as ConfigService;
  return new TelegramBotClient(config);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function errorOf(promise: Promise<unknown>): Promise<TelegramApiError> {
  try {
    await promise;
  } catch (error) {
    return error as TelegramApiError;
  }
  throw new Error('expected error');
}

describe('TelegramBotClient', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('sendMessage thành công ⇒ trả message_id; gửi HTML + tắt preview', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 42 } }));

    await expect(client().sendMessage(TOKEN, '-100123', '<b>x</b>')).resolves.toEqual({ messageId: '42' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '-100123', parse_mode: 'HTML' });
  });

  it.each([
    [401, 'Unauthorized', NOTIFICATION_ERROR_CODES.INVALID_TOKEN],
    [404, 'Not Found', NOTIFICATION_ERROR_CODES.INVALID_TOKEN],
    [400, 'Bad Request: chat not found', NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND],
    [403, 'Forbidden: bot was kicked from the supergroup chat', NOTIFICATION_ERROR_CODES.FORBIDDEN],
    [400, 'Bad Request: message is too long', NOTIFICATION_ERROR_CODES.BAD_REQUEST],
  ])('HTTP %i "%s" ⇒ %s, KHÔNG retry', async (status, description, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { ok: false, error_code: status, description }));

    const error = await errorOf(client().sendMessage(TOKEN, '-100', 'x'));
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
    expect(error.delivery).toBe('NOT_DELIVERED');
  });

  it('429 ⇒ RATE_LIMITED, retry theo retry_after', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 17 } }),
    );
    const error = await errorOf(client().sendMessage(TOKEN, '-100', 'x'));
    expect(error.code).toBe(NOTIFICATION_ERROR_CODES.RATE_LIMITED);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(17);
  });

  it('5xx (kể cả body không phải JSON) ⇒ SERVER_ERROR, retry', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const error = await errorOf(client().sendMessage(TOKEN, '-100', 'x'));
    expect(error.code).toBe(NOTIFICATION_ERROR_CODES.SERVER_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('không kết nối được (DNS) ⇒ NETWORK, chắc chắn chưa gửi, retry', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    const error = await errorOf(client().sendMessage(TOKEN, '-100', 'x'));
    expect(error.code).toBe(NOTIFICATION_ERROR_CODES.NETWORK);
    expect(error.delivery).toBe('NOT_DELIVERED');
    expect(error.retryable).toBe(true);
  });

  it('timeout ⇒ TIMEOUT, delivery UNKNOWN, vẫn retry (at-least-once)', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const error = await errorOf(client(20).sendMessage(TOKEN, '-100', 'x'));
    expect(error.code).toBe(NOTIFICATION_ERROR_CODES.TIMEOUT);
    expect(error.delivery).toBe('UNKNOWN');
    expect(error.retryable).toBe(true);
  });

  it('🔴 thông điệp lỗi KHÔNG BAO GIỜ chứa Bot Token', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`), {
        cause: { code: 'ECONNRESET' },
      }),
    );
    const error = await errorOf(client().sendMessage(TOKEN, '-100', 'x'));
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain('SECRET');
  });

  it('getMe ⇒ username của bot', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: { id: 1, username: 'nc_bot' } }));
    await expect(client().getMe(TOKEN)).resolves.toEqual({ id: 1, username: 'nc_bot' });
  });
});
