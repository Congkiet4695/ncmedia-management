import { Injectable, Logger } from '@nestjs/common';
import { NotificationEventType, Prisma } from '@prisma/client';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import {
  allowsEvent,
  NotificationPreferenceRepository,
} from '../repositories/notification-preference.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type { NotificationEventInput } from '../types/notification-payload.types';
import { NotificationDispatcherService, NOTIFICATION_LOG_OPERATION } from './notification-dispatcher.service';

/**
 * NotificationOutboxService — cửa DUY NHẤT để module nghiệp vụ phát thông báo.
 *
 * Module nghiệp vụ KHÔNG gọi Telegram, không biết token / Chat ID: chúng chỉ ghi SỰ KIỆN vào outbox.
 * Việc gửi do `NotificationDispatcherService` làm bất đồng bộ.
 *
 * Hai cách ghi:
 *  - `enqueueInTransaction(tx, …)` — trong CÙNG transaction với thay đổi nghiệp vụ (tạo đơn): đơn
 *    commit ⇔ sự kiện commit. Lỗi ở đây LÀ lỗi của transaction (hiếm: DB lỗi), nên bên gọi chỉ gọi
 *    khi tổ chức đang bật Telegram (`isEnabled`) để đa số tổ chức không có dòng thừa.
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
  ) {}

  /**
   * Tổ chức có nhận LOẠI thông báo này không (dùng được trong transaction của bên gọi):
   * Telegram đã cấu hình + đang bật **và** tổ chức bật đúng loại (New Order / Fulfill).
   *
   * Chưa cấu hình bot ⇒ false ⇒ không ghi sự kiện ⇒ worker không bao giờ cố gửi.
   */
  async isEnabled(
    organizationId: string,
    eventType: NotificationEventType,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!(await this.configs.isEnabled(organizationId, tx))) return false;
    return allowsEvent(await this.preferences.find(organizationId, tx), eventType);
  }

  /** Ghi sự kiện trong transaction của bên gọi — idempotent (ON CONFLICT DO NOTHING). */
  enqueueInTransaction(
    tx: Prisma.TransactionClient,
    events: NotificationEventInput[],
  ): Promise<number> {
    return this.events.enqueue(events, tx);
  }

  /** Ghi sự kiện sau khi nghiệp vụ đã commit rồi đánh thức worker. Không ném lỗi. */
  async publish(event: NotificationEventInput): Promise<void> {
    try {
      if (!(await this.isEnabled(event.organizationId, event.eventType))) return;
      const created = await this.events.enqueue([event]);
      this.logger.log({
        module: 'notification',
        operation: NOTIFICATION_LOG_OPERATION[event.eventType],
        organizationId: event.organizationId,
        eventType: event.eventType,
        entityId: event.entityId,
        status: created > 0 ? 'ENQUEUED' : 'DUPLICATE_IGNORED',
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
}
