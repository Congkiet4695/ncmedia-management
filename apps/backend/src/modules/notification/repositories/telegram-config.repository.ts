import { Injectable } from '@nestjs/common';
import { OrganizationTelegramConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

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
 * 🔴 MỌI truy vấn nhận `organizationId` (ADR-004) — không có đường nào đọc cấu hình theo id trần.
 * Mỗi tổ chức tối đa MỘT dòng (UNIQUE organization_id), kể cả dòng đã xoá mềm (được hồi sinh khi
 * cấu hình lại).
 */
@Injectable()
export class TelegramConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOrganization(organizationId: string): Promise<OrganizationTelegramConfig | null> {
    return this.prisma.organizationTelegramConfig.findFirst({
      where: { organizationId, deletedAt: null },
    });
  }

  /**
   * Tổ chức đang BẬT Telegram không. Chạy được trong transaction của bên gọi (tạo đơn) — một truy
   * vấn theo khoá UNIQUE, chỉ thực hiện khi thực sự có đơn mới.
   */
  async isEnabled(
    organizationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const row = await client.organizationTelegramConfig.findFirst({
      where: { organizationId, deletedAt: null, enabled: true },
      select: { id: true },
    });
    return row !== null;
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
   * Cấu hình lần đầu (CÓ token). Dòng đã xoá mềm trước đó (UNIQUE organization_id) được hồi sinh
   * và ghi đè toàn bộ — kể cả kết quả gửi cũ.
   */
  create(
    organizationId: string,
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
    return this.prisma.organizationTelegramConfig.upsert({
      where: { organizationId },
      create: { ...fresh, organizationId, createdBy: actorUserId, updatedBy: actorUserId },
      update: { ...fresh, deletedAt: null, updatedBy: actorUserId },
    });
  }

  /** Cập nhật cấu hình ĐANG có (không đụng token nếu `data` không mang token). */
  async update(
    organizationId: string,
    actorUserId: string,
    data: Prisma.OrganizationTelegramConfigUncheckedUpdateManyInput,
  ): Promise<OrganizationTelegramConfig | null> {
    await this.prisma.organizationTelegramConfig.updateMany({
      where: { organizationId, deletedAt: null },
      data: { ...data, updatedBy: actorUserId },
    });
    return this.findByOrganization(organizationId);
  }

  async softDelete(organizationId: string, actorUserId: string): Promise<boolean> {
    const result = await this.prisma.organizationTelegramConfig.updateMany({
      where: { organizationId, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false, updatedBy: actorUserId },
    });
    return result.count > 0;
  }

  /**
   * Ghi kết quả gửi gần nhất.
   *
   * 🔴 Chỉ ghi khi cấu hình VẪN LÀ cấu hình đã dùng để gửi (cùng token mã hoá + Chat ID): admin đổi
   * token trong lúc worker đang gửi thì kết quả của token cũ không được gắn nhầm cho token mới.
   */
  async recordDelivery(
    organizationId: string,
    snapshot: { botTokenEnc: string; chatId: string },
    outcome: DeliveryOutcome,
  ): Promise<void> {
    await this.prisma.organizationTelegramConfig.updateMany({
      where: {
        organizationId,
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
