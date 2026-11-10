import type { PrismaService } from '../../../database/prisma.service';
import type { OrganizationAccessState } from './organization-access';

/**
 * Bộ nhớ đệm NGẮN cho trạng thái truy cập của Organization — để `JwtAuthGuard` kiểm "tổ chức còn được dùng
 * không" ở MỌI request mà không thêm một truy vấn DB cho mỗi lượt gọi API.
 *
 * 🔴 Vì sao cần ở mỗi request: Access Token là JWT không trạng thái, sống tới 15 phút. Không kiểm lại thì một
 * tổ chức vừa bị vô hiệu hoá / vừa hết hạn vẫn gọi được MỌI API cho tới khi token hết hạn.
 *
 * Độ trễ tối đa của một thay đổi = `TTL_MS`. Thay đổi do Super Admin trên CÙNG tiến trình có hiệu lực ngay
 * (`invalidateOrganizationAccess`); tiến trình khác (nếu chạy nhiều bản) theo kịp sau tối đa `TTL_MS`. Hết hạn
 * theo thời gian không cần xoá đệm: `expiresAt` được so với `now` ở mỗi request.
 */
const TTL_MS = 30_000;
/** Chặn bộ đệm phình vô hạn (số tổ chức thực tế nhỏ hơn rất nhiều). */
const MAX_ENTRIES = 10_000;

interface Entry {
  state: OrganizationAccessState | null;
  at: number;
}

const entries = new Map<string, Entry>();

/** Trạng thái truy cập của tổ chức — từ đệm nếu còn mới, không thì đọc DB. `null` = tổ chức không tồn tại. */
export async function getOrganizationAccessState(
  prisma: Pick<PrismaService, 'organization'>,
  organizationId: string,
  now: number = Date.now(),
): Promise<OrganizationAccessState | null> {
  const cached = entries.get(organizationId);
  if (cached && now - cached.at < TTL_MS) return cached.state;

  const state = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true, expiresAt: true, isPlatform: true },
  });
  if (entries.size >= MAX_ENTRIES) entries.clear();
  entries.set(organizationId, { state, at: now });
  return state;
}

/** Bỏ đệm của một tổ chức — gọi ngay sau khi Super Admin đổi trạng thái / hạn / xoá tổ chức. */
export function invalidateOrganizationAccess(organizationId: string): void {
  entries.delete(organizationId);
}

/** Chỉ dùng trong kiểm thử. */
export function clearOrganizationAccessCache(): void {
  entries.clear();
}
