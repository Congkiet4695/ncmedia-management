import { Prisma } from '@prisma/client';

/**
 * GÓI SỬ DỤNG của Organization — giới hạn Shop + thời hạn (docs/organization-lifecycle.md).
 *
 * Một nơi cho: giá trị mặc định khi duyệt, định nghĩa "Shop đang kết nối", và phép đếm theo lô. Dùng chung
 * bởi `/auth/me` (header), Super Admin (danh sách tổ chức) và luồng kết nối TikTok (chặn vượt giới hạn) —
 * ba nơi phải đếm GIỐNG HỆT nhau, nếu không header nói "9 / 10" mà kết nối lại bị từ chối.
 */

/** Số Shop tối đa khi Organization được duyệt LẦN ĐẦU. */
export const ORGANIZATION_DEFAULT_SHOP_LIMIT = 10;
/** Thời hạn mặc định khi duyệt LẦN ĐẦU — tính từ ngày ĐĂNG KÝ (`created_at`), KHÔNG phải ngày duyệt. */
export const ORGANIZATION_DEFAULT_TERM_DAYS = 30;
/** Trần nhập tay của Super Admin — chặn gõ nhầm thêm vài số 0, không phải luật nghiệp vụ. */
export const ORGANIZATION_MAX_SHOP_LIMIT = 100_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hết hạn khi `now >= expires_at` (so theo epoch với cột `timestamptz` — cùng quy ước toàn backend, không có
 * logic múi giờ riêng). NULL = không hết hạn.
 */
export function isOrganizationExpiredAt(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return expiresAt != null && now.getTime() >= expiresAt.getTime();
}

/** Ngày hết hạn mặc định = ngày đăng ký + 30 ngày. */
export function defaultExpiresAt(registeredAt: Date): Date {
  return new Date(registeredAt.getTime() + ORGANIZATION_DEFAULT_TERM_DAYS * DAY_MS);
}

/**
 * "Shop ĐANG KẾT NỐI" = shop TikTok đã liên kết và chưa gỡ: `pod_tiktok_shops.deleted_at IS NULL` VÀ kết nối
 * TikTok của nó `pod_tiktok_accounts.deleted_at IS NULL`.
 *
 * Gỡ liên kết (unlink) xoá mềm cả kết nối lẫn shop ⇒ giải phóng chỗ ngay. Trạng thái phía TikTok của shop
 * (ACTIVE / INACTIVE / DEAUTHORIZED) KHÔNG làm thay đổi phép đếm: nó do Shop Sync tự đổi theo TikTok, không qua
 * thao tác của người dùng — đếm theo nó thì tổng có thể vượt giới hạn mà không có điểm nào để chặn. Shop còn
 * nằm trong danh sách của tổ chức (dù tạm ngưng) vẫn chiếm một chỗ cho tới khi được gỡ.
 */
export const CONNECTED_SHOP_SQL = Prisma.sql`
  s.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM pod_tiktok_accounts a WHERE a.id = s.account_id AND a.deleted_at IS NULL)`;

/**
 * Một thao tác kết nối có làm VƯỢT giới hạn Shop không.
 *
 * Chỉ chặn khi thao tác làm TĂNG số Shop đang kết nối VÀ kết quả vượt giới hạn. Uỷ quyền lại một kết nối cũ
 * (không thêm shop) luôn được, kể cả khi tổ chức đang dùng nhiều hơn giới hạn — ví dụ Super Admin vừa hạ giới
 * hạn từ 20 xuống 10 khi tổ chức có 15 shop: họ vẫn làm mới token được, chỉ không thêm được shop mới.
 * `limit = null` ⇒ không giới hạn.
 */
export function exceedsShopLimit(input: {
  before: number;
  after: number;
  limit: number | null;
}): boolean {
  return input.limit !== null && input.after > input.before && input.after > input.limit;
}

/** Client đủ để chạy truy vấn thô — PrismaService hoặc transaction. */
type RawClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Số Shop đang kết nối của MỘT tổ chức. */
export async function countConnectedShops(
  client: RawClient,
  organizationId: string,
): Promise<number> {
  const [row] = await client.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM pod_tiktok_shops s
    WHERE s.organization_id = ${organizationId}::uuid AND ${CONNECTED_SHOP_SQL}`;
  return Number(row?.n ?? 0);
}

/** Số Shop đang kết nối của NHIỀU tổ chức trong MỘT truy vấn (không N+1). Tổ chức không có shop ⇒ 0. */
export async function countConnectedShopsByOrganization(
  client: RawClient,
  organizationIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(organizationIds.map((id) => [id, 0]));
  if (organizationIds.length === 0) return counts;
  const rows = await client.$queryRaw<Array<{ organization_id: string; n: bigint }>>`
    SELECT s.organization_id, COUNT(*) AS n FROM pod_tiktok_shops s
    WHERE s.organization_id = ANY(${organizationIds}::uuid[]) AND ${CONNECTED_SHOP_SQL}
    GROUP BY s.organization_id`;
  for (const row of rows) counts.set(row.organization_id, Number(row.n));
  return counts;
}
