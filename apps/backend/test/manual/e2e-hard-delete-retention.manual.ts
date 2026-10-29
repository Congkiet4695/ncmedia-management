/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP xoá cứng + retention trên DATABASE THẬT (PostgreSQL) + Redis THẬT.
 *
 * 🔴 CHỈ chạy trên database / Redis CỤC BỘ dùng-xong-bỏ: script TỪ CHỐI chạy nếu DATABASE_URL không trỏ
 * tới 127.0.0.1 / localhost. Không nạp `.env` (file đó có thể trỏ DB dùng chung với production).
 *
 * Chạy (trong apps/backend):
 *   DATABASE_URL=postgresql://ncm_test@127.0.0.1:55432/ncm_test REDIS_PORT=56379 \
 *     node -r ts-node/register test/manual/e2e-hard-delete-retention.manual.ts
 *
 * Kiểm:
 *   · Flash Sale: xoá hàng loạt — item/log đi theo, sản phẩm còn nguyên, RUNNING bị chặn, bia mộ được ghi,
 *     id của tổ chức khác không xoá được.
 *   · Auto Listing: còn job đang chạy ⇒ chặn; xoá xong ⇒ Draft Product / payload / job / item / log biến mất,
 *     template + file + shop còn nguyên.
 *   · Retention: ranh giới ngày (LA), notifications hôm nay giữ / hôm qua xoá / chưa gửi giữ; publish history
 *     và draft 7 ngày; dữ liệu ngoài phạm vi không bị đụng; dry-run không xoá; chạy lại idempotent.
 *   · Xoá Organization: tham chiếu xuyên tenant ⇒ từ chối; bảng lạ có dữ liệu ⇒ từ chối; lỗi giữa chừng ⇒
 *     ROLLBACK sạch; thành công ⇒ mọi bảng có organization_id sạch dữ liệu của tổ chức, tổ chức khác và dữ
 *     liệu dùng chung nguyên vẹn; tổ chức hệ thống không xoá được.
 */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { DistributedLockService } from '../../src/modules/pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../src/modules/pod-tiktok/services/pod-access-scope.service';
import { PodFlashSaleDeletionService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-deletion.service';
import { PodListingSessionDeletionService } from '../../src/modules/pod-listing-session/services/pod-listing-session-deletion.service';
import {
  DataRetentionService,
  type DataRetentionOptions,
} from '../../src/modules/data-retention/services/data-retention.service';
import { retentionCutoff } from '../../src/modules/data-retention/services/data-retention-cutoff';
import { OrganizationDeletionService } from '../../src/modules/super-admin/services/organization-deletion.service';

const DB_URL = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DB_URL)) {
  console.error(
    '❌ Từ chối chạy: DATABASE_URL phải trỏ tới database CỤC BỘ (127.0.0.1 / localhost).',
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}
async function expectCode(name: string, promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    check(name, false, 'không ném lỗi');
  } catch (error) {
    const body = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    check(name, body?.code === code, body ?? (error as Error).message);
  }
}

const prisma = new PrismaService();
const redis = new RedisService(
  new ConfigService({
    redis: { host: '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 56379), password: '' },
  }),
);
const locks = new DistributedLockService(redis);
const scopeService = new PodAccessScopeService(prisma);
const quiet = <T extends object>(service: T): T => {
  const logger = (service as unknown as { logger: Record<string, unknown> }).logger;
  for (const level of ['log', 'warn', 'error']) logger[level] = () => undefined;
  return service;
};
const flashSales = quiet(new PodFlashSaleDeletionService(prisma, scopeService, locks));
const sessions = quiet(new PodListingSessionDeletionService(prisma, scopeService, locks));
const retention = quiet(new DataRetentionService(prisma, locks, new ConfigService({})));
const orgDeletion = quiet(
  new OrganizationDeletionService(prisma, locks, {
    dropCachedSessions: async () => undefined,
  } as never),
);

const ADMIN_SCOPE: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const TZ = 'America/Los_Angeles';
const DAY = 86_400_000;

// ---------------------------------------------------------------- fixture

interface OrgFixture {
  orgId: string;
  slug: string;
  userId: string;
  shopId: string;
  accountId: string;
  productId: string;
  variantId: string;
  storageFileId: string;
  skuTemplateId: string;
  fsEnded: string;
  fsRunning: string;
  fsDraft: string;
  sessionId: string;
  sessionJobId: string;
  sessionPayloadId: string;
}

async function seedOrg(tag: string): Promise<OrgFixture> {
  const suffix = `${tag}-${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `E2E ${suffix}`, slug: `e2e-${suffix}` },
  });
  const role = await prisma.role.create({
    data: { organizationId: org.id, code: 'ADMIN', displayName: 'Admin' },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      roleId: role.id,
      email: `e2e-${suffix}@example.test`,
      passwordHash: 'x',
      fullName: 'E2E',
    },
  });
  await prisma.employee.create({ data: { organizationId: org.id, userId: user.id } });
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: randomUUID() + randomUUID(),
      expiresAt: new Date(Date.now() + DAY),
    },
  });
  const file = await prisma.storageFile.create({
    data: {
      organizationId: org.id,
      module: 'POD_TIKTOK',
      referenceType: 'OTHER',
      folder: 'e2e',
      objectKey: `e2e/${suffix}`,
      originalName: 'a.png',
      storedName: 'a.png',
      extension: 'png',
      mimeType: 'image/png',
      fileSize: 1,
      uploadedBy: user.id,
      uploadedAt: new Date(),
    },
  });
  const account = await prisma.podTiktokAccount.create({
    data: {
      organizationId: org.id,
      accountName: `acc-${suffix}`,
      openId: `open-${suffix}`,
      userType: 0,
      accessTokenEnc: 'x',
      accessTokenExpiresAt: new Date(Date.now() + DAY),
      refreshTokenEnc: 'x',
      refreshTokenExpiresAt: new Date(Date.now() + DAY),
    },
  });
  const shop = await prisma.podTiktokShop.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      tiktokShopId: `shop-${suffix}`,
      shopCipherEnc: 'x',
      name: 'Shop',
      region: 'US',
      sellerType: 'LOCAL',
    },
  });
  const product = await prisma.podProduct.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      shopId: shop.id,
      tiktokProductId: `p-${suffix}`,
      payloadHash: 'h',
    },
  });
  const variant = await prisma.podProductVariant.create({
    data: { organizationId: org.id, productId: product.id, tiktokSkuId: `sku-${suffix}` },
  });

  const fs = async (status: string, providerId: string | null) => {
    const row = await prisma.podFlashSale.create({
      data: {
        organizationId: org.id,
        accountId: account.id,
        shopId: shop.id,
        name: `FS ${status} ${suffix}`,
        status: status as never,
        startAt: new Date(Date.now() - DAY),
        endAt: new Date(Date.now() + DAY),
        providerFlashSaleId: providerId,
      },
    });
    await prisma.podFlashSaleItem.create({
      data: {
        organizationId: org.id,
        flashSaleId: row.id,
        productId: product.id,
        variantId: variant.id,
        originalPrice: 10,
        flashSalePrice: 8,
        discountPercent: 20,
      },
    });
    await prisma.podFlashSaleLog.create({
      data: { organizationId: org.id, flashSaleId: row.id, action: 'SYNC_STATUS', message: 'e2e' },
    });
    return row.id;
  };
  const fsEnded = await fs('ENDED', `act-${suffix}`);
  const fsRunning = await fs('RUNNING', `act2-${suffix}`);
  const fsDraft = await fs('DRAFT', null);

  const skuTemplate = await prisma.podSkuTemplate.create({
    data: { organizationId: org.id, name: `SKU ${suffix}` },
  });
  const platform = await prisma.platform.findFirstOrThrow();
  const session = await prisma.podListingSession.create({
    data: {
      organizationId: org.id,
      platformId: platform.id,
      name: `Session ${suffix}`,
      market: 'US',
      status: 'COMPLETED',
    },
  });
  await prisma.podListingSessionShop.create({
    data: { organizationId: org.id, sessionId: session.id, shopId: shop.id },
  });
  const sessionProduct = await prisma.podListingSessionProduct.create({
    data: { organizationId: org.id, sessionId: session.id, title: 'Draft product' },
  });
  await prisma.podListingSessionProductImage.create({
    data: {
      organizationId: org.id,
      sessionProductId: sessionProduct.id,
      imageUrl: 'https://example.test/a.png',
      fileId: file.id,
    },
  });
  const payload = await prisma.podListingPayload.create({
    data: {
      organizationId: org.id,
      sessionProductId: sessionProduct.id,
      shopId: shop.id,
      accountId: account.id,
      market: 'US',
      payload: {},
      payloadHash: 'h',
    },
  });
  await prisma.podListingPayloadItem.create({
    data: { organizationId: org.id, payloadId: payload.id, variantName: 'v', sellerSku: 's' },
  });
  const job = await prisma.podListingJob.create({
    data: {
      organizationId: org.id,
      name: 'Job',
      market: 'US',
      sessionId: session.id,
      status: 'PROCESSING',
    },
  });
  const item = await prisma.podListingJobItem.create({
    data: {
      organizationId: org.id,
      jobId: job.id,
      sessionProductId: sessionProduct.id,
      shopId: shop.id,
      payloadId: payload.id,
      status: 'SUCCESS',
    },
  });
  await prisma.podListingLog.create({
    data: {
      organizationId: org.id,
      jobId: job.id,
      listingItemId: item.id,
      step: 'CREATE_DRAFT',
      message: 'e2e',
    },
  });

  await prisma.notificationEvent.create({
    data: {
      organizationId: org.id,
      eventType: 'ORDER_CREATED',
      entityType: 'POD_ORDER',
      entityId: randomUUID(),
      payload: {},
      status: 'SENT',
    },
  });
  await prisma.podOrder.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      shopId: shop.id,
      tiktokOrderId: `o-${suffix}`,
      status: 'AWAITING_SHIPMENT',
      tiktokCreateTime: BigInt(1),
      tiktokUpdateTime: BigInt(1),
      orderedAt: new Date(),
      tiktokUpdatedAt: new Date(),
      payloadHash: 'h',
      rawPayload: {},
      syncSource: 'MANUAL',
      lastSyncedAt: new Date(),
      items: {
        create: [{ organizationId: org.id, tiktokLineItemId: `li-${suffix}`, payloadHash: 'h' }],
      },
    },
  });
  await prisma.fulfillmentAccount.create({
    data: { organizationId: org.id, provider: 'MANGO', name: 'Mango' },
  });
  const shopAccount = await prisma.account.create({
    data: { organizationId: org.id, name: 'Shop account' },
  });
  await prisma.order.create({
    data: { organizationId: org.id, accountId: shopAccount.id, orderNumber: `ORD-${suffix}` },
  });

  return {
    orgId: org.id,
    slug: org.slug,
    userId: user.id,
    shopId: shop.id,
    accountId: account.id,
    productId: product.id,
    variantId: variant.id,
    storageFileId: file.id,
    skuTemplateId: skuTemplate.id,
    fsEnded,
    fsRunning,
    fsDraft,
    sessionId: session.id,
    sessionJobId: job.id,
    sessionPayloadId: payload.id,
  };
}

/** Số dòng của tổ chức trong MỌI bảng có cột organization_id. */
async function tenantSnapshot(orgId: string): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'organization_id'`;
  const snapshot: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS n FROM ${Prisma.raw(`"${table_name}"`)} WHERE organization_id = ${orgId}::uuid`,
    );
    if (Number(row.n) > 0) snapshot[table_name] = Number(row.n);
  }
  return snapshot;
}

async function globalCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of [
    'platforms',
    'permissions',
    'pod_product_categories',
    'pod_product_brands',
    'organizations',
  ]) {
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS n FROM ${Prisma.raw(table)}`,
    );
    out[table] = Number(row.n);
  }
  return out;
}

const count = async (sql: Prisma.Sql) =>
  Number((await prisma.$queryRaw<Array<{ n: bigint }>>(sql))[0].n);

// ---------------------------------------------------------------- kịch bản

async function flashSaleScenario(a: OrgFixture, b: OrgFixture): Promise<void> {
  console.log('\n▶ Flash Sale — xoá cứng hàng loạt');
  const result = await flashSales.removeMany(
    a.orgId,
    a.userId,
    [a.fsEnded, a.fsRunning, a.fsDraft, b.fsDraft],
    ADMIN_SCOPE,
  );
  check(
    'xoá đúng đợt ENDED + DRAFT',
    JSON.stringify([...result.deleted].sort()) === JSON.stringify([a.fsEnded, a.fsDraft].sort()),
    result,
  );
  check(
    'RUNNING bị chặn (INVALID_STATE)',
    result.failed.some((f) => f.id === a.fsRunning && f.code === 'POD_FLASH_SALE_INVALID_STATE'),
  );
  check(
    'đợt của tổ chức khác ⇒ NOT_FOUND',
    result.failed.some((f) => f.id === b.fsDraft && f.code === 'POD_FLASH_SALE_NOT_FOUND'),
  );
  check(
    'B vẫn còn đợt sale đó',
    (await prisma.podFlashSale.count({ where: { id: b.fsDraft } })) === 1,
  );
  check(
    'item + log của đợt đã xoá cũng biến mất',
    (await prisma.podFlashSaleItem.count({
      where: { flashSaleId: { in: [a.fsEnded, a.fsDraft] } },
    })) === 0 &&
      (await prisma.podFlashSaleLog.count({
        where: { flashSaleId: { in: [a.fsEnded, a.fsDraft] } },
      })) === 0,
  );
  check(
    'sản phẩm / biến thể KHÔNG bị xoá',
    (await prisma.podProduct.count({ where: { id: a.productId } })) === 1 &&
      (await prisma.podProductVariant.count({ where: { id: a.variantId } })) === 1,
  );
  check(
    'bia mộ được ghi cho đợt đã lên sàn',
    (await prisma.podFlashSaleTombstone.count({ where: { shopId: a.shopId } })) === 1,
  );

  const seller: PodAccessScope = { allShops: false, accountIds: [], shopIds: [] };
  const denied = await flashSales.removeMany(a.orgId, a.userId, [a.fsRunning], seller);
  check(
    'Employee ngoài phạm vi shop ⇒ POD_SHOP_FORBIDDEN',
    denied.failed[0]?.code === 'POD_SHOP_FORBIDDEN',
    denied,
  );
}

async function sessionScenario(a: OrgFixture): Promise<void> {
  console.log('\n▶ Auto Listing — xoá cứng');
  const blocked = await sessions.removeMany(a.orgId, a.userId, [a.sessionId], ADMIN_SCOPE);
  check(
    'job của lượt đang PROCESSING ⇒ từ chối',
    blocked.failed[0]?.code === 'POD_SESSION_IN_PROGRESS',
    blocked,
  );
  check(
    'chưa có gì bị xoá',
    (await prisma.podListingSession.count({ where: { id: a.sessionId } })) === 1,
  );

  await prisma.podListingJob.update({
    where: { id: a.sessionJobId },
    data: { status: 'COMPLETED' },
  });
  const ok = await sessions.removeMany(a.orgId, a.userId, [a.sessionId], ADMIN_SCOPE);
  check('xoá thành công khi job đã kết thúc', ok.deleted.includes(a.sessionId), ok);
  const left = await count(Prisma.sql`SELECT
      (SELECT COUNT(*) FROM pod_listing_sessions WHERE id = ${a.sessionId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_session_products WHERE session_id = ${a.sessionId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_payloads WHERE id = ${a.sessionPayloadId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_payload_items WHERE payload_id = ${a.sessionPayloadId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_jobs WHERE id = ${a.sessionJobId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_job_items WHERE job_id = ${a.sessionJobId}::uuid)
    + (SELECT COUNT(*) FROM pod_listing_logs WHERE job_id = ${a.sessionJobId}::uuid) AS n`);
  check('Draft Product / ảnh / payload / job / item / log đi theo', left === 0, left);
  check(
    'template, file Storage, shop còn nguyên',
    (await prisma.podSkuTemplate.count({ where: { id: a.skuTemplateId } })) === 1 &&
      (await prisma.storageFile.count({ where: { id: a.storageFileId } })) === 1 &&
      (await prisma.podTiktokShop.count({ where: { id: a.shopId } })) === 1,
  );
}

async function retentionScenario(b: OrgFixture): Promise<void> {
  console.log('\n▶ Retention — ranh giới ngày (America/Los_Angeles)');
  const now = new Date();
  const today = retentionCutoff(now, TZ, 1).cutoff;
  const week = retentionCutoff(now, TZ, 7).cutoff;
  const orgId = b.orgId;

  // Dọn rác của các lượt chạy trước để số đếm chỉ phản ánh fixture của kịch bản này.
  await prisma.notificationEvent.deleteMany({ where: { organizationId: orgId } });

  const event = (createdAt: Date, status: string) =>
    prisma.notificationEvent.create({
      data: {
        organizationId: orgId,
        eventType: 'ORDER_CREATED',
        entityType: 'POD_ORDER',
        entityId: randomUUID(),
        payload: {},
        status: status as never,
        createdAt,
      },
    });
  const keepToday = await event(new Date(today.getTime() + 60_000), 'SENT');
  const keepAtCutoff = await event(today, 'SENT');
  const dropBeforeCutoff = await event(new Date(today.getTime() - 1), 'SENT');
  const dropYesterday = await event(new Date(today.getTime() - DAY), 'FAILED');
  const keepPending = await event(new Date(today.getTime() - DAY), 'PENDING');

  // Publish History
  const job = async (status: string, finishedAt: Date, itemStatus = 'SUCCESS') => {
    const row = await prisma.podListingJob.create({
      data: { organizationId: orgId, name: 'J', market: 'US', status: status as never },
    });
    await prisma.$executeRaw`UPDATE pod_listing_jobs SET finished_at = ${finishedAt}, created_at = ${finishedAt} WHERE id = ${row.id}::uuid`;
    const item = await prisma.podListingJobItem.create({
      data: {
        organizationId: orgId,
        jobId: row.id,
        productId: b.productId,
        shopId: b.shopId,
        status: itemStatus as never,
      },
    });
    await prisma.podListingLog.create({
      data: {
        organizationId: orgId,
        jobId: row.id,
        listingItemId: item.id,
        step: 'PUBLISH',
        message: 'e2e',
      },
    });
    return row.id;
  };
  const oldJob = await job('COMPLETED', new Date(week.getTime() - DAY));
  const edgeJob = await job('FAILED', week);
  const runningOldJob = await job('PROCESSING', new Date(week.getTime() - DAY));
  const retryingOldJob = await job(
    'COMPLETED_WITH_ERRORS',
    new Date(week.getTime() - DAY),
    'RETRYING',
  );
  const recentJob = await job('COMPLETED', new Date(now.getTime() - 2 * DAY));

  // Draft Listings
  const draft = async (status: string, updatedAt: Date, extra: Record<string, unknown> = {}) => {
    const row = await prisma.podListingPayload.create({
      data: {
        organizationId: orgId,
        productId: b.productId,
        shopId: b.shopId,
        accountId: b.accountId,
        market: 'US',
        payload: {},
        payloadHash: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        status: status as never,
        listingTemplateId: null,
        ...extra,
      },
    });
    await prisma.podListingPayloadItem.create({
      data: {
        organizationId: orgId,
        payloadId: row.id,
        variantName: 'v',
        sellerSku: `s-${row.id}`,
      },
    });
    await prisma.$executeRaw`UPDATE pod_listing_payloads SET updated_at = ${updatedAt} WHERE id = ${row.id}::uuid`;
    return row.id;
  };
  // (shop, product, listing_template) UNIQUE ⇒ mỗi draft cần một sản phẩm nguồn riêng.
  const productFor = async () =>
    (
      await prisma.podProduct.create({
        data: {
          organizationId: orgId,
          accountId: b.accountId,
          shopId: b.shopId,
          tiktokProductId: `p-${randomUUID()}`,
          payloadHash: 'h',
        },
      })
    ).id;
  const old = new Date(week.getTime() - DAY);
  const oldDraft = await draft('DRAFT', old, { productId: await productFor() });
  const oldOnTiktok = await draft('READY', old, {
    productId: await productFor(),
    tiktokDraftId: 'tt-1',
  });
  const oldPublished = await draft('PUBLISHED', old, { productId: await productFor() });
  const recentDraft = await draft('DRAFT', new Date(now.getTime() - DAY), {
    productId: await productFor(),
  });
  const referencedOld = await draft('FAILED', old, { productId: await productFor() });
  await prisma.podListingJobItem.update({
    where: {
      id: (await prisma.podListingJobItem.findFirstOrThrow({ where: { jobId: recentJob } })).id,
    },
    data: { payloadId: referencedOld },
  });

  const otherLogsBefore = await count(
    Prisma.sql`SELECT COUNT(*) AS n FROM pod_flash_sale_logs WHERE organization_id = ${orgId}::uuid`,
  );

  const options: DataRetentionOptions = {
    ...retention.configuredOptions(),
    timeZone: TZ,
    publishHistoryDays: 7,
    draftListingDays: 7,
    batchSize: 100,
    maxBatchesPerStage: 100,
    pauseMs: 0,
    now,
  };

  const dry = await retention.run({ ...options, dryRun: true });
  check(
    'DRY-RUN: mọi tác vụ COMPLETED',
    dry.tasks.every((t) => t.status === 'COMPLETED'),
    dry.tasks.map((t) => [t.task, t.status, t.error]),
  );
  check(
    'DRY-RUN: không xoá gì',
    (await prisma.notificationEvent.count({ where: { id: dropYesterday.id } })) === 1 &&
      (await prisma.podListingJob.count({ where: { id: oldJob } })) === 1,
  );

  const real = await retention.run({ ...options, dryRun: false });
  check(
    'chạy thật: mọi tác vụ COMPLETED',
    real.tasks.every((t) => t.status === 'COMPLETED'),
    real.tasks.map((t) => [t.task, t.status, t.error]),
  );

  const exists = async (table: string, id: string) =>
    (await count(
      Prisma.sql`SELECT COUNT(*) AS n FROM ${Prisma.raw(table)} WHERE id = ${id}::uuid`,
    )) === 1;
  check('notification HÔM NAY được giữ', await exists('notification_events', keepToday.id));
  check(
    'notification đúng 00:00 hôm nay (mốc) được giữ',
    await exists('notification_events', keepAtCutoff.id),
  );
  check(
    'notification 1 ms trước nửa đêm bị xoá',
    !(await exists('notification_events', dropBeforeCutoff.id)),
  );
  check('notification hôm qua bị xoá', !(await exists('notification_events', dropYesterday.id)));
  check(
    'notification hôm qua CHƯA GỬI (PENDING) được giữ',
    await exists('notification_events', keepPending.id),
  );

  check(
    'job kết thúc trước 7 ngày bị xoá cùng item + log',
    !(await exists('pod_listing_jobs', oldJob)) &&
      (await count(
        Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_job_items WHERE job_id = ${oldJob}::uuid`,
      )) === 0 &&
      (await count(
        Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_logs WHERE job_id = ${oldJob}::uuid`,
      )) === 0,
  );
  check('job kết thúc đúng mốc 7 ngày được giữ', await exists('pod_listing_jobs', edgeJob));
  check('job cũ còn PROCESSING được giữ', await exists('pod_listing_jobs', runningOldJob));
  check('job cũ còn item RETRYING được giữ', await exists('pod_listing_jobs', retryingOldJob));
  check('job trong 7 ngày được giữ', await exists('pod_listing_jobs', recentJob));

  check(
    'draft cũ bị xoá cùng biến thể',
    !(await exists('pod_listing_payloads', oldDraft)) &&
      (await count(
        Prisma.sql`SELECT COUNT(*) AS n FROM pod_listing_payload_items WHERE payload_id = ${oldDraft}::uuid`,
      )) === 0,
  );
  check(
    'draft cũ đã có Draft trên TikTok được GIỮ',
    await exists('pod_listing_payloads', oldOnTiktok),
  );
  check('listing đã PUBLISHED được giữ', await exists('pod_listing_payloads', oldPublished));
  check('draft trong 7 ngày được giữ', await exists('pod_listing_payloads', recentDraft));
  check(
    'draft cũ được job item đã xong tham chiếu: xoá, item còn với payload_id = NULL',
    !(await exists('pod_listing_payloads', referencedOld)) &&
      (await prisma.podListingJobItem.count({ where: { jobId: recentJob, payloadId: null } })) ===
        1,
  );
  const drafts = real.tasks.find((t) => t.task === 'DRAFT_LISTINGS')!;
  check(
    'báo số draft giữ lại vì đã có trên TikTok',
    (drafts.kept.ON_TIKTOK ?? 0) >= 1,
    drafts.kept,
  );

  check(
    'log Flash Sale (ngoài phạm vi) không bị đụng',
    (await count(
      Prisma.sql`SELECT COUNT(*) AS n FROM pod_flash_sale_logs WHERE organization_id = ${orgId}::uuid`,
    )) === otherLogsBefore,
  );

  const again = await retention.run({ ...options, dryRun: false });
  const deletedAgain = again.tasks.flatMap((t) => t.stages).reduce((sum, s) => sum + s.deleted, 0);
  check(
    '🔁 chạy lại: không còn gì để xoá, không lỗi',
    deletedAgain === 0 && again.tasks.every((t) => t.status === 'COMPLETED'),
    again.tasks,
  );
}

async function organizationScenario(a: OrgFixture, b: OrgFixture): Promise<void> {
  console.log('\n▶ Xoá Organization');
  const operator = {
    userId: randomUUID(),
    organizationId: 'platform',
    role: 'SUPER_ADMIN',
    jti: 'e2e',
  };
  const before = await tenantSnapshot(a.orgId);
  const bBefore = await tenantSnapshot(b.orgId);
  const globalsBefore = await globalCounts();
  check('fixture A có dữ liệu ở nhiều bảng', Object.keys(before).length >= 15, before);

  const platform = await prisma.organization.findFirstOrThrow({ where: { isPlatform: true } });
  await expectCode(
    'tổ chức hệ thống ⇒ 404',
    orgDeletion.delete(operator, platform.id, { confirmSlug: platform.slug }),
    'PLATFORM_ORGANIZATION_NOT_FOUND',
  );
  await expectCode(
    'slug xác nhận sai ⇒ 400',
    orgDeletion.delete(operator, a.orgId, { confirmSlug: 'wrong' }),
    'PLATFORM_ORGANIZATION_DELETE_CONFIRMATION_MISMATCH',
  );

  // (1) Tham chiếu xuyên tenant: một item Flash Sale của B trỏ vào sản phẩm của A.
  const crossItem = await prisma.podFlashSaleItem.create({
    data: {
      organizationId: b.orgId,
      flashSaleId: b.fsDraft,
      productId: a.productId,
      originalPrice: 1,
      flashSalePrice: 1,
      discountPercent: 0,
    },
  });
  await expectCode(
    'dữ liệu tổ chức khác tham chiếu vào ⇒ UNSAFE',
    orgDeletion.delete(operator, a.orgId, { confirmSlug: a.slug }),
    'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
  );
  check(
    '…và KHÔNG có gì bị xoá',
    JSON.stringify(await tenantSnapshot(a.orgId)) === JSON.stringify(before),
  );
  await prisma.podFlashSaleItem.delete({ where: { id: crossItem.id } });

  // (2) Bảng lạ (ngoài kế hoạch) có dữ liệu của A.
  await prisma.$executeRawUnsafe(
    `CREATE TABLE e2e_unknown_tenant (id uuid PRIMARY KEY, organization_id uuid NOT NULL)`,
  );
  await prisma.$executeRaw`INSERT INTO e2e_unknown_tenant VALUES (${randomUUID()}::uuid, ${a.orgId}::uuid)`;
  await expectCode(
    'bảng ngoài kế hoạch có dữ liệu ⇒ UNSAFE',
    orgDeletion.delete(operator, a.orgId, { confirmSlug: a.slug }),
    'PLATFORM_ORGANIZATION_DELETE_UNSAFE',
  );
  await prisma.$executeRawUnsafe(`DROP TABLE e2e_unknown_tenant`);

  // (3) Lỗi GIỮA CHỪNG (trigger chặn xoá pod_orders) ⇒ rollback toàn bộ.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION e2e_block_delete() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'e2e: chặn xoá giữa chừng'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER e2e_block BEFORE DELETE ON pod_orders FOR EACH ROW EXECUTE FUNCTION e2e_block_delete()`,
  );
  await expectCode(
    'lỗi giữa chừng ⇒ DELETE_FAILED',
    orgDeletion.delete(operator, a.orgId, { confirmSlug: a.slug }),
    'PLATFORM_ORGANIZATION_DELETE_FAILED',
  );
  await prisma.$executeRawUnsafe(`DROP TRIGGER e2e_block ON pod_orders`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION e2e_block_delete()`);
  check(
    '…ROLLBACK: dữ liệu A còn nguyên (kể cả bảng xoá TRƯỚC pod_orders)',
    JSON.stringify(await tenantSnapshot(a.orgId)) === JSON.stringify(before),
  );
  check(
    '…organization A vẫn tồn tại',
    (await prisma.organization.count({ where: { id: a.orgId } })) === 1,
  );

  // (4) Thành công.
  const result = await orgDeletion.delete(operator, a.orgId, { confirmSlug: a.slug });
  check(
    'xoá thành công, có số liệu',
    result.deletedRows > 0 && result.storageFilesDeleted === 1,
    result,
  );
  check(
    'mọi bảng có organization_id sạch dữ liệu của A',
    Object.keys(await tenantSnapshot(a.orgId)).length === 0,
  );
  check(
    'organizations của A đã mất',
    (await prisma.organization.count({ where: { id: a.orgId } })) === 0,
  );
  check(
    'bảng con không có organization_id cũng sạch (refresh_tokens, role_permissions, order_items)',
    (await prisma.refreshToken.count({ where: { userId: a.userId } })) === 0 &&
      (await count(
        Prisma.sql`SELECT COUNT(*) AS n FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL`,
      )) === 0,
  );
  check(
    'tổ chức B nguyên vẹn',
    JSON.stringify(await tenantSnapshot(b.orgId)) === JSON.stringify(bBefore),
  );
  const globalsAfter = await globalCounts();
  check(
    'dữ liệu dùng chung nguyên vẹn (platforms, permissions, categories, brands)',
    ['platforms', 'permissions', 'pod_product_categories', 'pod_product_brands'].every(
      (t) => globalsAfter[t] === globalsBefore[t],
    ),
  );
  check(
    'organizations giảm đúng 1',
    globalsAfter.organizations === globalsBefore.organizations - 1,
  );
}

async function main(): Promise<void> {
  console.log(`DB: ${DB_URL.replace(/\/\/[^@]*@/, '//***@')}`);
  const a = await seedOrg('a');
  const b = await seedOrg('b');
  try {
    await flashSaleScenario(a, b);
    await sessionScenario(a);
    await retentionScenario(b);
    await organizationScenario(a, b);
  } finally {
    // Dọn B bằng chính đường xoá (cũng là một lần kiểm nữa).
    const operator = {
      userId: randomUUID(),
      organizationId: 'platform',
      role: 'SUPER_ADMIN',
      jti: 'e2e',
    };
    await orgDeletion
      .delete(operator, b.orgId, { confirmSlug: b.slug })
      .catch((error) => console.log('  ⚠ dọn B lỗi', error));
    await orgDeletion.delete(operator, a.orgId, { confirmSlug: a.slug }).catch(() => undefined);
  }
  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  await prisma.$disconnect();
  await redis.client.quit();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
