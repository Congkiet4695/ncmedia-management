/**
 * Kiểm thử "Latest Sync Status" trên DATABASE THẬT (pod_shop_sync_statuses).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-shop-sync-status.manual.ts
 * Không cần backend chạy. Tự tạo 2 tổ chức tạm (mỗi tổ chức 1 account, 2 shop) và tự dọn ở cuối.
 *
 * 🔴 Unit test mock repository nên KHÔNG chứng minh được điều quan trọng nhất: mỗi
 * (organization_id, shop_id, sync_type) chỉ có MỘT dòng kể cả khi cron và "Sync Now" chạy CÙNG LÚC.
 * Chỉ PostgreSQL thật (UNIQUE index + INSERT … ON CONFLICT) mới chứng minh được.
 */
import { PodShopSyncType, PodSyncStatus, PodSyncTrigger, PrismaClient } from '@prisma/client';
import { PodShopSyncStatusRepository } from '../../src/modules/pod-tiktok/repositories/pod-shop-sync-status.repository';
import { PodShopSyncStatusService } from '../../src/modules/pod-tiktok/services/pod-shop-sync-status.service';
import { PodAccessScopeService } from '../../src/modules/pod-tiktok/services/pod-access-scope.service';

const STAMP = Date.now();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
  }
}

const RESULT_OK = {
  status: PodSyncStatus.SUCCESS,
  totalCount: 10,
  createdCount: 4,
  updatedCount: 3,
  skippedCount: 3,
  failedCount: 0,
};

async function main() {
  const prisma = new PrismaClient();
  const repo = new PodShopSyncStatusRepository(prisma as never);
  const accessScope = new PodAccessScopeService(prisma as never);
  const service = new PodShopSyncStatusService(repo, accessScope);

  const orgIds: string[] = [];
  try {
    async function makeOrg(tag: string) {
      const org = await prisma.organization.create({
        data: { name: `SyncStatus ${tag} ${STAMP}`, slug: `sync-status-${tag}-${STAMP}` },
        select: { id: true },
      });
      orgIds.push(org.id);
      const account = await prisma.podTiktokAccount.create({
        data: {
          organizationId: org.id,
          accountName: `SyncStatus Account ${tag}`,
          openId: `sync-status-${tag}-${STAMP}`,
          userType: 0,
          accessTokenEnc: 'e2e',
          accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
          refreshTokenEnc: 'e2e',
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      const shops: string[] = [];
      for (const n of [1, 2]) {
        const shop = await prisma.podTiktokShop.create({
          data: {
            organizationId: org.id,
            accountId: account.id,
            tiktokShopId: `sync-status-${tag}-${n}-${STAMP}`,
            shopCipherEnc: 'e2e',
            name: `SyncStatus Shop ${tag}${n}`,
            region: 'US',
            sellerType: 'CROSS_BORDER',
          },
          select: { id: true },
        });
        shops.push(shop.id);
      }
      return { orgId: org.id, accountId: account.id, shops };
    }

    const A = await makeOrg('a');
    const B = await makeOrg('b');
    const rows = (orgId: string, shopId?: string, syncType?: PodShopSyncType) =>
      prisma.podShopSyncStatus.findMany({
        where: { organizationId: orgId, ...(shopId ? { shopId } : {}), ...(syncType ? { syncType } : {}) },
      });
    const key = (o: typeof A, shopId: string, syncType: PodShopSyncType, trigger: PodSyncTrigger) => ({
      organizationId: o.orgId,
      accountId: o.accountId,
      shopId,
      syncType,
      trigger,
      startedAt: new Date(),
    });

    console.log('\n1. Lần đầu INSERT, lần sau UPDATE (không thêm dòng)');
    const r1 = await repo.start(key(A, A.shops[0], 'ORDER', 'CRON'));
    let list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('lần đầu ⇒ 1 dòng RUNNING', list.length === 1 && list[0].status === 'RUNNING', list);
    const firstId = list[0].id;
    await repo.finish(r1, RESULT_OK);
    for (let i = 0; i < 5; i++) {
      const r = await repo.start(key(A, A.shops[0], 'ORDER', 'CRON'));
      await repo.finish(r, RESULT_OK);
    }
    list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('cron chạy lặp 6 lần ⇒ vẫn đúng 1 dòng', list.length === 1, list.length);
    check('UPDATE đúng dòng cũ (id không đổi)', list[0].id === firstId);
    check('SUCCESS + số đếm + finished_at + duration', list[0].status === 'SUCCESS' && list[0].totalCount === 10 && list[0].createdCount === 4 && list[0].finishedAt !== null && list[0].durationMs !== null, list[0]);

    console.log('\n2. Sync Now (MANUAL) UPDATE cùng dòng');
    const rm = await repo.start({ ...key(A, A.shops[0], 'ORDER', 'MANUAL'), triggeredBy: null });
    list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('MANUAL ⇒ vẫn 1 dòng, trigger = MANUAL, đang RUNNING, số đếm reset', list.length === 1 && list[0].trigger === 'MANUAL' && list[0].status === 'RUNNING' && list[0].totalCount === 0 && list[0].finishedAt === null, list[0]);
    await repo.finish(rm, { ...RESULT_OK, status: PodSyncStatus.FAILED, errorCode: 'TIMEOUT', errorMessage: 'Request timeout' });
    list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('FAILED ⇒ lưu error_code + error_message', list[0].status === 'FAILED' && list[0].errorCode === 'TIMEOUT' && list[0].errorMessage === 'Request timeout', list[0]);

    console.log('\n3. FAILED → SUCCESS xoá lỗi cũ');
    const rs = await repo.start(key(A, A.shops[0], 'ORDER', 'CRON'));
    list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('bắt đầu lượt mới ⇒ lỗi cũ đã xoá ngay khi RUNNING', list[0].errorCode === null && list[0].errorMessage === null, list[0]);
    await repo.finish(rs, RESULT_OK);
    list = await rows(A.orgId, A.shops[0], 'ORDER');
    check('SUCCESS ⇒ error_code/error_message = NULL', list[0].status === 'SUCCESS' && list[0].errorCode === null && list[0].errorMessage === null, list[0]);

    console.log('\n4. ĐỒNG THỜI: cron + Sync Now + nhiều worker cùng shop');
    // Khoá CHƯA có dòng nào ⇒ đây là ca dễ sinh trùng nhất (hai bên cùng "chưa thấy ⇒ INSERT").
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        repo.start(key(A, A.shops[1], 'ORDER', i % 2 === 0 ? 'CRON' : 'MANUAL')),
      ),
    );
    list = await rows(A.orgId, A.shops[1], 'ORDER');
    check('20 lượt start đồng thời (dòng chưa tồn tại) ⇒ đúng 1 dòng', list.length === 1, list.length);
    const winner = list[0].runId;
    check('run_id của dòng là của MỘT trong các lượt', concurrent.some((r) => r.runId === winner));
    const finishes = await Promise.all(concurrent.map((r) => repo.finish(r, RESULT_OK)));
    check('🔴 fencing: chỉ lượt đang sở hữu dòng ghi được kết quả', finishes.filter(Boolean).length === 1, finishes.filter(Boolean).length);
    list = await rows(A.orgId, A.shops[1], 'ORDER');
    check('sau khi tất cả kết thúc ⇒ vẫn 1 dòng, SUCCESS', list.length === 1 && list[0].status === 'SUCCESS');

    console.log('\n5. Fencing: lượt CŨ kết thúc muộn không ghi đè lượt MỚI');
    const old = await repo.start(key(A, A.shops[1], 'ORDER', 'CRON'));
    const newer = await repo.start(key(A, A.shops[1], 'ORDER', 'MANUAL'));
    const oldWrote = await repo.finish(old, { ...RESULT_OK, status: PodSyncStatus.FAILED, errorMessage: 'stale' });
    list = await rows(A.orgId, A.shops[1], 'ORDER');
    check('lượt cũ finish ⇒ bị từ chối, dòng vẫn RUNNING của lượt mới', !oldWrote && list[0].status === 'RUNNING' && list[0].runId === newer.runId, list[0]);
    await repo.finish(newer, RESULT_OK);

    console.log('\n6. ORDER và PRODUCT là hai dòng riêng');
    const rp = await repo.start(key(A, A.shops[0], 'PRODUCT', 'CRON'));
    await repo.finish(rp, { ...RESULT_OK, totalCount: 99 });
    const orderRow = await rows(A.orgId, A.shops[0], 'ORDER');
    const productRow = await rows(A.orgId, A.shops[0], 'PRODUCT');
    check('mỗi loại 1 dòng', orderRow.length === 1 && productRow.length === 1);
    check('PRODUCT không đè số liệu ORDER', orderRow[0].totalCount === 10 && productRow[0].totalCount === 99);

    console.log('\n7. Nhiều tổ chức / nhiều shop độc lập');
    const rb = await repo.start(key(B, B.shops[0], 'ORDER', 'CRON'));
    await repo.finish(rb, { ...RESULT_OK, status: PodSyncStatus.PARTIAL, failedCount: 2 });
    check('tổ chức A: 3 dòng (shop1 ORDER, shop1 PRODUCT, shop2 ORDER)', (await rows(A.orgId)).length === 3);
    check('tổ chức B: 1 dòng PARTIAL', (await rows(B.orgId)).length === 1 && (await rows(B.orgId))[0].status === 'PARTIAL');
    check('A vẫn SUCCESS (B không ảnh hưởng)', (await rows(A.orgId, A.shops[0], 'ORDER'))[0].status === 'SUCCESS');

    console.log('\n8. API service — phạm vi Admin / Seller, cô lập tổ chức');
    const all = { allShops: true, accountIds: [], shopIds: [] } as never;
    const adminA = await service.findLatest(A.orgId, 'ORDER', all);
    check('Admin A thấy 2 shop (ORDER) của A', adminA.items.length === 2 && adminA.items.every((i) => A.shops.includes(i.shopId)), adminA.items.map((i) => i.shopName));
    check('Admin A KHÔNG thấy shop của B', !adminA.items.some((i) => B.shops.includes(i.shopId)));
    check('kèm tên shop + account', adminA.items.every((i) => i.shopName && i.accountName));
    const sellerScope = { allShops: false, accountIds: [A.accountId], shopIds: [A.shops[0]] } as never;
    const sellerA = await service.findLatest(A.orgId, 'ORDER', sellerScope);
    check('Seller chỉ thấy shop được gán', sellerA.items.length === 1 && sellerA.items[0].shopId === A.shops[0], sellerA.items);
    let forbidden = false;
    try {
      await service.findLatest(A.orgId, 'ORDER', sellerScope, A.shops[1]);
    } catch (error) {
      forbidden = (error as { getStatus?: () => number }).getStatus?.() === 403;
    }
    check('Seller lọc shop ngoài phạm vi ⇒ 403', forbidden);
    const crossOrg = await service.findLatest(B.orgId, 'ORDER', all, A.shops[0]);
    check('Tổ chức B truyền shopId của A ⇒ rỗng', crossOrg.items.length === 0);
    const products = await service.findLatest(A.orgId, 'PRODUCT', all);
    check('endpoint PRODUCT chỉ trả dòng PRODUCT', products.items.length === 1 && products.items[0].syncType === 'PRODUCT');

    console.log('\n9. Lượt kẹt RUNNING ⇒ FAILED (STALE); isRunning');
    const stuck = await repo.start({ ...key(B, B.shops[1], 'ORDER', 'CRON'), startedAt: new Date(Date.now() - 3_600_000) });
    check('isRunning = true khi đang RUNNING', await repo.isRunning(B.orgId, B.shops[1], 'ORDER'));
    await repo.failStaleRuns('ORDER', new Date(Date.now() - 600_000));
    const staleRow = (await rows(B.orgId, B.shops[1], 'ORDER'))[0];
    check('STALE ⇒ FAILED, isRunning = false', staleRow.status === 'FAILED' && staleRow.errorCode === 'STALE' && !(await repo.isRunning(B.orgId, B.shops[1], 'ORDER')), staleRow);
    void stuck;

    console.log('\n10. Ràng buộc UNIQUE ở tầng DB');
    let uniqueViolation = false;
    try {
      const existing = (await rows(A.orgId, A.shops[0], 'ORDER'))[0];
      await prisma.podShopSyncStatus.create({
        data: { organizationId: A.orgId, accountId: A.accountId, shopId: A.shops[0], syncType: 'ORDER', runId: existing.runId, trigger: 'CRON', startedAt: new Date() },
      });
    } catch (error) {
      uniqueViolation = (error as { code?: string }).code === 'P2002';
    }
    check('INSERT trùng khoá thẳng vào bảng ⇒ bị UNIQUE chặn (P2002)', uniqueViolation);
  } finally {
    // Dọn: xoá shop/account (CASCADE dòng trạng thái) rồi tổ chức.
    await prisma.podShopSyncStatus.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.podTiktokShop.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.podTiktokAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  }

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('LỖI:', (error as Error).message);
  process.exit(1);
});
