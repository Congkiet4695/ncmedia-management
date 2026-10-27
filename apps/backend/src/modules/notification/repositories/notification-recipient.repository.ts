import { Injectable } from '@nestjs/common';
import { NotificationEventType, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  NOTIFICATION_ALL_SHOPS_PERMISSION,
  NOTIFICATION_READ_PERMISSION,
  NOTIFICATION_SELF_PERMISSION,
} from '../types/notification-owner';

/**
 * NotificationRecipientRepository — trả lời đúng MỘT câu hỏi: "trong số các kênh CÁ NHÂN này, ai được phép
 * nhận tin về đơn của TikTok Account này, NGAY BÂY GIỜ?".
 *
 * Được hỏi ở CẢ HAI đầu: lúc ghi sự kiện (chọn người nhận) và lúc worker gửi (phân công có thể đã đổi
 * trong lúc sự kiện nằm trong hàng đợi — shop chuyển từ A sang B thì tin còn chờ của A bị bỏ qua).
 *
 * Điều kiện, đọc từ DB — không bao giờ từ request:
 *  - người dùng thuộc tổ chức, chưa xoá, đang ACTIVE;
 *  - role (động — ADR-009) còn quyền `notification.self` VÀ quyền đọc dữ liệu của loại tin đó;
 *  - TikTok Account của đơn đang được gán cho người đó (`pod_tiktok_accounts.seller_id` → Employee → User),
 *    HOẶC role có `pod.shop.all` — CÙNG luật với `PodAccessScopeService` (màn Orders thấy gì thì tin nhắn
 *    gửi đúng phạm vi đó). Đọc thẳng bảng thay vì gọi service đó để không tạo vòng phụ thuộc
 *    POD → Notification → POD.
 *
 * Không có `accountId` (dữ liệu cũ) ⇒ không ai trong kênh cá nhân được nhận: mặc định là TỪ CHỐI.
 */
@Injectable()
export class NotificationRecipientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async allowedUserIds(
    params: {
      organizationId: string;
      eventType: NotificationEventType;
      accountId: string | null;
      userIds: string[];
    },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Set<string>> {
    const { organizationId, eventType, accountId, userIds } = params;
    if (!accountId || userIds.length === 0) return new Set();

    const grants = (code: string): Prisma.RoleWhereInput => ({
      rolePermissions: { some: { deletedAt: null, permission: { code } } },
    });

    const rows = await client.user.findMany({
      where: {
        id: { in: userIds },
        organizationId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        role: {
          organizationId,
          deletedAt: null,
          AND: [grants(NOTIFICATION_SELF_PERMISSION), grants(NOTIFICATION_READ_PERMISSION[eventType])],
        },
        OR: [
          { role: grants(NOTIFICATION_ALL_SHOPS_PERMISSION) },
          {
            employee: {
              organizationId,
              podTiktokAccounts: { some: { id: accountId, organizationId, deletedAt: null } },
            },
          },
        ],
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}
