/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật) — vòng đời Organization: gói (giới hạn Shop + hạn), duyệt / duyệt lại,
 * kích hoạt / vô hiệu hoá, chặn ở JwtAuthGuard, giới hạn Shop khi kết nối ĐỒNG THỜI, xoá cứng giữ Global Catalog.
 *
 * 🔴 CHỈ chạy trên database CỤC BỘ dùng-xong-bỏ: TỪ CHỐI nếu DATABASE_URL không trỏ 127.0.0.1 / localhost.
 *   DATABASE_URL=postgresql://ncm_test@127.0.0.1:55432/ncm_test node -r ts-node/register test/manual/e2e-organization-lifecycle.manual.ts
 *
 * Đường đi THẬT: OrganizationReviewService, MeService, JwtAuthGuard, PodTiktokAccountService.persistLink (khoá dòng
 * tổ chức + đếm shop), OrganizationDeletionService, FulfillmentCatalogRepository + FulfillmentGlobalCatalogRepository.
 * Giả lập: email (không gửi), mã hoá token (chuỗi), khoá Redis (bộ nhớ), chữ ký JWT.
 */
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrganizationStatus, PrismaClient } from '@prisma/client';
import { MemoryLocks } from './support/fake-tiktok-promotion';
import { countConnectedShops } from '../../src/common/organization/organization-plan';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { MeService } from '../../src/modules/auth/services/me.service';
import { clearOrganizationAccessCache } from '../../src/modules/auth/shared/organization-access-cache';
import { PodTiktokAccountRepository } from '../../src/modules/pod-tiktok/repositories/pod-tiktok-account.repository';
import { PodTiktokAccountService } from '../../src/modules/pod-tiktok/services/pod-tiktok-account.service';
import { PodTiktokShopLimitReachedException } from '../../src/modules/pod-tiktok/exceptions/pod-tiktok.exceptions';
import { OrganizationReviewService } from '../../src/modules/super-admin/services/organization-review.service';
import { OrganizationDeletionService } from '../../src/modules/super-admin/services/organization-deletion.service';
import { UpdateOrganizationShopLimitDto } from '../../src/modules/super-admin/dto/super-admin-organization.dto';
import { FulfillmentCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-catalog.repository';
import { FulfillmentGlobalCatalogRepository } from '../../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('TỪ CHỐI: DATABASE_URL phải trỏ database cục bộ dùng-xong-bỏ.');
  process.exit(2);
}

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
const RUN = `OLC${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

const mail = { sendOrganizationApproved: async () => ({ sent: true }), sendOrganizationRejected: async () => ({ sent: true }) };
const review = new OrganizationReviewService(prisma as never, mail as never);
const operator = { userId: randomUUID(), organizationId: 'platform', role: 'SUPER_ADMIN', jti: 'j' };

async function newOrg(tag: string, status: OrganizationStatus, createdAt: Date, extra: Record<string, unknown> = {}) {
  return prisma.organization.create({
    data: { name: `${RUN} ${tag}`, slug: `${RUN.toLowerCase()}-${tag.toLowerCase()}`, status, createdAt, ...extra } as never,
  });
}

/** JwtAuthGuard thật (DB thật), chữ ký giả: trả mã lỗi hoặc 'OK'. */
async function guardVerdict(organizationId: string): Promise<string> {
  const jwt = { verifyAsync: async () => ({ sub: 'u', organizationId, role: 'ADMIN', jti: 'j' }) };
  const config = { getOrThrow: () => 'secret' };
  const guard = new JwtAuthGuard(jwt as never, config as never, prisma as never);
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }) };
  try {
    await guard.canActivate(ctx as never);
    return 'OK';
  } catch (error) {
    return ((error as { response?: { code?: string } }).response?.code) ?? (error as Error).message;
  }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return ((error as { response?: { code?: string } }).response?.code) ?? (error as Error).constructor.name;
  }
}

// ---------------------------------------------------------------------------------------------------------------
async function lifecycle(): Promise<void> {
  // Đăng ký 01/11/2026 03:15Z, duyệt HÔM NAY ⇒ hết hạn 01/12/2026 03:15Z (từ ngày ĐĂNG KÝ).
  const registeredAt = new Date('2026-11-01T03:15:00.000Z');
  const p = await newOrg('P', OrganizationStatus.PENDING, registeredAt);
  check('đăng ký: created_at = ngày đăng ký, chưa có gói (NULL)', p.createdAt.toISOString() === registeredAt.toISOString() && p.shopLimit === null && p.expiresAt === null);
  check('hồ sơ PENDING bị chặn ở guard', (await guardVerdict(p.id)) === 'AUTH_ORGANIZATION_PENDING');

  const approved = await review.approve(operator as never, p.id);
  const row = await prisma.organization.findUniqueOrThrow({ where: { id: p.id } });
  check('duyệt: ACTIVE, 10 Shop, hết hạn = ngày ĐĂNG KÝ + 30 ngày (01/12/2026 03:15Z)',
    row.status === 'ACTIVE' && row.shopLimit === 10 && row.expiresAt?.toISOString() === '2026-12-01T03:15:00.000Z',
    { status: row.status, shopLimit: row.shopLimit, expiresAt: row.expiresAt });
  check('response duyệt có gói + số Shop', approved.shopLimit === 10 && approved.connectedShopCount === 0 && approved.expired === false);
  check('ACTIVE + còn hạn ⇒ guard cho qua', (await guardVerdict(p.id)) === 'OK');

  // /me — header Admin/Employee.
  const role = await prisma.role.create({ data: { organizationId: p.id, code: 'ADMIN', displayName: 'Admin' } as never });
  const user = await prisma.user.create({
    data: { organizationId: p.id, roleId: role.id, email: `${RUN.toLowerCase()}@p.test`, passwordHash: 'x', fullName: 'Owner', status: 'ACTIVE' } as never,
  });
  const me = await new MeService(prisma as never).getMe({ userId: user.id, organizationId: p.id, role: 'ADMIN', jti: 'j' });
  check('/me trả gói cho header: 0 / 10, hết hạn 01/12/2026, chưa hết hạn',
    me.organization.plan?.connectedShopCount === 0 && me.organization.plan?.shopLimit === 10 &&
    me.organization.plan?.expiresAt === '2026-12-01T03:15:00.000Z' && me.organization.plan?.expired === false, me.organization.plan);

  await review.deactivate(operator as never, p.id);
  check('vô hiệu hoá ⇒ SUSPENDED, guard chặn NGAY (token cũ) với AUTH_ORGANIZATION_DEACTIVATED', (await guardVerdict(p.id)) === 'AUTH_ORGANIZATION_DEACTIVATED');
  check('vô hiệu hoá KHÔNG xoá user / role', (await prisma.user.count({ where: { organizationId: p.id } })) === 1 && (await prisma.role.count({ where: { organizationId: p.id } })) === 1);

  await review.updateExpiration(operator as never, p.id, { expiresAt: new Date(Date.now() + 90 * DAY).toISOString() });
  const stillSuspended = await prisma.organization.findUniqueOrThrow({ where: { id: p.id } });
  check('🔴 gia hạn khi SUSPENDED ⇒ VẪN SUSPENDED, guard vẫn chặn', stillSuspended.status === 'SUSPENDED' && (await guardVerdict(p.id)) === 'AUTH_ORGANIZATION_DEACTIVATED');
  check('gia hạn không đổi ngày đăng ký / giới hạn Shop', stillSuspended.createdAt.toISOString() === registeredAt.toISOString() && stillSuspended.shopLimit === 10);

  await review.activate(operator as never, p.id);
  check('kích hoạt ⇒ ACTIVE, guard cho qua', (await guardVerdict(p.id)) === 'OK');

  await review.updateExpiration(operator as never, p.id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
  check('🔴 hạn đã qua ⇒ guard chặn token còn hạn với AUTH_ORGANIZATION_EXPIRED', (await guardVerdict(p.id)) === 'AUTH_ORGANIZATION_EXPIRED');
  check('/me của tổ chức hết hạn ⇒ AUTH_ORGANIZATION_EXPIRED',
    (await codeOf(new MeService(prisma as never).getMe({ userId: user.id, organizationId: p.id, role: 'ADMIN', jti: 'j' }))) === 'AUTH_ORGANIZATION_EXPIRED');
  await review.updateExpiration(operator as never, p.id, { expiresAt: new Date(Date.now() + 30 * DAY).toISOString() });
  check('gia hạn tổ chức HẾT HẠN (ACTIVE) ⇒ dùng lại được ngay, không cần thao tác khác', (await guardVerdict(p.id)) === 'OK');
  check('ngày hết hạn trước ngày đăng ký ⇒ PLATFORM_ORGANIZATION_EXPIRATION_INVALID',
    (await codeOf(review.updateExpiration(operator as never, p.id, { expiresAt: '2026-10-01T00:00:00.000Z' }))) === 'PLATFORM_ORGANIZATION_EXPIRATION_INVALID');

  // Từ chối ⇒ duyệt lại.
  const r = await newOrg('R', OrganizationStatus.PENDING, new Date('2026-11-05T00:00:00.000Z'));
  await review.reject(operator as never, r.id, { reason: 'Thiếu thông tin doanh nghiệp' });
  check('từ chối ⇒ REJECTED, guard chặn AUTH_ORGANIZATION_REJECTED', (await guardVerdict(r.id)) === 'AUTH_ORGANIZATION_REJECTED');
  await review.approve(operator as never, r.id);
  const rr = await prisma.organization.findUniqueOrThrow({ where: { id: r.id } });
  check('🔴 DUYỆT LẠI REJECTED ⇒ ACTIVE + gói mặc định (10, đăng ký + 30 ngày), lý do từ chối được xoá',
    rr.status === 'ACTIVE' && rr.shopLimit === 10 && rr.expiresAt?.toISOString() === '2026-12-05T00:00:00.000Z' && rr.rejectedReason === null);
  const logs = await prisma.organizationApprovalLog.findMany({ where: { organizationId: r.id }, orderBy: { createdAt: 'asc' } });
  check('nhật ký: REJECT rồi APPROVE (old_status = REJECTED)', logs.map((l) => `${l.action}:${l.oldStatus}`).join(',') === 'REJECT:PENDING,APPROVE:REJECTED');

  // Hồ sơ cũ (backfill 500 / 365) bị từ chối ⇒ duyệt lại GIỮ gói.
  // Chỉ chạy khi hồ sơ còn REJECTED (lần chạy đầu sau migrate) — chạy lại script thì bỏ qua bước này.
  const legacyRejected = await prisma.organization.findFirst({ where: { slug: 'mig-rejected', status: 'REJECTED' } });
  if (legacyRejected) {
    await review.approve(operator as never, legacyRejected.id);
    const lr = await prisma.organization.findUniqueOrThrow({ where: { id: legacyRejected.id } });
    check('duyệt lại hồ sơ CŨ đã có gói (500 / 09/09/2027) ⇒ GIỮ NGUYÊN', lr.shopLimit === 500 && lr.expiresAt?.toISOString() === legacyRejected.expiresAt?.toISOString());
  }

  // Hồ sơ đăng ký đã hơn 30 ngày ⇒ duyệt xong là hết hạn (hệ quả có chủ đích của luật "tính từ ngày đăng ký").
  const old = await newOrg('OLD', OrganizationStatus.PENDING, new Date('2026-09-01T00:00:00.000Z'));
  const oldApproved = await review.approve(operator as never, old.id);
  check('hồ sơ đăng ký > 30 ngày trước ⇒ duyệt xong expired = true (giao diện nhắc gia hạn)', oldApproved.expired === true);

  // Validation giới hạn Shop (DTO — ValidationPipe toàn cục dùng cùng class-validator).
  const errorsFor = async (value: unknown) => (await validate(plainToInstance(UpdateOrganizationShopLimitDto, { shopLimit: value }))).length;
  check('shopLimit 0 / âm / null / NaN / 1.5 ⇒ bị từ chối; 20 ⇒ hợp lệ',
    (await errorsFor(0)) > 0 && (await errorsFor(-1)) > 0 && (await errorsFor(null)) > 0 && (await errorsFor('abc')) > 0 &&
    (await errorsFor(1.5)) > 0 && (await errorsFor(20)) === 0);
}

// ---------------------------------------------------------------------------------------------------------------
function linker() {
  const repo = new PodTiktokAccountRepository(prisma as never);
  const encryption = { encrypt: (value: string) => `enc:${value}` };
  const accountHandover = { creditTiktokAccountHandover: async () => ({ credited: false }) };
  const service = new PodTiktokAccountService(prisma as never, repo, {} as never, encryption as never, {} as never, {} as never, accountHandover as never);
  return (orgId: string, openId: string, shopIds: string[], actorUserId: string) =>
    (service as any).persistLink(
      orgId,
      actorUserId,
      {
        open_id: openId, seller_name: openId, seller_base_region: 'US', userTypeSafe: 0,
        access_token: 'a', access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'r', refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86_400, granted_scopes: [],
      },
      shopIds.map((id) => ({ id, cipher: `c-${id}`, code: id, name: `Shop ${id}`, region: 'US', seller_type: 'LOCAL' })),
      undefined,
      {},
    ) as Promise<string>;
}

/** Người thực hiện liên kết phải là user THẬT của tổ chức (`pod_tiktok_accounts.authorized_by` → users). */
async function actorIn(organizationId: string, tag: string): Promise<string> {
  const role = await prisma.role.create({ data: { organizationId, code: 'ADMIN', displayName: 'Admin' } as never });
  const user = await prisma.user.create({
    data: { organizationId, roleId: role.id, email: `${RUN.toLowerCase()}-${tag}@actor.test`, passwordHash: 'x', fullName: tag, status: 'ACTIVE' } as never,
  });
  return user.id;
}

async function shopLimit(): Promise<void> {
  const org = await newOrg('L', OrganizationStatus.PENDING, new Date());
  await review.approve(operator as never, org.id);
  const actor = await actorIn(org.id, 'l');
  const raw = linker();
  const link = (orgId: string, openId: string, shopIds: string[]) => raw(orgId, openId, shopIds, actor);
  const count = () => countConnectedShops(prisma, org.id);

  await link(org.id, `${RUN}-A`, Array.from({ length: 9 }, (_, i) => `${RUN}-a${i}`));
  check('9 / 10 sau lần liên kết đầu', (await count()) === 9);

  // 🔴 Hai lượt kết nối ĐỒNG THỜI ở 9 / 10 — không bao giờ ra 11 / 10.
  const raced = await Promise.allSettled([link(org.id, `${RUN}-B`, [`${RUN}-b0`]), link(org.id, `${RUN}-C`, [`${RUN}-c0`])]);
  const ok = raced.filter((r) => r.status === 'fulfilled').length;
  const rejected = raced.filter((r) => r.status === 'rejected' && r.reason instanceof PodTiktokShopLimitReachedException).length;
  check('🔴 2 kết nối đồng thời ở 9/10 ⇒ đúng 1 thành công, 1 bị chặn; tổng = 10 (không 11)', ok === 1 && rejected === 1 && (await count()) === 10, { ok, rejected, count: await count() });
  const loserOpenIds = [`${RUN}-B`, `${RUN}-C`];
  const loserAccounts = await prisma.podTiktokAccount.count({ where: { organizationId: org.id, openId: { in: loserOpenIds } } });
  check('lượt bị chặn KHÔNG để lại kết nối / shop nào (rollback)', loserAccounts === 1);

  // Dồn 5 lượt cùng lúc khi đang 10/10 ⇒ tất cả bị chặn.
  const flood = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => link(org.id, `${RUN}-F${i}`, [`${RUN}-f${i}`])));
  check('5 kết nối đồng thời ở 10/10 ⇒ cả 5 bị chặn, vẫn 10', flood.every((r) => r.status === 'rejected') && (await count()) === 10);

  await link(org.id, `${RUN}-A`, Array.from({ length: 9 }, (_, i) => `${RUN}-a${i}`));
  check('uỷ quyền lại kết nối cũ ở 10/10 (không thêm shop) ⇒ được', (await count()) === 10);

  await review.updateShopLimit(operator as never, org.id, { shopLimit: 11 });
  await link(org.id, `${RUN}-G`, [`${RUN}-g0`]);
  check('Super Admin nâng lên 11 ⇒ kết nối thêm được (11 / 11)', (await count()) === 11);

  await review.updateShopLimit(operator as never, org.id, { shopLimit: 5 });
  await link(org.id, `${RUN}-A`, Array.from({ length: 9 }, (_, i) => `${RUN}-a${i}`));
  const blocked = await link(org.id, `${RUN}-H`, [`${RUN}-h0`]).then(() => 'OK', (e) => e?.response?.code);
  check('hạ xuống 5 khi đang 11 ⇒ uỷ quyền lại vẫn được, kết nối MỚI bị chặn', blocked === 'POD_TIKTOK_SHOP_LIMIT_REACHED' && (await count()) === 11);

  const listed = await review.list({ search: `${RUN} L` });
  check('Super Admin: danh sách hiện "11 / 5"', listed.items[0]?.connectedShopCount === 11 && listed.items[0]?.shopLimit === 5, listed.items[0]);

  const a = await prisma.podTiktokAccount.findFirstOrThrow({ where: { organizationId: org.id, openId: `${RUN}-A` } });
  await prisma.$transaction((tx) => new PodTiktokAccountRepository(prisma as never).softDeleteAccount(tx, a.id, randomUUID()));
  check('gỡ liên kết (unlink) ⇒ giải phóng chỗ ngay (11 − 9 = 2)', (await count()) === 2);
}

// ---------------------------------------------------------------------------------------------------------------
async function hardDelete(): Promise<void> {
  const platform = await prisma.organization.findFirst({ where: { isPlatform: true } });
  const x = await newOrg('X', OrganizationStatus.ACTIVE, new Date(), { shopLimit: 10, expiresAt: new Date(Date.now() + 30 * DAY) });
  const y = await newOrg('Y', OrganizationStatus.ACTIVE, new Date(), { shopLimit: 10, expiresAt: new Date(Date.now() + 30 * DAY) });
  const roleX = await prisma.role.create({ data: { organizationId: x.id, code: 'ADMIN', displayName: 'Admin' } as never });
  const userX = await prisma.user.create({ data: { organizationId: x.id, roleId: roleX.id, email: `${RUN.toLowerCase()}@x.test`, passwordHash: 'x', fullName: 'X', status: 'ACTIVE' } as never });

  const catalogRepo = new FulfillmentCatalogRepository(prisma as never);
  const globalRepo = new FulfillmentGlobalCatalogRepository(prisma as never);
  const syncedAt = new Date();
  const seedCatalog = async (organizationId: string, accountId: string, cost: string) => {
    const scope = { organizationId, accountId, provider: 'SELLERWIX' as const };
    const cats = await catalogRepo.upsertCatalogues(scope, [{ externalCatalogueId: `${RUN}-cat`, name: `${RUN} Cat` }], syncedAt);
    const prods = await catalogRepo.upsertProducts(scope, [{
      externalProductId: `${RUN}-P`, externalCatalogueId: `${RUN}-cat`, name: `${RUN} Tee`, sku: `${RUN}-P`, image: null,
      basePrice: null, currency: 'USD', variationsCount: null, status: 'ACTIVE' as never, rawData: {},
    }], cats, syncedAt);
    await catalogRepo.upsertVariants(scope, [`${RUN}-P-BL-S`, `${RUN}-P-BL-M`].map((sku) => ({
      externalProductId: `${RUN}-P`, externalVariantId: sku, sku, name: sku, color: 'Black', size: 'S', price: cost,
      status: 'ACTIVE' as never, rawData: { cost: Number(cost), print_areas: [{ key: 'CF' }] },
    })), prods, syncedAt);
    await globalRepo.projectAccount(accountId, 'SELLERWIX' as never);
  };
  const fx = await prisma.fulfillmentAccount.create({ data: { organizationId: x.id, provider: 'SELLERWIX', name: `${RUN} FX` } as never });
  const fy = await prisma.fulfillmentAccount.create({ data: { organizationId: y.id, provider: 'SELLERWIX', name: `${RUN} FY` } as never });
  await seedCatalog(x.id, fx.id, '5.00');
  await seedCatalog(y.id, fy.id, '6.00');
  let fp: { id: string } | null = null;
  if (platform) {
    fp = await prisma.fulfillmentAccount.create({ data: { organizationId: platform.id, provider: 'SELLERWIX', name: `${RUN} SHARED`, isGlobal: true } as never });
    await seedCatalog(platform.id, fp.id, '5.50');
  }
  // Ánh xạ của X: một trên tài khoản riêng, một trên tài khoản DÙNG CHUNG của nền tảng. Design của X.
  await prisma.fulfillmentProductMapping.createMany({
    data: [fx.id, ...(fp ? [fp.id] : [])].map((accountId, i) => ({
      organizationId: x.id, accountId, provider: 'SELLERWIX', tiktokProductId: `${RUN}-tt${i}`, tiktokSkuId: `${RUN}-sku${i}`,
      sellerSku: `${RUN}-seller${i}`, providerSku: `${RUN}-P-BL-S`, providerVariantId: `${RUN}-P-BL-S`, baseCost: 5,
    })) as never,
  });
  await prisma.fulfillmentProductDesign.create({
    data: { organizationId: x.id, tiktokProductId: `${RUN}-tt0`, tiktokSkuId: `${RUN}-sku0`, placement: 'FRONT', sourceUrl: 'https://example.com/x.png' } as never,
  });
  await linker()(x.id, `${RUN}-XA`, [`${RUN}-x0`, `${RUN}-x1`], userX.id);
  const yMapping = await prisma.fulfillmentProductMapping.create({
    data: { organizationId: y.id, accountId: fy.id, provider: 'SELLERWIX', tiktokProductId: `${RUN}-ty`, tiktokSkuId: `${RUN}-tys`, sellerSku: `${RUN}-ys`, providerSku: `${RUN}-P-BL-S`, providerVariantId: `${RUN}-P-BL-S`, baseCost: 6 } as never,
  });

  const globalBefore = {
    products: await prisma.providerCatalogProduct.count({ where: { externalProductId: `${RUN}-P` } }),
    variants: await prisma.providerCatalogVariant.count({ where: { externalVariantId: { startsWith: `${RUN}-P-` } } }),
  };
  const yAccountVariantsBefore = await prisma.fulfillmentAccountVariant.count({ where: { accountId: fy.id } });
  const fpVariantsBefore = fp ? await prisma.fulfillmentAccountVariant.count({ where: { accountId: fp.id } }) : 0;
  check('chuẩn bị: global 1 sản phẩm / 2 biến thể, dùng chung bởi X, Y (và tài khoản nền tảng)', globalBefore.products === 1 && globalBefore.variants === 2);

  const deletion = new OrganizationDeletionService(prisma as never, new MemoryLocks() as never, { dropCachedSessions: async () => undefined } as never);
  const result = await deletion.delete({ userId: operator.userId, organizationId: platform?.id ?? 'p', role: 'SUPER_ADMIN', jti: 'j' } as never, x.id, { confirmSlug: x.slug });
  check('xoá cứng X thành công', result.organizationId === x.id && result.deletedRows > 0, { deletedRows: result.deletedRows, tables: result.tables.length });

  const tenantTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = current_schema() AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE'`;
  const leftovers: string[] = [];
  for (const { table_name } of tenantTables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${table_name}" WHERE organization_id = $1::uuid`, x.id);
    if (Number(row.n) > 0) leftovers.push(table_name);
  }
  check('🔴 KHÔNG bảng nào có organization_id còn dòng của X (user, role, shop, tài khoản, catalog, ánh xạ, design…)', leftovers.length === 0, leftovers);
  check('organizations: X không còn', (await prisma.organization.count({ where: { id: x.id } })) === 0);
  check('lớp catalog theo tài khoản của X bị xoá', (await prisma.fulfillmentAccountVariant.count({ where: { accountId: fx.id } })) === 0);

  const globalAfter = {
    products: await prisma.providerCatalogProduct.count({ where: { externalProductId: `${RUN}-P` } }),
    variants: await prisma.providerCatalogVariant.count({ where: { externalVariantId: { startsWith: `${RUN}-P-` } } }),
  };
  check('🔴 Global Catalog GIỮ NGUYÊN (provider_catalog_*)', JSON.stringify(globalAfter) === JSON.stringify(globalBefore), globalAfter);
  check('dữ liệu tổ chức Y nguyên vẹn (tài khoản, catalog theo tài khoản, ánh xạ + Base Cost 6)',
    (await prisma.fulfillmentAccount.count({ where: { id: fy.id } })) === 1 &&
    (await prisma.fulfillmentAccountVariant.count({ where: { accountId: fy.id } })) === yAccountVariantsBefore &&
    Number((await prisma.fulfillmentProductMapping.findUnique({ where: { id: yMapping.id } }))?.baseCost) === 6);
  if (fp) {
    check('🔴 tài khoản fulfillment DÙNG CHUNG của nền tảng (X từng dùng) GIỮ NGUYÊN cùng catalog của nó',
      (await prisma.fulfillmentAccount.count({ where: { id: fp.id } })) === 1 &&
      (await prisma.fulfillmentAccountVariant.count({ where: { accountId: fp.id } })) === fpVariantsBefore);
  }
  const log = await prisma.organizationDeletionLog.findFirst({ where: { deletedOrganizationId: x.id } });
  check('nhật ký xoá cứng còn lại: id, tên, slug, người xoá, thời điểm, số dòng',
    log !== null && log.organizationName === x.name && log.organizationSlug === x.slug && log.deletedBy === operator.userId &&
    log.deletedAt instanceof Date && log.deletedRows === result.deletedRows);
  // Cấu trúc cố định: chỉ định danh + người xoá + số dòng; mỗi phần tử `tables` chỉ có tên bảng + số dòng
  // (tên bảng như pod_tiktok_token_audits là TÊN bảng, không phải giá trị bí mật).
  const logKeys = Object.keys(log ?? {}).sort().join(',');
  const tableEntries = (log?.tables ?? []) as Array<Record<string, unknown>>;
  check('nhật ký chỉ gồm trường định danh / người xoá / số dòng — không dữ liệu nghiệp vụ, không bí mật',
    logKeys === 'deletedAt,deletedBy,deletedByEmail,deletedOrganizationId,deletedRows,id,organizationName,organizationSlug,tables' &&
    tableEntries.every((t) => Object.keys(t).sort().join(',') === 'deleted,table'), logKeys);
  check('guard: user của tổ chức đã xoá ⇒ 401 (token không còn hợp lệ)', (await guardVerdict(x.id)) === 'AUTH_TOKEN_INVALID');

  // Tài khoản DÙNG CHUNG thuộc một tổ chức tenant mà tổ chức KHÁC đang dùng ⇒ TỪ CHỐI xoá (không xoá lan).
  const owner = await newOrg('OWN', OrganizationStatus.ACTIVE, new Date(), { shopLimit: 10, expiresAt: new Date(Date.now() + DAY) });
  const shared = await prisma.fulfillmentAccount.create({ data: { organizationId: owner.id, provider: 'SELLERWIX', name: `${RUN} OWN-SHARED`, isGlobal: true } as never });
  await prisma.fulfillmentProductMapping.create({
    data: { organizationId: y.id, accountId: shared.id, provider: 'SELLERWIX', tiktokProductId: `${RUN}-ty2`, tiktokSkuId: `${RUN}-tys2`, sellerSku: `${RUN}-ys2`, providerSku: 'S', providerVariantId: 'S', baseCost: 1 } as never,
  });
  const refused = await codeOf(deletion.delete({ userId: operator.userId } as never, owner.id, { confirmSlug: owner.slug }));
  check('🔴 xoá tổ chức sở hữu tài khoản dùng chung mà tổ chức khác đang dùng ⇒ TỪ CHỐI, không xoá gì',
    refused === 'PLATFORM_ORGANIZATION_DELETE_UNSAFE' && (await prisma.fulfillmentAccount.count({ where: { id: shared.id } })) === 1, refused);
}

async function main(): Promise<void> {
  clearOrganizationAccessCache();
  await lifecycle();
  await shopLimit();
  await hardDelete();
}

main()
  .catch((error) => results.push(`FAIL  lỗi không mong đợi — ${(error as Error).stack ?? (error as Error).message}`))
  .finally(async () => {
    console.log(results.join('\n'));
    await prisma.$disconnect();
    process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
  });
