import { Injectable } from '@nestjs/common';
import {
  NotificationEvent,
  NotificationEventStatus,
  NotificationEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NOTIFICATION_ERROR_CODES } from '../constants/notification.constants';
import type { NotificationEventInput } from '../types/notification-payload.types';

/** Trạng thái được phép "Gửi lại" thủ công. */
export const REQUEUEABLE_NOTIFICATION_STATUSES: readonly NotificationEventStatus[] = [
  NotificationEventStatus.FAILED,
  NotificationEventStatus.SKIPPED,
];

/** Kết quả cuối (hoặc hẹn lại) của một lần xử lý. */
export interface EventResult {
  status: NotificationEventStatus;
  nextAttemptAt?: Date;
  sentAt?: Date | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Data access cho `notification_events` (outbox).
 *
 * Ba cơ chế chống gửi trùng nằm ở đây:
 *  1. **Idempotency khi ghi** — `createMany … skipDuplicates` (ON CONFLICT DO NOTHING) trên UNIQUE
 *     (organization_id, event_type, entity_type, entity_id, channel): phát lại cùng sự kiện là no-op
 *     và KHÔNG làm hỏng transaction của bên gọi.
 *  2. **Claim nguyên tử** — `FOR UPDATE SKIP LOCKED`: hai worker (hai instance / hai nhịp cron) không
 *     bao giờ cùng nhận một sự kiện. Sự kiện PROCESSING quá `locked_until` (worker chết) được claim
 *     lại ⇒ không kẹt vĩnh viễn, không mất sự kiện khi restart.
 *  3. **Fencing token** — mọi lệnh ghi kết quả kèm `lock_token` của lượt claim: worker đã mất lease
 *     không ghi đè được kết quả của worker khác.
 */
@Injectable()
export class NotificationEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi sự kiện (idempotent). Trả số dòng THỰC SỰ được tạo. */
  async enqueue(
    events: NotificationEventInput[],
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    if (events.length === 0) return 0;
    const result = await client.notificationEvent.createMany({
      data: events.map((event) => ({
        organizationId: event.organizationId,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload as unknown as Prisma.InputJsonValue,
        createdBy: event.actorUserId ?? null,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Nhận tối đa `limit` sự kiện đến hạn cho MỘT worker (một câu lệnh, nguyên tử).
   *
   * - `FOR UPDATE SKIP LOCKED`: dòng đang bị transaction claim khác khoá thì BỎ QUA thay vì chờ ⇒ hai
   *   worker chạy song song nhận hai tập rời nhau.
   * - Sự kiện PROCESSING đã quá `locked_until` được nhận LẠI (at-least-once). Lock token mới thay
   *   token cũ ⇒ worker cũ, nếu vẫn còn sống, không ghi đè được kết quả (fencing).
   *
   * Tham số đều BIND qua tagged template của Prisma (`$1`, `$2`…), không nối chuỗi. Ép kiểu tường
   * minh vì Prisma gửi số JS dưới dạng numeric: `make_interval(secs => …)` cần double precision,
   * `LIMIT` cần số nguyên.
   */
  async claimDue(limit: number, leaseMs: number, lockToken: string): Promise<NotificationEvent[]> {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "notification_events" AS e
         SET "status" = 'PROCESSING'::"notification_event_status",
             "lock_token" = ${lockToken}::uuid,
             "locked_until" = now() + make_interval(secs => ${leaseMs / 1000}::double precision),
             "updated_at" = now()
       WHERE e."id" IN (
         SELECT "id" FROM "notification_events"
          WHERE ("status" = 'PENDING'::"notification_event_status" AND "next_attempt_at" <= now())
             OR ("status" = 'PROCESSING'::"notification_event_status" AND "locked_until" < now())
          ORDER BY "next_attempt_at" ASC, "created_at" ASC
          LIMIT ${limit}::int
          FOR UPDATE SKIP LOCKED
       )
      RETURNING e."id"`;
    if (claimed.length === 0) return [];
    return this.prisma.notificationEvent.findMany({
      where: { id: { in: claimed.map((row) => row.id) }, lockToken },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Bắt đầu MỘT lần gọi Telegram: tăng `attempt_count` và gia hạn lease — chỉ khi còn giữ sự kiện.
   * `false` ⇒ lease đã mất (worker khác đã nhận lại) ⇒ KHÔNG được gửi.
   */
  async beginAttempt(id: string, lockToken: string, leaseMs: number): Promise<boolean> {
    const result = await this.prisma.notificationEvent.updateMany({
      where: { id, lockToken, status: NotificationEventStatus.PROCESSING },
      data: {
        attemptCount: { increment: 1 },
        lockedUntil: new Date(Date.now() + leaseMs),
      },
    });
    return result.count === 1;
  }

  /** Ghi kết quả — chỉ khi vẫn là worker đang giữ sự kiện (fencing). */
  async finish(id: string, lockToken: string, result: EventResult): Promise<boolean> {
    const updated = await this.prisma.notificationEvent.updateMany({
      where: { id, lockToken, status: NotificationEventStatus.PROCESSING },
      data: {
        status: result.status,
        lockToken: null,
        lockedUntil: null,
        ...(result.nextAttemptAt ? { nextAttemptAt: result.nextAttemptAt } : {}),
        ...(result.sentAt !== undefined ? { sentAt: result.sentAt } : {}),
        ...(result.providerMessageId !== undefined
          ? { providerMessageId: result.providerMessageId }
          : {}),
        ...(result.lastErrorCode !== undefined ? { lastErrorCode: result.lastErrorCode } : {}),
        ...(result.errorMessage !== undefined
          ? { errorMessage: result.errorMessage?.slice(0, 2000) ?? null }
          : {}),
      },
    });
    return updated.count === 1;
  }

  /**
   * Trả sự kiện về hàng đợi mà KHÔNG tính là một lần thử (chưa gọi Telegram) — dùng khi chat của
   * tổ chức đang bị Telegram giới hạn tần suất.
   */
  async release(id: string, lockToken: string, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.prisma.notificationEvent.updateMany({
      where: { id, lockToken, status: NotificationEventStatus.PROCESSING },
      data: {
        status: NotificationEventStatus.PENDING,
        lockToken: null,
        lockedUntil: null,
        nextAttemptAt,
        lastErrorCode: NOTIFICATION_ERROR_CODES.RATE_LIMITED,
        errorMessage: reason.slice(0, 2000),
      },
    });
  }

  list(
    organizationId: string,
    filter: { status?: NotificationEventStatus; eventType?: NotificationEventType },
    page: number,
    limit: number,
  ): Promise<[NotificationEvent[], number]> {
    const where: Prisma.NotificationEventWhereInput = {
      organizationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.notificationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notificationEvent.count({ where }),
    ]);
  }

  /**
   * Đưa sự kiện lỗi / bị bỏ qua về hàng đợi (người dùng bấm "Gửi lại"). Điều kiện trạng thái nằm
   * TRONG câu UPDATE và lọc theo `organization_id`: bấm hai lần chỉ xếp hàng một lần, và không
   * chạm được sự kiện của tổ chức khác.
   */
  async requeue(organizationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.notificationEvent.updateMany({
      where: { id, organizationId, status: { in: [...REQUEUEABLE_NOTIFICATION_STATUSES] } },
      data: {
        status: NotificationEventStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lockToken: null,
        lockedUntil: null,
      },
    });
    return result.count === 1;
  }

  /** "Gửi lại tất cả lỗi" của MỘT tổ chức (sau khi sửa token / Chat ID). */
  async requeueAllFailed(organizationId: string): Promise<number> {
    const result = await this.prisma.notificationEvent.updateMany({
      where: { organizationId, status: NotificationEventStatus.FAILED },
      data: {
        status: NotificationEventStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lockToken: null,
        lockedUntil: null,
      },
    });
    return result.count;
  }

  findStatus(organizationId: string, id: string): Promise<{ status: NotificationEventStatus } | null> {
    return this.prisma.notificationEvent.findFirst({
      where: { id, organizationId },
      select: { status: true },
    });
  }
}
