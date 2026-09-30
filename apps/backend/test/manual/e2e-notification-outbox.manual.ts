/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP outbox thông báo Telegram trên DATABASE THẬT (PostgreSQL) + một Telegram
 * Bot API GIẢ chạy cục bộ (không gửi tin thật, không cần token thật).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-notification-outbox.manual.ts
 * Không cần backend đang chạy. Tạo 2 Organization tạm và tự dọn ở cuối (CASCADE).
 *
 * Kiểm:
 *   · câu claim raw SQL (ép kiểu ::double precision / ::int, bind tham số) chạy được trên PostgreSQL
 *   · UNIQUE idempotency — ghi trùng / ghi song song / transaction rollback
 *   · 4 worker claim song song ⇒ không sự kiện nào bị nhận hai lần (FOR UPDATE SKIP LOCKED)
 *   · worker chết (lease hết hạn) ⇒ sự kiện được nhận lại; token cũ không ghi đè được (fencing)
 *   · dispatcher đầu-cuối: SENT / retry / FAILED / SKIPPED / cô lập tổ chức / hai dispatcher song song
 */
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { NotificationEventRepository } from '../../src/modules/notification/repositories/notification-event.repository';
import { TelegramConfigRepository } from '../../src/modules/notification/repositories/telegram-config.repository';
import { TelegramBotClient } from '../../src/modules/notification/clients/telegram-bot.client';
import { NotificationEncryptionService } from '../../src/modules/notification/services/notification-encryption.service';
import { NotificationDispatcherService } from '../../src/modules/notification/services/notification-dispatcher.service';
import type { NotificationEventInput } from '../../src/modules/notification/types/notification-payload.types';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

// ---------------------------------------------------------------- Telegram giả
type Mode = 'ok' | '500' | '401' | 'hang';
const received: Array<{ token: string; chatId: string; text: string }> = [];
const modeByToken = new Map<string, Mode>();

function startFakeTelegram(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
      const token = match?.[1] ?? '';
      const mode = modeByToken.get(token) ?? 'ok';
      if (mode === 'hang') return; // không trả lời ⇒ client timeout
      res.setHeader('Content-Type', 'application/json');
      if (mode === '500') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error_code: 500, description: 'Internal' }));
      }
      if (mode === '401') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
      }
      const parsed = JSON.parse(body || '{}');
      received.push({ token, chatId: parsed.chat_id, text: parsed.text });
      res.end(JSON.stringify({ ok: true, result: { message_id: received.length } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- dữ liệu
const TOKEN_A = `111111:${'A'.repeat(35)}`;
const TOKEN_B = `222222:${'B'.repeat(35)}`;

function orderEvent(organizationId: string, entityId = randomUUID()): NotificationEventInput {
  return {
    organizationId,
    eventType: 'ORDER_CREATED',
    entityType: 'POD_ORDER',
    entityId,
    payload: {
      tiktokOrderId: `TT-${entityId.slice(0, 8)}`,
      accountName: 'AZ_TEST',
      shopName: null,
      items: [{ productName: 'Tee', sku: 'SKU', variant: 'M', quantity: 1 }],
      totalAmount: '20.45',
      currency: 'USD',
      orderCreatedAt: new Date().toISOString(),
      fulfillmentProvider: null,
      syncSource: 'CRON',
    },
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const server = await startFakeTelegram();
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const settings: Record<string, unknown> = {
    'notification.encryptionKey': randomBytes(32).toString('base64'),
    'notification.telegram.apiBaseUrl': baseUrl,
    'notification.telegram.timeoutMs': 500,
    'notification.dispatch.batchSize': 50,
    'notification.dispatch.maxAttempts': 3,
    'notification.dispatch.leaseMs': 60_000,
    'notification.dispatch.enabled': false, // không để kick() chạy nền trong lúc test
    timezoneOffsetMinutes: 420,
  };
  const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as ConfigService;
  const events = new NotificationEventRepository(prisma);
  const configs = new TelegramConfigRepository(prisma);
  const encryption = new NotificationEncryptionService(config);
  const dispatcher = () =>
    new NotificationDispatcherService(config, events, configs, new TelegramBotClient(config), encryption);

  const suffix = randomUUID().slice(0, 8);
  const orgA = await prisma.organization.create({ data: { name: `NotifTest A ${suffix}`, slug: `notif-a-${suffix}` } });
  const orgB = await prisma.organization.create({ data: { name: `NotifTest B ${suffix}`, slug: `notif-b-${suffix}` } });
  const clean = () => prisma.notificationEvent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });

  try {
    // ------------------------------------------------------------ Idempotency
    console.log('\n[1] Idempotency (UNIQUE organization_id + event_type + entity_type + entity_id + channel)');
    const same = orderEvent(orgA.id);
    const first = await events.enqueue([same]);
    const second = await events.enqueue([same]);
    const parallel = await Promise.all(Array.from({ length: 5 }, () => events.enqueue([same])));
    const rows = await prisma.notificationEvent.count({ where: { organizationId: orgA.id, entityId: same.entityId } });
    check('ghi cùng sự kiện 7 lần (2 tuần tự + 5 song song) ⇒ đúng 1 dòng', first === 1 && second === 0 && parallel.every((n) => n === 0) && rows === 1, { first, second, parallel, rows });

    const otherOrg = await events.enqueue([{ ...same, organizationId: orgB.id }]);
    check('cùng entity_id ở tổ chức KHÁC là sự kiện khác (không đụng nhau)', otherOrg === 1);

    const rolledBack = orderEvent(orgA.id);
    await prisma
      .$transaction(async (tx) => {
        await events.enqueue([rolledBack], tx);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    check(
      'transaction tạo đơn rollback ⇒ sự kiện cũng rollback',
      (await prisma.notificationEvent.count({ where: { entityId: rolledBack.entityId } })) === 0,
    );

    const inTx = orderEvent(orgA.id);
    const insideTx = await prisma.$transaction(async (tx) => {
      const a = await events.enqueue([inTx], tx);
      const b = await events.enqueue([inTx], tx); // ON CONFLICT DO NOTHING KHÔNG làm hỏng transaction
      return [a, b];
    });
    check('ghi trùng TRONG transaction không làm hỏng transaction', insideTx[0] === 1 && insideTx[1] === 0);
    await clean();

    // ------------------------------------------------------------ Claim song song
    console.log('\n[2] 4 worker claim song song (FOR UPDATE SKIP LOCKED)');
    await events.enqueue(Array.from({ length: 40 }, () => orderEvent(orgA.id)));
    const claims = await Promise.all(
      Array.from({ length: 4 }, () => events.claimDue(15, 60_000, randomUUID())),
    );
    const ids = claims.flat().map((event) => event.id);
    check('raw SQL claim chạy được trên PostgreSQL (::double precision, ::int, bind tham số)', ids.length > 0);
    check('không sự kiện nào bị hai worker cùng nhận', new Set(ids).size === ids.length, { total: ids.length, unique: new Set(ids).size });
    check('mỗi worker nhận tối đa `limit`', claims.every((batch) => batch.length <= 15));
    check('tổng số nhận = 40 (đủ, không sót)', ids.length === 40, ids.length);
    const leased = await prisma.notificationEvent.findFirst({ where: { id: ids[0] } });
    const leaseSeconds = (leased!.lockedUntil!.getTime() - Date.now()) / 1000;
    check('locked_until ≈ now + 60s (make_interval đúng đơn vị)', leaseSeconds > 50 && leaseSeconds <= 61, leaseSeconds);
    check('claim lần nữa khi mọi sự kiện đang được giữ ⇒ rỗng', (await events.claimDue(50, 60_000, randomUUID())).length === 0);
    await clean();

    // ------------------------------------------------------------ Lease / worker chết
    console.log('\n[3] Worker chết giữa chừng ⇒ lease hết hạn ⇒ nhận lại; fencing chặn worker cũ');
    const crash = orderEvent(orgA.id);
    await events.enqueue([crash]);
    const oldToken = randomUUID();
    const [claimedOld] = await events.claimDue(1, 60_000, oldToken);
    await prisma.notificationEvent.update({
      where: { id: claimedOld.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const newToken = randomUUID();
    const [reclaimed] = await events.claimDue(1, 60_000, newToken);
    check('sự kiện PROCESSING quá locked_until được claim lại (không kẹt vĩnh viễn)', reclaimed?.id === claimedOld.id);
    check('worker cũ KHÔNG bắt đầu gửi được (beginAttempt = false)', !(await events.beginAttempt(claimedOld.id, oldToken, 60_000)));
    check('worker cũ KHÔNG ghi đè kết quả (finish = false)', !(await events.finish(claimedOld.id, oldToken, { status: 'SENT' })));
    check('worker mới ghi được kết quả', await events.finish(claimedOld.id, newToken, { status: 'SENT', sentAt: new Date() }));
    const pendingAfterRestart = orderEvent(orgA.id);
    await events.enqueue([pendingAfterRestart]);
    const restartClaim = await events.claimDue(10, 60_000, randomUUID());
    check('TEST 20 — sự kiện PENDING còn nguyên sau restart và được nhận', restartClaim.some((e) => e.entityId === pendingAfterRestart.entityId));
    check('requeue với organization_id SAI ⇒ không chạm được', !(await events.requeue(orgB.id, claimedOld.id)));
    await clean();

    // ------------------------------------------------------------ Dispatcher đầu-cuối
    console.log('\n[4] Dispatcher đầu-cuối với Telegram giả');
    await configs.create(orgA.id, orgA.id, { botTokenEnc: encryption.encrypt(TOKEN_A), botTokenHint: 'AAAA', chatId: '-100111', enabled: true });
    await configs.create(orgB.id, orgB.id, { botTokenEnc: encryption.encrypt(TOKEN_B), botTokenHint: 'BBBB', chatId: '-100222', enabled: true });

    const a1 = orderEvent(orgA.id);
    const b1 = orderEvent(orgB.id);
    await events.enqueue([a1, b1]);
    received.length = 0;
    const [run1, run2] = await Promise.all([dispatcher().runOnce(), dispatcher().runOnce()]);
    check('hai dispatcher song song ⇒ mỗi sự kiện gửi đúng MỘT lần', received.length === 2 && run1.sent + run2.sent === 2, { received: received.length });
    const toA = received.find((m) => m.token === TOKEN_A);
    const toB = received.find((m) => m.token === TOKEN_B);
    check('TEST 16 — tin của A đi bot/chat của A, của B đi bot/chat của B', toA?.chatId === '-100111' && toB?.chatId === '-100222' && toA.text.includes(String((a1.payload as { tiktokOrderId: string }).tiktokOrderId)));
    const sentRow = await prisma.notificationEvent.findFirst({ where: { entityId: a1.entityId } });
    check('TEST 9 — SENT + sent_at + provider_message_id, lock đã nhả', sentRow?.status === 'SENT' && !!sentRow.sentAt && !!sentRow.providerMessageId && sentRow.lockToken === null);
    check('không gửi lại sự kiện đã SENT', (await dispatcher().runOnce()).claimed === 0);
    const cfgA = await configs.findByOrganization(orgA.id);
    check('trạng thái kết nối của A = Connected', cfgA?.lastDeliveryOk === true);

    console.log('\n[5] Retry / FAILED');
    modeByToken.set(TOKEN_A, '500');
    const retry = orderEvent(orgA.id);
    await events.enqueue([retry]);
    await dispatcher().runOnce();
    let row = await prisma.notificationEvent.findFirst({ where: { entityId: retry.entityId } });
    check('TEST 10 — 5xx ⇒ PENDING, attempt 1, next_attempt_at ở tương lai', row?.status === 'PENDING' && row.attemptCount === 1 && row.nextAttemptAt > new Date(), row);
    // Tua nhanh tới hạn và chạy tới khi hết lượt.
    for (let i = 0; i < 3; i += 1) {
      await prisma.notificationEvent.update({ where: { id: row!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await dispatcher().runOnce();
    }
    row = await prisma.notificationEvent.findFirst({ where: { entityId: retry.entityId } });
    check('TEST 11 — hết 3 lượt ⇒ FAILED, không retry vô hạn', row?.status === 'FAILED' && row.attemptCount === 3, row);

    modeByToken.set(TOKEN_A, 'hang');
    const hang = orderEvent(orgA.id);
    await events.enqueue([hang]);
    const started = Date.now();
    await dispatcher().runOnce();
    row = await prisma.notificationEvent.findFirst({ where: { entityId: hang.entityId } });
    check('TEST 19 — Telegram timeout ⇒ PENDING (retry), lượt xử lý không treo', row?.status === 'PENDING' && row.lastErrorCode === 'TELEGRAM_TIMEOUT' && Date.now() - started < 5000, row);

    modeByToken.set(TOKEN_A, '401');
    const bad = orderEvent(orgA.id);
    await events.enqueue([bad]);
    await prisma.notificationEvent.updateMany({ where: { entityId: hang.entityId }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    await dispatcher().runOnce();
    row = await prisma.notificationEvent.findFirst({ where: { entityId: bad.entityId } });
    const cfgAfter = await configs.findByOrganization(orgA.id);
    check('TEST 18 — token sai ⇒ FAILED ngay (không retry), cấu hình = Disconnected', row?.status === 'FAILED' && row.lastErrorCode === 'TELEGRAM_INVALID_TOKEN' && cfgAfter?.lastDeliveryOk === false, row);

    modeByToken.set(TOKEN_A, 'ok');
    const requeued = await events.requeueAllFailed(orgA.id);
    received.length = 0;
    await dispatcher().runOnce();
    check('sau khi sửa cấu hình: "Gửi lại tất cả lỗi" ⇒ gửi thành công', requeued === 2 && received.length === 2, { requeued, received: received.length });

    console.log('\n[6] Tổ chức tắt Telegram');
    await prisma.organizationTelegramConfig.update({ where: { organizationId: orgB.id }, data: { enabled: false } });
    const disabled = orderEvent(orgB.id);
    await events.enqueue([disabled]);
    received.length = 0;
    await dispatcher().runOnce();
    row = await prisma.notificationEvent.findFirst({ where: { entityId: disabled.entityId } });
    check('TEST 17 — tắt ⇒ SKIPPED, không gọi Telegram', row?.status === 'SKIPPED' && received.length === 0, row);
    check('isEnabled(B) = false ⇒ bên phát sẽ không ghi sự kiện mới', !(await configs.isEnabled(orgB.id)));
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\nKết quả: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
