import { Injectable, Logger } from '@nestjs/common';
import { NotificationEventType, Prisma } from '@prisma/client';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import {
  allowsEvent,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferenceRepository,
} from '../repositories/notification-preference.repository';
import { NotificationRecipientRepository } from '../repositories/notification-recipient.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import { organizationOwner } from '../types/notification-owner';
import type {
  NotificationEventInput,
  NotificationEventRow,
} from '../types/notification-payload.types';
import { NotificationDispatcherService, NOTIFICATION_LOG_OPERATION } from './notification-dispatcher.service';

/**
 * NotificationOutboxService — cửa DUY NHẤT để module nghiệp vụ phát thông báo.
 *
 * Module nghiệp vụ KHÔNG gọi Telegram, không biết token / Chat ID, không biết AI nhận: chúng chỉ ghi SỰ
 * KIỆN (kèm phạm vi Account / Shop của đơn). Outbox chọn người nhận; `NotificationDispatcherService` gửi
 * bất đồng bộ.
 *
 * Người nhận của một sự kiện = một dòng outbox mỗi người:
 *  - kênh TỔ CHỨC — nếu đang bật và bật loại thông báo này (hành vi cũ, nhận mọi đơn);
 *  - mỗi kênh CÁ NHÂN đang bật, bật loại này, và người đó ĐANG được phép xem đơn này (shop được gán —
 *    `NotificationRecipientRepository`). Không ai đủ điều kiện ⇒ không có dòng ⇒ không có tin.
 *
 * Hai cách ghi:
 *  - `enqueueInTransaction(tx, …)` — trong CÙNG transaction với thay đổi nghiệp vụ (tạo đơn): đơn
 *    commit ⇔ sự kiện commit. Lỗi ở đây LÀ lỗi của transaction (hiếm: DB lỗi), nên bên gọi chỉ gọi
 *    khi có kênh nào đó đang bật (`isEnabled`) để đa số tổ chức không có dòng thừa.
 *  - `publish(…)` — SAU khi thay đổi nghiệp vụ đã commit (fulfill / huỷ — trạng thái do adapter nhà
 *    cung cấp ghi). KHÔNG BAO GIỜ ném lỗi: thông báo lỗi không được làm hỏng kết quả fulfill.
 */
@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(
    private readonly events: NotificationEventRepository,
    private readonly configs: TelegramConfigRepository,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly recipients: NotificationRecipientRepository,
  ) {}

  /**
   * Có kênh NÀO có thể nhận loại thông báo này không (dùng được trong transaction của bên gọi): kênh tổ
   * chức đang bật + bật loại này, HOẶC có ít nhất một kênh cá nhân đang bật. Bộ lọc tuỳ chọn / phạm vi
   * shop của kênh cá nhân chạy ở lúc ghi (`fanOut`).
   *
   * Không có kênh nào ⇒ false ⇒ không ghi sự kiện ⇒ worker không bao giờ cố gửi.
   */
  async isEnabled(
    organizationId: string,
    eventType: NotificationEventType,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (await this.organizationWants(organizationId, eventType, tx)) return true;
    return (await this.configs.enabledPersonalUserIds(organizationId, tx)).length > 0;
  }

  /** Ghi sự kiện trong transaction của bên gọi — idempotent theo người nhận (ON CONFLICT DO NOTHING). */
  async enqueueInTransaction(
    tx: Prisma.TransactionClient,
    events: NotificationEventInput[],
  ): Promise<number> {
    return this.events.enqueue(await this.fanOut(events, tx), tx);
  }

  /** Ghi sự kiện sau khi nghiệp vụ đã commit rồi đánh thức worker. Không ném lỗi. */
  async publish(event: NotificationEventInput): Promise<void> {
    try {
      if (!(await this.isEnabled(event.organizationId, event.eventType))) return;
      const rows = await this.fanOut([event]);
      const created = await this.events.enqueue(rows);
      this.logger.log({
        module: 'notification',
        operation: NOTIFICATION_LOG_OPERATION[event.eventType],
        organizationId: event.organizationId,
        eventType: event.eventType,
        entityId: event.entityId,
        recipients: rows.length,
        status: created > 0 ? 'ENQUEUED' : rows.length === 0 ? 'NO_RECIPIENT' : 'DUPLICATE_IGNORED',
        msg: 'Ghi sự kiện thông báo',
      });
      if (created > 0) this.dispatcher.kick();
    } catch (error) {
      this.logger.error({
        module: 'notification',
        operation: NOTIFICATION_LOG_OPERATION[event.eventType],
        organizationId: event.organizationId,
        eventType: event.eventType,
        entityId: event.entityId,
        status: 'ENQUEUE_FAILED',
        error: (error as Error).message,
        msg: 'Không ghi được sự kiện thông báo (đã bỏ qua — nghiệp vụ không bị ảnh hưởng)',
      });
    }
  }

  /** Đánh thức worker sau khi transaction chứa sự kiện đã commit. */
  kick(): void {
    this.dispatcher.kick();
  }

  /**
   * Sự kiện nghiệp vụ ⇒ các dòng outbox, mỗi dòng một người nhận.
   *
   * 🔴 Phạm vi lấy từ `event.scope` (bên phát đọc từ bản ghi đơn) và quyền / phân công đọc từ DB — không
   * có gì đến từ request. Truy vấn gom theo tổ chức (cấu hình + tuỳ chọn) và theo (loại, account) (phạm vi).
   */
  private async fanOut(
    events: NotificationEventInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationEventRow[]> {
    const rows: NotificationEventRow[] = [];
    const personalByOrg = new Map<string, { userIds: string[]; wants: (type: NotificationEventType) => string[] }>();
    const organizationWants = new Map<string, boolean>();
    const allowedCache = new Map<string, Set<string>>();

    for (const event of events) {
      const orgKey = `${event.organizationId}:${event.eventType}`;
      if (!organizationWants.has(orgKey)) {
        organizationWants.set(orgKey, await this.organizationWants(event.organizationId, event.eventType, tx));
      }
      if (organizationWants.get(orgKey)) rows.push({ ...event, recipientUserId: null });

      let personal = personalByOrg.get(event.organizationId);
      if (!personal) {
        const userIds = await this.configs.enabledPersonalUserIds(event.organizationId, tx);
        const preferences = await this.preferences.findForUsers(event.organizationId, userIds, tx);
        personal = {
          userIds,
          wants: (type) => userIds.filter((userId) => allowsEvent(preferences.get(userId) ?? DEFAULT_NOTIFICATION_PREFERENCES, type)),
        };
        personalByOrg.set(event.organizationId, personal);
      }
      if (personal.userIds.length === 0) continue;

      const scopeKey = `${event.organizationId}:${event.eventType}:${event.scope.accountId ?? '-'}`;
      let allowed = allowedCache.get(scopeKey);
      if (!allowed) {
        allowed = await this.recipients.allowedUserIds(
          {
            organizationId: event.organizationId,
            eventType: event.eventType,
            accountId: event.scope.accountId,
            userIds: personal.wants(event.eventType),
          },
          tx,
        );
        allowedCache.set(scopeKey, allowed);
      }
      for (const userId of allowed) rows.push({ ...event, recipientUserId: userId });
    }
    return rows;
  }

  /** Kênh tổ chức đang bật VÀ tổ chức bật loại thông báo này. */
  private async organizationWants(
    organizationId: string,
    eventType: NotificationEventType,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const owner = organizationOwner(organizationId);
    if (!(await this.configs.isEnabled(owner, tx))) return false;
    return allowsEvent(await this.preferences.find(owner, tx), eventType);
  }
}
