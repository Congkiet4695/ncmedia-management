import { PodListingSessionStatus } from '@prisma/client';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { PodListingSessionDeletionService } from './pod-listing-session-deletion.service';

/**
 * Xoá cứng Auto Listing (Listing Session). Luật được khoá:
 *  - Chỉ lượt của tổ chức hiện tại; MỌI shop của lượt phải trong phạm vi người dùng (Employee không xoá
 *    được lượt có shop của đồng nghiệp).
 *  - Lượt LISTING, hoặc còn job / item / publish dở dang ⇒ TỪ CHỐI (không xoá dưới chân worker).
 *  - Start Listing đang giữ khoá của lượt ⇒ BẬN.
 *  - Xoá = DELETE pod_listing_sessions (CASCADE xuống dữ liệu con) — không đụng template / file / shop.
 */

type Row = { id: string; status: PodListingSessionStatus; shopIds: string[] };

const ORG = 'org-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

function build(rows: Row[], opts: { activeWork?: string[]; busyLocks?: string[] } = {}) {
  const tx = {
    $queryRaw: jest.fn((sql: { sql: string; values: unknown[] }) => {
      if (sql.sql.includes('set_config')) return Promise.resolve([{}]);
      const ids = sql.values[0] as string[];
      if (sql.sql.includes('FROM pod_listing_sessions')) {
        return Promise.resolve(
          rows
            .filter((row) => ids.includes(row.id))
            .map((row) => ({ id: row.id, status: row.status })),
        );
      }
      // Truy vấn "việc nền dở dang".
      return Promise.resolve(
        (opts.activeWork ?? [])
          .filter((id) => ids.includes(id))
          .map((session_id) => ({ session_id })),
      );
    }),
    podListingSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    podListingSession: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          rows
            .filter((row) => where.id.in.includes(row.id))
            .map((row) => ({
              id: row.id,
              status: row.status,
              shops: row.shopIds.map((shopId) => ({ shopId })),
            })),
        ),
      ),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const locks = {
    acquire: jest.fn((key: string) =>
      Promise.resolve(
        (opts.busyLocks ?? []).some((busy) => key.endsWith(busy)) ? null : { key, fenceToken: 'f' },
      ),
    ),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PodListingSessionDeletionService(
    prisma as never,
    new PodAccessScopeService(prisma as never),
    locks as never,
  );
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return { service, prisma, tx, locks };
}

describe('PodListingSessionDeletionService', () => {
  it('xoá NHIỀU: DELETE đúng các lượt hợp lệ trong MỘT transaction, giữ khoá Start Listing trong lúc xoá', async () => {
    const { service, tx, locks } = build([
      { id: 's-1', status: PodListingSessionStatus.COMPLETED, shopIds: ['shop-1'] },
      { id: 's-2', status: PodListingSessionStatus.DRAFT, shopIds: ['shop-2'] },
    ]);
    const result = await service.removeMany(ORG, 'user-1', ['s-1', 's-2', 's-2'], ADMIN);
    expect(result).toEqual({ requested: 2, deleted: ['s-1', 's-2'], failed: [] });
    expect(tx.podListingSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1', 's-2'] }, organizationId: ORG },
    });
    expect(locks.acquire).toHaveBeenCalledWith('pod:session-start:s-1', expect.any(Number));
    expect(locks.release).toHaveBeenCalledTimes(2);
  });

  it('🔴 lượt có MỘT shop ngoài phạm vi Employee ⇒ POD_SHOP_FORBIDDEN', async () => {
    const { service, tx } = build([
      { id: 's-mine', status: PodListingSessionStatus.DRAFT, shopIds: ['shop-1'] },
      { id: 's-mixed', status: PodListingSessionStatus.DRAFT, shopIds: ['shop-1', 'shop-9'] },
    ]);
    const result = await service.removeMany(ORG, 'seller-1', ['s-mine', 's-mixed'], SELLER);
    expect(result.deleted).toEqual(['s-mine']);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 's-mixed', code: 'POD_SHOP_FORBIDDEN' }),
    ]);
    expect(tx.podListingSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-mine'] }, organizationId: ORG },
    });
  });

  it('🔴 không tồn tại / tổ chức khác ⇒ NOT_FOUND; danh sách được lọc theo organizationId', async () => {
    const { service, prisma } = build([]);
    const result = await service.removeMany(ORG, 'user-1', ['x'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ code: 'POD_LISTING_SESSION_NOT_FOUND' }),
    ]);
    expect(prisma.podListingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['x'] }, organizationId: ORG, deletedAt: null },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 lượt đang LISTING ⇒ POD_SESSION_IN_PROGRESS', async () => {
    const { service, prisma } = build([
      { id: 's-1', status: PodListingSessionStatus.LISTING, shopIds: [] },
    ]);
    const result = await service.removeMany(ORG, 'user-1', ['s-1'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 's-1', code: 'POD_SESSION_IN_PROGRESS' }),
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 còn job / item / publish dở dang (kiểm TRONG transaction) ⇒ từ chối, không DELETE', async () => {
    const { service, tx } = build(
      [{ id: 's-1', status: PodListingSessionStatus.COMPLETED, shopIds: [] }],
      {
        activeWork: ['s-1'],
      },
    );
    const result = await service.removeMany(ORG, 'user-1', ['s-1'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 's-1', code: 'POD_SESSION_IN_PROGRESS' }),
    ]);
    expect(tx.podListingSession.deleteMany).not.toHaveBeenCalled();
  });

  it('🔴 Start Listing đang giữ khoá của lượt ⇒ BẬN, không xoá', async () => {
    const { service, tx } = build(
      [{ id: 's-1', status: PodListingSessionStatus.READY, shopIds: [] }],
      {
        busyLocks: ['session-start:s-1'],
      },
    );
    const result = await service.removeMany(ORG, 'user-1', ['s-1'], ADMIN);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 's-1', code: 'POD_SESSION_IN_PROGRESS' }),
    ]);
    expect(tx.podListingSession.deleteMany).not.toHaveBeenCalled();
  });

  it('xoá TỪNG lượt: ném đúng exception (404 / 400)', async () => {
    const { service } = build([
      { id: 's-run', status: PodListingSessionStatus.LISTING, shopIds: [] },
    ]);
    await expect(service.remove(ORG, 'user-1', 'missing', ADMIN)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove(ORG, 'user-1', 's-run', ADMIN)).rejects.toMatchObject({
      status: 400,
    });
  });
});
