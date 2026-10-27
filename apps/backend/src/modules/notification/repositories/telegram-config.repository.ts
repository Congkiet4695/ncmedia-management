import { Injectable } from '@nestjs/common';
import { OrganizationTelegramConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ORGANIZATION_OWNER_KEY,
  ownerKeyOf,
  type NotificationOwner,
} from '../types/notification-owner';

/** Kết quả một lần gửi — nguồn của trạng thái Connected / Disconnected. */
export interface DeliveryOutcome {
  ok: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  botUsername?: string | null;
}

/**
 * Data access cho `organization_telegram_configs`.
 *
 * 🔴 MỌI truy vấn nhận CHỦ SỞ HỮU (`organizationId` + `userId` | null — ADR-004): không có đường nào đọc
 * cấu hình theo id trần, và kênh cá nhân của người này không bao giờ đọc / ghi được kênh của người khác.
 * Mỗi chủ sở hữu tối đa MỘT dòng (UNIQUE organization_id + owner_key), kể cả dòng đã xoá mềm (được hồi
 * sinh khi cấu hình lại).
 */
@Injectable()
export class TelegramConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOwner(owner: NotificationOwner): Promise<OrganizationTelegramConfig | null> {
    return this.prisma.organizationTelegramConfig.findFirst({
      where: { organizationId: owner.organizationId, ownerKey: ownerKeyOf(owner), deletedAt: null },
    });
  }

  /**
   * Chủ sở hữu đang BẬT Telegram không. Chạy được trong transaction của bên gọi (tạo đơn) — một truy
   * vấn theo khoá UNIQUE, chỉ thực hiện khi thực sự có đơn mới.
   */
  async isEnabled(
    owner: NotificationOwner,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const row = await client.organizationTelegramConfig.findFirst({
      where: { organizationId: owner.organizationId, ownerKey: ownerKeyOf(owner), deletedAt: null, enabled: true },
      select: { id: true },
    });
    return row !== null;
  }

  /** Người dùng có kênh CÁ NHÂN đang bật trong tổ chức (ứng viên người nhận — còn phải qua kiểm phạm vi). */
  async enabledPersonalUserIds(
    organizationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<string[]> {
    const rows = await client.organizationTelegramConfig.findMany({
      where: {
        organizationId,
        ownerKey: { not: ORGANIZATION_OWNER_KEY },
        userId: { not: null },
        deletedAt: null,
        enabled: true,
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId as string);
  }

  /** Tên tổ chức để ghi vào cuối tin nhắn (bảng lõi Organization — không phải dữ liệu module khác). */
  async findOrganizationName(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { name: true },
    });
    return org?.name ?? null;
  }

  /**
   * Cấu hình lần đầu (CÓ token). Dòng đã xoá mềm trước đó (UNIQUE organization_id + owner_key) được hồi
   * sinh và ghi đè toàn bộ — kể cả kết quả gửi cũ.
   */
  create(
    owner: NotificationOwner,
    actorUserId: string,
    data: { botTokenEnc: string; botTokenHint: string; chatId: string; enabled: boolean },
  ): Promise<OrganizationTelegramConfig> {
    const fresh = {
      ...data,
      botUsername: null,
      lastDeliveryOk: null,
      lastDeliveryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    const ownerKey = ownerKeyOf(owner);
    return this.prisma.organizationTelegramConfig.upsert({
      where: { organizationId_ownerKey: { organizationId: owner.organizationId, ownerKey } },
      create: {
        ...fresh,
        organizationId: owner.organizationId,
        ownerKey,
        userId: owner.userId,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      update: { ...fresh, deletedAt: null, updatedBy: actorUserId },
    });
  }

  /** Cập nhật cấu hình ĐANG có (không đụng token nếu `data` không mang token). */
  async update(
    owner: NotificationOwner,
    actorUserId: string,
    data: Prisma.OrganizationTelegramConfigUncheckedUpdateManyInput,
  ): Promise<OrganizationTelegramConfig | null> {
    await this.prisma.organizationTelegramConfig.updateMany({
      where: { organizationId: owner.organizationId, ownerKey: ownerKeyOf(owner), deletedAt: null },
      data: { ...data, updatedBy: actorUserId },
    });
    return this.findByOwner(owner);
  }

  async softDelete(owner: NotificationOwner, actorUserId: string): Promise<boolean> {
    const result = await this.prisma.organizationTelegramConfig.updateMany({
      where: { organizationId: owner.organizationId, ownerKey: ownerKeyOf(owner), deletedAt: null },
      data: { deletedAt: new Date(), enabled: false, updatedBy: actorUserId },
    });
    return result.count > 0;
  }

  /**
   * Ghi kết quả gửi gần nhất.
   *
   * 🔴 Chỉ ghi khi cấu hình VẪN LÀ cấu hình đã dùng để gửi (cùng token mã hoá + Chat ID): đổi token trong
   * lúc worker đang gửi thì kết quả của token cũ không được gắn nhầm cho token mới.
   */
  async recordDelivery(
    owner: NotificationOwner,
    snapshot: { botTokenEnc: string; chatId: string },
    outcome: DeliveryOutcome,
  ): Promise<void> {
    await this.prisma.organizationTelegramConfig.updateMany({
      where: {
        organizationId: owner.organizationId,
        ownerKey: ownerKeyOf(owner),
        deletedAt: null,
        botTokenEnc: snapshot.botTokenEnc,
        chatId: snapshot.chatId,
      },
      data: {
        lastDeliveryOk: outcome.ok,
        lastDeliveryAt: new Date(),
        lastErrorCode: outcome.ok ? null : (outcome.errorCode ?? null),
        lastErrorMessage: outcome.ok ? null : (outcome.errorMessage?.slice(0, 1000) ?? null),
        ...(outcome.botUsername ? { botUsername: outcome.botUsername } : {}),
      },
    });
  }
}
