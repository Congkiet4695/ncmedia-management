/* eslint-disable */
/**
 * Kiểm thử API cấu hình Telegram trên server THẬT (localhost:3000) + DB thật.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-notification-api.manual.ts
 * Cần backend đang chạy (npm run start:dev). Không gửi tin Telegram thật: token dùng để thử là
 * token giả nên Telegram trả 401/404 (kiểm luồng lỗi). Dữ liệu tự dọn ở cuối.
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
const FAKE_TOKEN = `123456789:${'Z'.repeat(35)}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const sign = (userId: string, orgId: string, role: string) =>
    jwt.sign({ sub: userId, organizationId: orgId, role, jti: randomUUID() }, process.env.JWT_ACCESS_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: 900,
    });

  const org = await prisma.organization.findFirstOrThrow({ where: { slug: 'demo' } });
  const admin = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, role: { code: 'ADMIN' }, deletedAt: null, status: 'ACTIVE' },
  });
  const employeeRole = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, code: 'EMPLOYEE' } });
  const seller = await prisma.user.create({
    data: {
      organizationId: org.id,
      roleId: employeeRole.id,
      email: `notif-seller-${randomUUID().slice(0, 8)}@test.local`,
      fullName: 'Notif Seller',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
  });
  const existing = await prisma.organizationTelegramConfig.findUnique({ where: { organizationId: org.id } });
  if (existing) await prisma.organizationTelegramConfig.delete({ where: { id: existing.id } });

  const adminToken = sign(admin.id, org.id, 'ADMIN');
  const sellerToken = sign(seller.id, org.id, 'EMPLOYEE');

  try {
    console.log('\n[1] Phân quyền');
    const sellerGet = await call(sellerToken, 'GET', '/notifications/telegram');
    check('Seller GET cấu hình ⇒ 403', sellerGet.status === 403, sellerGet);
    const sellerPut = await call(sellerToken, 'PUT', '/notifications/telegram', { botToken: FAKE_TOKEN, chatId: '-100', enabled: true });
    check('Seller PUT cấu hình ⇒ 403', sellerPut.status === 403, sellerPut.status);
    const sellerEvents = await call(sellerToken, 'GET', '/notifications/events');
    check('Seller xem thông báo gần đây ⇒ 403', sellerEvents.status === 403, sellerEvents.status);

    console.log('\n[2] Cấu hình');
    const empty = await call(adminToken, 'GET', '/notifications/telegram');
    check('chưa cấu hình ⇒ NOT_CONFIGURED, encryptionReady', empty.json?.data?.status === 'NOT_CONFIGURED' && empty.json.data.encryptionReady === true, empty.json);
    const noToken = await call(adminToken, 'PUT', '/notifications/telegram', { chatId: '-1001234567890', enabled: true });
    check('lần đầu thiếu token ⇒ 400 TELEGRAM_BOT_TOKEN_REQUIRED', noToken.status === 400 && noToken.json?.code === 'TELEGRAM_BOT_TOKEN_REQUIRED', noToken.json);
    const badToken = await call(adminToken, 'PUT', '/notifications/telegram', { botToken: 'abc', chatId: '-1001234567890', enabled: true });
    check('token sai định dạng ⇒ 400 VALIDATION', badToken.status === 400, badToken.json);
    const badChat = await call(adminToken, 'PUT', '/notifications/telegram', { botToken: FAKE_TOKEN, chatId: 'group', enabled: true });
    check('Chat ID sai định dạng ⇒ 400 VALIDATION', badChat.status === 400, badChat.json);

    const saved = await call(adminToken, 'PUT', '/notifications/telegram', { botToken: FAKE_TOKEN, chatId: '-1001234567890', enabled: true });
    check('lưu ⇒ 200, UNTESTED, token đã che', saved.status === 200 && saved.json.data.status === 'UNTESTED' && saved.json.data.botTokenMasked === '••••••••ZZZZ', saved.json);
    check('🔴 response KHÔNG chứa Bot Token', !saved.text.includes(FAKE_TOKEN) && !saved.text.includes('Z'.repeat(10)));
    const row = await prisma.organizationTelegramConfig.findUniqueOrThrow({ where: { organizationId: org.id } });
    check('DB lưu bản MÃ HOÁ (v1.…), không plaintext', row.botTokenEnc.startsWith('v1.') && !row.botTokenEnc.includes(FAKE_TOKEN));

    const chatOnly = await call(adminToken, 'PUT', '/notifications/telegram', { chatId: '-1009999999999', enabled: false });
    const rowAfter = await prisma.organizationTelegramConfig.findUniqueOrThrow({ where: { organizationId: org.id } });
    check('chỉ đổi Chat ID (token trống) ⇒ GIỮ token cũ', chatOnly.status === 200 && rowAfter.botTokenEnc === row.botTokenEnc && rowAfter.chatId === '-1009999999999');
    check('tắt ⇒ DISABLED', chatOnly.json.data.status === 'DISABLED', chatOnly.json.data);
    const got = await call(adminToken, 'GET', '/notifications/telegram');
    check('🔴 GET không chứa Bot Token', got.status === 200 && !got.text.includes(FAKE_TOKEN));

    console.log('\n[3] Gửi thử (Telegram THẬT, token giả ⇒ lỗi)');
    const test = await call(adminToken, 'POST', '/notifications/telegram/test', {});
    check('token giả ⇒ 200 success=false, errorCode TELEGRAM_INVALID_TOKEN', test.status === 200 && test.json.data.success === false && test.json.data.errorCode === 'TELEGRAM_INVALID_TOKEN', test.json);
    check('🔴 thông điệp lỗi không chứa token', !test.text.includes(FAKE_TOKEN));
    const afterTest = await call(adminToken, 'GET', '/notifications/telegram');
    check('gửi thử cấu hình đã lưu thất bại ⇒ lưu lỗi gần nhất', afterTest.json.data.lastErrorCode === 'TELEGRAM_INVALID_TOKEN', afterTest.json.data);
    let limited = false;
    for (let i = 0; i < 6 && !limited; i += 1) {
      const r = await call(adminToken, 'POST', '/notifications/telegram/test', {});
      limited = r.status === 429 && r.json?.code === 'TELEGRAM_TEST_RATE_LIMITED';
    }
    check('gửi thử quá 5 lần / phút ⇒ 429', limited);

    console.log('\n[4] Thông báo gần đây');
    const events = await call(adminToken, 'GET', '/notifications/events?page=1&limit=5');
    check('GET events ⇒ phân trang chuẩn', events.status === 200 && Array.isArray(events.json.data.items) && typeof events.json.data.meta.total === 'number', events.json);
    const retryMissing = await call(adminToken, 'POST', `/notifications/events/${randomUUID()}/retry`);
    check('gửi lại sự kiện không tồn tại / tổ chức khác ⇒ 404', retryMissing.status === 404, retryMissing.json);

    console.log('\n[5] Xoá');
    const removed = await call(adminToken, 'DELETE', '/notifications/telegram');
    const afterRemove = await call(adminToken, 'GET', '/notifications/telegram');
    check('xoá ⇒ 204, trạng thái NOT_CONFIGURED', removed.status === 204 && afterRemove.json.data.status === 'NOT_CONFIGURED');
  } finally {
    await prisma.organizationTelegramConfig.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.delete({ where: { id: seller.id } });
    await prisma.$disconnect();
  }
  console.log(`\nKết quả: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
