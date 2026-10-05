/**
 * Kiểm chứng trên DATABASE THẬT (local): "một đơn mới ⇒ đúng MỘT tin NEW ORDER", kể cả khi đồng bộ
 * song song / lặp lại, hai worker cùng chạy, Telegram timeout, worker chết giữa lúc gửi.
 *
 *   A. Ingestion THẬT (PodOrderIngestionService + repository + mapper, DB thật): một đơn TikTok MỚI
 *      (dựng từ raw_payload của một đơn có sẵn, đổi id) ⇒ Cron + Manual sync SONG SONG, rồi 10 lượt
 *      sync liên tiếp ⇒ 1 dòng pod_orders, 1 sự kiện ORDER_CREATED.
 *   B. Dispatcher THẬT trên DB thật, Telegram GIẢ (đếm số tin): hai worker chạy song song trên cùng
 *      hàng đợi ⇒ mỗi sự kiện đúng MỘT tin.
 *   C. Telegram timeout (không rõ đã nhận) ⇒ FAILED DELIVERY_UNKNOWN, các lượt sau KHÔNG gửi lại.
 *   D. Worker chết giữa lúc gửi (PROCESSING + IN_FLIGHT + lease hết hạn) ⇒ claim lại ⇒ KHÔNG gửi.
 *
 * Telegram KHÔNG được gọi thật. Mọi dữ liệu tạm được dọn.
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/e2e-notification-dedup.manual.ts
 */
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NotificationEventStatus, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { TelegramApiError } from '../../src/modules/notification/clients/telegram-bot.client';
import { NOTIFICATION_ERROR_CODES } from '../../src/modules/notification/constants/notification.constants';
import { NotificationEventRepository } from '../../src/modules/notification/repositories/notification-event.repository';
import { NotificationDispatcherService } from '../../src/modules/notification/services/notification-dispatcher.service';
import { NotificationOutboxService } from '../../src/modules/notification/services/notification-outbox.service';
import { PodOrderMapper } from '../../src/modules/pod-tiktok/mappers/pod-order.mapper';
import { PodOrderRepository } from '../../src/modules/pod-tiktok/repositories/pod-order.repository';
import { PodOrderIngestionService } from '../../src/modules/pod-tiktok/services/pod-order-ingestion.service';
import type { TiktokOrder } from '../../src/modules/pod-tiktok/types/tiktok-order.types';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => void job.stop());
  const prisma = app.get(PrismaService);
  const config = app.get(ConfigService);
  const results: Array<[string, boolean, string]> = [];
  const check = (label: string, ok: boolean, detail: unknown) => results.push([label, ok, JSON.stringify(detail)]);
  const createdEventIds: string[] = [];
  let createdOrderTiktokId: string | null = null;
  let organizationId = '';

  try {
    // ------------------------------------------------------------- A. Ingestion song song / lặp lại
    const template = await prisma.podOrder.findFirstOrThrow({
      where: { deletedAt: null },
      select: { organizationId: true, accountId: true, shopId: true, rawPayload: true },
    });
    organizationId = template.organizationId;
    const tiktokOrderId = `9${Date.now()}`;
    createdOrderTiktokId = tiktokOrderId;
    const raw = JSON.parse(JSON.stringify(template.rawPayload)) as Record<string, unknown>;
    raw.id = tiktokOrderId;
    raw.line_items = ((raw.line_items as Array<Record<string, unknown>>) ?? []).map((line, index) => ({
      ...line,
      id: `${tiktokOrderId}${index}`,
    }));
    const order = raw as unknown as TiktokOrder;

    const realOutbox = app.get(NotificationOutboxService);
    // Bật thông báo cho lượt kiểm chứng mà KHÔNG đụng cấu hình Telegram thật của tổ chức.
    const outbox = {
      isEnabled: () => Promise.resolve(true),
      enqueueInTransaction: (tx: Prisma.TransactionClient, events: Parameters<NotificationOutboxService['enqueueInTransaction']>[1]) =>
        realOutbox.enqueueInTransaction(tx, events),
      kick: () => undefined,
    } as unknown as NotificationOutboxService;
    const ingestion = new PodOrderIngestionService(prisma, app.get(PodOrderRepository), app.get(PodOrderMapper), outbox);
    const ctx = (source: 'CRON' | 'MANUAL') => ({
      organizationId: template.organizationId,
      accountId: template.accountId,
      shopId: template.shopId,
      source,
    });

    const [cron, manual] = await Promise.all([
      ingestion.ingestBatch([order], ctx('CRON')),
      ingestion.ingestBatch([order], ctx('MANUAL')),
    ]);
    check('A1 Cron + Manual SONG SONG: đúng một lượt tạo đơn, lượt kia thành cập nhật', cron.created + manual.created === 1, {
      cron: { created: cron.created, updated: cron.updated, failed: cron.failed },
      manual: { created: manual.created, updated: manual.updated, failed: manual.failed },
    });
    for (let i = 0; i < 10; i += 1) await ingestion.ingestBatch([order], ctx(i % 2 ? 'MANUAL' : 'CRON'));
    // Lặp lại với "TikTok đổi update_time" — đơn đã tồn tại KHÔNG phải đơn mới dù trạng thái đổi.
    await ingestion.ingestBatch([{ ...order, update_time: Number(order.update_time ?? 0) + 60, status: 'AWAITING_COLLECTION' }], ctx('CRON'));

    const orders = await prisma.podOrder.findMany({ where: { organizationId, tiktokOrderId }, select: { id: true } });
    check('A2 sau 2 song song + 11 lượt lặp: đúng 1 dòng pod_orders', orders.length === 1, orders.length);
    const events = await prisma.notificationEvent.findMany({
      where: { organizationId, eventType: 'ORDER_CREATED', entityId: { in: orders.map((row) => row.id) } },
    });
    createdEventIds.push(...events.map((event) => event.id));
    check('A3 đúng 1 sự kiện ORDER_CREATED cho đơn', events.length === 1, events.length);

    // ------------------------------------------------------------- B. Hai worker song song
    const extra = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.notificationEvent.create({
          data: { organizationId, eventType: 'ORDER_CREATED', entityType: 'POD_ORDER', entityId: randomUUID(), payload: { tiktokOrderId: 'E2E', items: [] } },
        }),
      ),
    );
    createdEventIds.push(...extra.map((event) => event.id));
    const ours = new Set(createdEventIds);
    // Chỉ xử lý sự kiện của lượt kiểm chứng: hoãn mọi sự kiện PENDING khác của DB (khôi phục cuối).
    const others = await prisma.notificationEvent.findMany({
      where: { status: NotificationEventStatus.PENDING, id: { notIn: [...ours] } },
      select: { id: true, nextAttemptAt: true },
    });
    await prisma.notificationEvent.updateMany({
      where: { id: { in: others.map((event) => event.id) } },
      data: { nextAttemptAt: new Date('2999-01-01T00:00:00Z') },
    });

    const sends = new Map<string, number>();
    const fakeTelegram = (mode: 'OK' | 'TIMEOUT') => ({
      sendMessage: async (_token: string, _chat: string, text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (mode === 'TIMEOUT') {
          throw new TelegramApiError(NOTIFICATION_ERROR_CODES.TIMEOUT, 'Telegram không phản hồi sau 10000ms', true, 'UNKNOWN');
        }
        sends.set(text, (sends.get(text) ?? 0) + 1);
        return { messageId: String(Math.floor(Math.random() * 1e9)) };
      },
    });
    const configs = {
      findByOrganization: () => Promise.resolve({ enabled: true, chatId: '-1001234567890', botTokenEnc: 'enc' }),
      findOrganizationName: () => Promise.resolve('E2E'),
      recordDelivery: () => Promise.resolve(),
    };
    const encryption = { isConfigured: () => true, decrypt: () => 'token' };
    const preferences = { find: () => Promise.resolve(null) };
    const worker = (mode: 'OK' | 'TIMEOUT') =>
      new NotificationDispatcherService(
        config,
        app.get(NotificationEventRepository),
        configs as never,
        fakeTelegram(mode) as never,
        encryption as never,
        preferences as never,
      );

    let counted = 0;
    const countSends = () => [...sends.values()].reduce((sum, n) => sum + n, 0);
    await Promise.all([worker('OK').runOnce(), worker('OK').runOnce()]);
    counted = countSends();
    const after = await prisma.notificationEvent.findMany({ where: { id: { in: [...ours] } }, select: { status: true, attemptCount: true } });
    check('B1 hai worker song song: 21 sự kiện ⇒ đúng 21 tin, mỗi sự kiện SENT với 1 lần thử', counted === 21 && after.every((row) => row.status === 'SENT' && row.attemptCount === 1), {
      sends: counted,
      statuses: [...new Set(after.map((row) => row.status))],
    });
    await Promise.all([worker('OK').runOnce(), worker('OK').runOnce()]);
    check('B2 chạy thêm hai lượt: không gửi lại sự kiện đã SENT', countSends() === counted, countSends());

    // ------------------------------------------------------------- C. Timeout không rõ đã nhận
    const timeoutEvent = await prisma.notificationEvent.create({
      data: { organizationId, eventType: 'ORDER_CREATED', entityType: 'POD_ORDER', entityId: randomUUID(), payload: { tiktokOrderId: 'E2E-TIMEOUT', items: [] } },
    });
    createdEventIds.push(timeoutEvent.id);
    await worker('TIMEOUT').runOnce();
    const timedOut = await prisma.notificationEvent.findUniqueOrThrow({ where: { id: timeoutEvent.id } });
    const before = countSends();
    await worker('OK').runOnce();
    await worker('OK').runOnce();
    check('C1 timeout ⇒ FAILED DELIVERY_UNKNOWN; các lượt sau KHÔNG tự gửi lại', timedOut.status === 'FAILED' && timedOut.lastErrorCode === NOTIFICATION_ERROR_CODES.DELIVERY_UNKNOWN && countSends() === before, {
      status: timedOut.status,
      code: timedOut.lastErrorCode,
      attempts: timedOut.attemptCount,
    });

    // ------------------------------------------------------------- D. Worker chết giữa lúc gửi
    const crashed = await prisma.notificationEvent.create({
      data: {
        organizationId,
        eventType: 'ORDER_CREATED',
        entityType: 'POD_ORDER',
        entityId: randomUUID(),
        payload: { tiktokOrderId: 'E2E-CRASH', items: [] },
        status: NotificationEventStatus.PROCESSING,
        attemptCount: 1,
        lockToken: randomUUID(),
        lockedUntil: new Date(Date.now() - 60_000),
        lastErrorCode: NOTIFICATION_ERROR_CODES.IN_FLIGHT,
      },
    });
    createdEventIds.push(crashed.id);
    const beforeCrash = countSends();
    await worker('OK').runOnce();
    const recovered = await prisma.notificationEvent.findUniqueOrThrow({ where: { id: crashed.id } });
    check('D1 worker chết giữa lúc gửi ⇒ claim lại ⇒ FAILED DELIVERY_UNKNOWN, KHÔNG gửi lần hai', recovered.status === 'FAILED' && recovered.lastErrorCode === NOTIFICATION_ERROR_CODES.DELIVERY_UNKNOWN && countSends() === beforeCrash, {
      status: recovered.status,
      code: recovered.lastErrorCode,
    });

    // Khôi phục hàng đợi của DB.
    for (const event of others) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { nextAttemptAt: event.nextAttemptAt } });
    }
  } finally {
    await prisma.notificationEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    if (createdOrderTiktokId) {
      const rows = await prisma.podOrder.findMany({ where: { organizationId, tiktokOrderId: createdOrderTiktokId }, select: { id: true } });
      const ids = rows.map((row) => row.id);
      await prisma.notificationEvent.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.podOrderPackage.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.podOrderItem.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.podOrder.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
  }

  for (const [label, ok, detail] of results) console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  console.log('Đã dọn dữ liệu tạm.');
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
