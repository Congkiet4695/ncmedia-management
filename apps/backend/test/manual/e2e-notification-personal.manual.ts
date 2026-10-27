/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP kênh Telegram CÁ NHÂN (Employee) trên DATABASE THẬT + Telegram Bot API GIẢ (không gửi tin
 * thật). Chứng minh: Employee chỉ nhận đơn của shop ĐANG được gán, kiểm cả lúc ghi lẫn lúc gửi.
 *
 * Chạy (DB tạm — KHÔNG chạy trên DB dùng chung với production):
 *   DATABASE_URL=postgresql://…local… node -r ts-node/register/transpile-only -r dotenv/config \
 *     test/manual/e2e-notification-personal.manual.ts
 * Tạo một Organization tạm và tự dọn ở cuối (CASCADE).
 */
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { NotificationEventRepository } from '../../src/modules/notification/repositories/notification-event.repository';
import { TelegramConfigRepository } from '../../src/modules/notification/repositories/telegram-config.repository';
import { NotificationPreferenceRepository } from '../../src/modules/notification/repositories/notification-preference.repository';
import { NotificationRecipientRepository } from '../../src/modules/notification/repositories/notification-recipient.repository';
import { organizationOwner } from '../../src/modules/notification/types/notification-owner';
import { TelegramBotClient } from '../../src/modules/notification/clients/telegram-bot.client';
import { NotificationEncryptionService } from '../../src/modules/notification/services/notification-encryption.service';
import { NotificationDispatcherService } from '../../src/modules/notification/services/notification-dispatcher.service';
import { NotificationOutboxService } from '../../src/modules/notification/services/notification-outbox.service';
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
const received: Array<{ token: string; chatId: string; text: string }> = [];
const failingTokens = new Set<string>();
function startFakeTelegram(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const token = /^\/bot([^/]+)\//.exec(req.url ?? '')?.[1] ?? '';
      res.setHeader('Content-Type', 'application/json');
      if (failingTokens.has(token)) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error_code: 500, description: 'Internal Server Error' }));
      }
      const parsed = JSON.parse(body || '{}');
      received.push({ token, chatId: parsed.chat_id, text: parsed.text });
      res.end(JSON.stringify({ ok: true, result: { message_id: received.length } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const tokenOf = (label: string) => `${Math.floor(100000 + Math.random() * 899999)}:${label.padEnd(35, 'x').slice(0, 35)}`;

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const server = await startFakeTelegram();
  const settings: Record<string, unknown> = {
    'notification.encryptionKey': randomBytes(32).toString('base64'),
    'notification.telegram.apiBaseUrl': `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    'notification.telegram.timeoutMs': 2000,
    'notification.dispatch.batchSize': 50,
    'notification.dispatch.maxAttempts': 3,
    'notification.dispatch.leaseMs': 60_000,
    'notification.dispatch.enabled': false,
  };
  const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as ConfigService;
  const events = new NotificationEventRepository(prisma);
  const configs = new TelegramConfigRepository(prisma);
  const encryption = new NotificationEncryptionService(config);
  const preferences = new NotificationPreferenceRepository(prisma);
  const recipients = new NotificationRecipientRepository(prisma);
  const dispatcher = () =>
    new NotificationDispatcherService(config, events, configs, new TelegramBotClient(config), encryption, preferences, recipients);
  const outbox = new NotificationOutboxService(events, configs, dispatcher(), preferences, recipients);

  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `NotifPersonal ${suffix}`, slug: `notif-p-${suffix}` } });

  try {
    // ------------------------------------------------------------ Dữ liệu
    const perms = await prisma.permission.findMany({
      where: { code: { in: ['notification.self', 'pod.tiktok.order.read', 'fulfillment.read', 'pod.tiktok.return.read', 'pod.shop.all'] } },
    });
    const permId = (code: string) => perms.find((p) => p.code === code)!.id;
    check('catalog có notification.self (đã seed)', perms.some((p) => p.code === 'notification.self'));

    // Role Employee: KHÔNG có quyền Returns — để chứng minh tin Return không lọt tới người không được xem Returns.
    const empRole = await prisma.role.create({ data: { organizationId: org.id, code: 'EMPLOYEE', displayName: 'Employee' } });
    for (const code of ['notification.self', 'pod.tiktok.order.read', 'fulfillment.read']) {
      await prisma.rolePermission.create({ data: { roleId: empRole.id, permissionId: permId(code) } });
    }
    const leadRole = await prisma.role.create({ data: { organizationId: org.id, code: 'LEAD', displayName: 'Lead' } });
    for (const code of ['notification.self', 'pod.tiktok.order.read', 'fulfillment.read', 'pod.tiktok.return.read', 'pod.shop.all']) {
      await prisma.rolePermission.create({ data: { roleId: leadRole.id, permissionId: permId(code) } });
    }

    const makeUser = async (label: string, roleId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => {
      const user = await prisma.user.create({
        data: { organizationId: org.id, roleId, email: `${label}-${suffix}@e2e.local`, passwordHash: 'x', fullName: label, status },
      });
      const employee = await prisma.employee.create({ data: { organizationId: org.id, userId: user.id } });
      return { user, employee };
    };
    const e1 = await makeUser('e1', empRole.id);
    const e2 = await makeUser('e2', empRole.id);
    const e3 = await makeUser('e3-no-shop', empRole.id);
    const off = await makeUser('inactive', empRole.id, 'INACTIVE');
    const lead = await makeUser('lead', leadRole.id);

    const makeAccount = async (label: string, sellerId: string | null) =>
      prisma.podTiktokAccount.create({
        data: {
          organizationId: org.id,
          accountName: `${label}-${suffix}`,
          openId: `open-${label}-${suffix}`,
          userType: 0,
          accessTokenEnc: 'x',
          accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
          refreshTokenEnc: 'x',
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
          sellerId,
        },
      });
    const acc1 = await makeAccount('acc1', e1.employee.id);
    const acc2 = await makeAccount('acc2', e1.employee.id);
    const acc3 = await makeAccount('acc3', e2.employee.id);
    const acc4 = await makeAccount('acc4', off.employee.id);

    const tokens = { org: tokenOf('ORG'), e1: tokenOf('E1'), e2: tokenOf('E2'), e3: tokenOf('E3'), off: tokenOf('OFF'), lead: tokenOf('LEAD') };
    const channel = async (userId: string | null, token: string, chatId: string) =>
      configs.create({ organizationId: org.id, userId }, userId ?? org.id, {
        botTokenEnc: encryption.encrypt(token),
        botTokenHint: token.slice(-4),
        chatId,
        enabled: true,
      });
    await channel(null, tokens.org, '-100000');
    await channel(e1.user.id, tokens.e1, '-100001');
    await channel(e2.user.id, tokens.e2, '-100002');
    await channel(e3.user.id, tokens.e3, '-100003');
    await channel(off.user.id, tokens.off, '-100004');
    await channel(lead.user.id, tokens.lead, '-100005');

    const order = (accountId: string, tag: string, eventType: 'ORDER_CREATED' | 'RETURN_REFUND_REQUEST' = 'ORDER_CREATED'): NotificationEventInput =>
      ({
        organizationId: org.id,
        eventType,
        entityType: eventType === 'ORDER_CREATED' ? 'POD_ORDER' : 'POD_RETURN_REQUEST',
        entityId: randomUUID(),
        scope: { accountId, shopId: null },
        payload:
          eventType === 'ORDER_CREATED'
            ? { tiktokOrderId: `TT-${tag}`, accountName: tag, shopName: tag, items: [], totalAmount: '10', currency: 'USD', orderCreatedAt: null, fulfillmentProvider: null, syncSource: 'CRON' }
            : { tiktokReturnId: `R-${tag}`, tiktokOrderId: `TT-${tag}`, sellerName: null, accountName: tag, shopName: tag, returnType: 'REFUND', reason: null, status: 'X', items: [], currency: 'USD', paidAmount: null, requestedRefundAmount: null, requestedAt: null, link: null },
      }) as NotificationEventInput;
    const recipientsOf = async (entityId: string) =>
      (await prisma.notificationEvent.findMany({ where: { entityId }, select: { recipientUserId: true } }))
        .map((row) => row.recipientUserId ?? 'ORG')
        .sort();
    const names: Record<string, string> = { [e1.user.id]: 'e1', [e2.user.id]: 'e2', [e3.user.id]: 'e3', [off.user.id]: 'off', [lead.user.id]: 'lead', ORG: 'ORG' };
    const named = (ids: string[]) => ids.map((id) => names[id] ?? id).sort();

    // ------------------------------------------------------------ Chọn người nhận lúc GHI
    console.log('\n[1] Người nhận lúc ghi (trong transaction tạo đơn)');
    const o1 = order(acc1.id, 'O1');
    const o2 = order(acc2.id, 'O2');
    const o3 = order(acc3.id, 'O3');
    const o4 = order(acc4.id, 'O4');
    const r1 = order(acc1.id, 'R1', 'RETURN_REFUND_REQUEST');
    await prisma.$transaction((tx) => outbox.enqueueInTransaction(tx, [o1, o2, o3, o4, r1]));
    check('đơn shop acc1 ⇒ ORG + e1 + lead (không e2, e3)', JSON.stringify(named(await recipientsOf(o1.entityId))) === JSON.stringify(['ORG', 'e1', 'lead']), named(await recipientsOf(o1.entityId)));
    check('Employee gán NHIỀU shop: đơn acc2 ⇒ e1 cũng nhận', named(await recipientsOf(o2.entityId)).includes('e1'));
    check('đơn shop của e2 ⇒ ORG + e2 + lead (e1 KHÔNG nhận)', JSON.stringify(named(await recipientsOf(o3.entityId))) === JSON.stringify(['ORG', 'e2', 'lead']), named(await recipientsOf(o3.entityId)));
    check('e3 KHÔNG được gán shop ⇒ không có dòng nào cho e3', !(await prisma.notificationEvent.count({ where: { organizationId: org.id, recipientUserId: e3.user.id } })));
    check('người dùng INACTIVE ⇒ không nhận dù là seller của shop', JSON.stringify(named(await recipientsOf(o4.entityId))) === JSON.stringify(['ORG', 'lead']), named(await recipientsOf(o4.entityId)));
    check('role KHÔNG có quyền Returns ⇒ tin Return không tới e1 (vẫn tới ORG + lead)', JSON.stringify(named(await recipientsOf(r1.entityId))) === JSON.stringify(['ORG', 'lead']), named(await recipientsOf(r1.entityId)));

    const again = await prisma.$transaction((tx) => outbox.enqueueInTransaction(tx, [o1]));
    check('phát lại cùng đơn ⇒ 0 dòng mới (idempotent theo người nhận)', again === 0, again);

    // ------------------------------------------------------------ Gửi
    console.log('\n[2] Gửi — mỗi kênh chỉ nhận đúng phạm vi của mình');
    received.length = 0;
    await dispatcher().runOnce();
    const textsOf = (token: string) => received.filter((m) => m.token === token).map((m) => m.text);
    const ordersIn = (texts: string[]) => ['O1', 'O2', 'O3', 'O4', 'R1'].filter((tag) => texts.some((text) => text.includes(`TT-${tag}`)));
    check('e1 nhận O1 + O2 (shop của mình), KHÔNG có O3 / O4 / R1', JSON.stringify(ordersIn(textsOf(tokens.e1))) === JSON.stringify(['O1', 'O2']), ordersIn(textsOf(tokens.e1)));
    check('e2 chỉ nhận O3', JSON.stringify(ordersIn(textsOf(tokens.e2))) === JSON.stringify(['O3']), ordersIn(textsOf(tokens.e2)));
    check('e3 / inactive không nhận gì', textsOf(tokens.e3).length === 0 && textsOf(tokens.off).length === 0);
    check('Admin (kênh tổ chức) vẫn nhận MỌI đơn như trước', ordersIn(textsOf(tokens.org)).length === 5, ordersIn(textsOf(tokens.org)));
    check('chat của kênh cá nhân là chat của chính người đó', received.filter((m) => m.token === tokens.e1).every((m) => m.chatId === '-100001'));
    received.length = 0;
    await dispatcher().runOnce();
    check('chạy lại worker ⇒ không gửi trùng tin đã SENT', received.length === 0, received.length);

    // ------------------------------------------------------------ Đổi phân công trong lúc tin còn chờ
    console.log('\n[3] Shop acc3 chuyển từ e2 sang e1 trong lúc tin còn trong hàng đợi');
    const o5 = order(acc3.id, 'O5');
    await prisma.$transaction((tx) => outbox.enqueueInTransaction(tx, [o5]));
    await prisma.podTiktokAccount.update({ where: { id: acc3.id }, data: { sellerId: e1.employee.id } });
    received.length = 0;
    await dispatcher().runOnce();
    const e2Row = await prisma.notificationEvent.findFirst({ where: { entityId: o5.entityId, recipientUserId: e2.user.id } });
    check('tin của e2 (không còn được gán) ⇒ SKIPPED SCOPE_REVOKED, KHÔNG gửi', e2Row?.status === 'SKIPPED' && e2Row.lastErrorCode === 'NOTIFICATION_RECIPIENT_SCOPE_REVOKED' && textsOf(tokens.e2).length === 0, e2Row);
    const o6 = order(acc3.id, 'O6');
    await prisma.$transaction((tx) => outbox.enqueueInTransaction(tx, [o6]));
    check('đơn MỚI của acc3 ⇒ theo phân công hiện tại: e1 nhận, e2 không', JSON.stringify(named(await recipientsOf(o6.entityId))) === JSON.stringify(['ORG', 'e1', 'lead']), named(await recipientsOf(o6.entityId)));

    // ------------------------------------------------------------ Gỡ phân công
    console.log('\n[4] Gỡ toàn bộ phân công của e1');
    await prisma.podTiktokAccount.updateMany({ where: { sellerId: e1.employee.id }, data: { sellerId: null } });
    received.length = 0;
    await dispatcher().runOnce();
    const e1O6 = await prisma.notificationEvent.findFirst({ where: { entityId: o6.entityId, recipientUserId: e1.user.id } });
    check('tin còn chờ của e1 ⇒ SKIPPED (không gửi dữ liệu shop đã bị gỡ)', e1O6?.status === 'SKIPPED' && textsOf(tokens.e1).length === 0, e1O6);
    const o7 = order(acc1.id, 'O7');
    await prisma.$transaction((tx) => outbox.enqueueInTransaction(tx, [o7]));
    check('đơn mới của shop cũ ⇒ e1 không còn nhận', !named(await recipientsOf(o7.entityId)).includes('e1'), named(await recipientsOf(o7.entityId)));

    // ------------------------------------------------------------ Lỗi Telegram của MỘT kênh
    console.log('\n[5] Telegram lỗi ở kênh của lead ⇒ chỉ kênh đó retry, kênh khác vẫn gửi');
    failingTokens.add(tokens.lead);
    received.length = 0;
    await dispatcher().runOnce();
    const leadO7 = await prisma.notificationEvent.findFirst({ where: { entityId: o7.entityId, recipientUserId: lead.user.id } });
    const orgO7 = await prisma.notificationEvent.findFirst({ where: { entityId: o7.entityId, recipientKey: 'ORGANIZATION' } });
    check('lead: 5xx ⇒ PENDING (retry theo cơ chế cũ)', leadO7?.status === 'PENDING' && leadO7.attemptCount === 1, leadO7);
    check('kênh tổ chức không bị ảnh hưởng ⇒ SENT', orgO7?.status === 'SENT', orgO7);
    failingTokens.clear();
    await prisma.notificationEvent.update({ where: { id: leadO7!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    received.length = 0;
    await dispatcher().runOnce();
    check('sau khi Telegram hồi phục ⇒ lead nhận đúng MỘT tin O7, kênh tổ chức không bị gửi lại', textsOf(tokens.lead).length === 1 && textsOf(tokens.org).length === 0, received.length);

    // ------------------------------------------------------------ Cô lập kênh khi liệt kê / gửi lại
    console.log('\n[6] Danh sách / gửi lại theo kênh');
    const [mine] = await events.list({ organizationId: org.id, userId: e2.user.id }, {}, 1, 50);
    check('e2 chỉ thấy sự kiện của kênh mình', mine.length > 0 && mine.every((event) => event.recipientUserId === e2.user.id), mine.length);
    const orgEventId = orgO7!.id;
    check('e2 KHÔNG gửi lại được sự kiện của kênh tổ chức (đoán id)', !(await events.requeue({ organizationId: org.id, userId: e2.user.id }, orgEventId)));
    check('e2 KHÔNG đọc được trạng thái sự kiện của kênh khác', (await events.findStatus({ organizationId: org.id, userId: e2.user.id }, orgEventId)) === null);
    check('kênh tổ chức vẫn đọc cấu hình riêng của nó', (await configs.findByOwner(organizationOwner(org.id)))?.chatId === '-100000');
  } finally {
    await prisma.notificationEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.podTiktokAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.employee.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationTelegramConfig.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.rolePermission.deleteMany({ where: { role: { organizationId: org.id } } });
    await prisma.role.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    server.close();
    await prisma.$disconnect();
  }
  console.log(`\nKết quả: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
