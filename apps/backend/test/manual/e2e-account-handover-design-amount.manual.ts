/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (PostgreSQL thật) cho:
 *   1. "Tiền giao account" — cộng 40 USD đúng MỘT lần / account: đồng thời, retry, link + assign, unlink → link lại,
 *      chuyển A → B, rollback khi thao tác lỗi, chỉnh tay (409 khi số dư vừa đổi), sổ cái khớp số dư.
 *   2. TikTok Accounts — Password / 2FA mã hoá at-rest, không lộ ở list / detail, reveal có audit, sửa một trường
 *      không xoá trường khác, Ngày về tiền không lệch ngày, Onhold Amount khớp nguồn Hold của Dashboard.
 *   3. Design Amount — lợi nhuận đơn (TS == SQL) trừ đúng một lần; Seller Statistics cộng Design Amount không nhân
 *      theo line item, đúng bộ lọc seller / shop / thời gian; Est. profit & Current Profit trừ Design Amount; phí
 *      ship đã nằm trong Revenue không bị trừ lần hai.
 *
 * 🔴 CHỈ chạy trên database CỤC BỘ dùng một lần (script tự tạo Organization + dữ liệu riêng và KHÔNG dọn).
 *    Từ chối chạy nếu DATABASE_URL không trỏ tới localhost / 127.0.0.1.
 *
 * Chạy:
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db npx prisma migrate deploy
 *   DATABASE_URL=postgresql://user@127.0.0.1:55432/db node -r ts-node/register \
 *     test/manual/e2e-account-handover-design-amount.manual.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '../../src/common/services/encryption.service';
import { PrismaService } from '../../src/database/prisma.service';
import { AccountHandoverService } from '../../src/modules/employee/services/account-handover.service';
import { PodTiktokAccountMapper } from '../../src/modules/pod-tiktok/mappers/pod-tiktok-account.mapper';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodOrderRepository } from '../../src/modules/pod-tiktok/repositories/pod-order.repository';
import { PodTiktokAccountRepository } from '../../src/modules/pod-tiktok/repositories/pod-tiktok-account.repository';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { PodTiktokAccountInfoService } from '../../src/modules/pod-tiktok/services/pod-tiktok-account-info.service';
import { PodTiktokAccountService } from '../../src/modules/pod-tiktok/services/pod-tiktok-account.service';
import { TiktokEncryptionService } from '../../src/modules/pod-tiktok/services/tiktok-encryption.service';
import { sellerCurrentProfit, sellerEstProfit } from '../../src/modules/pod-tiktok/shared/dashboard-metrics';
import { orderProfitCtes } from '../../src/modules/pod-tiktok/shared/order-profit.sql';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('❌ Từ chối chạy: DATABASE_URL phải là database CỤC BỘ dùng một lần (localhost / 127.0.0.1).');
  process.exit(2);
}

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail !== '' ? ` — ${JSON.stringify(detail)}` : ''}`);
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? a == b : Math.abs(a - b) < 0.0001;

const ADMIN_SCOPE = { allShops: true, accountIds: [], shopIds: [] };

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const config = new ConfigService({
    account: { encryptionKey: randomBytes(32).toString('base64') },
    tiktok: { encryptionKey: randomBytes(32).toString('base64') },
    accountHandover: { creditAmount: 40 },
    orderLabelCost: { amount: 0.5, currency: 'USD' },
  });
  const handover = new AccountHandoverService(prisma, config);
  const repo = new PodTiktokAccountRepository(prisma);
  const tiktokEncryption = new TiktokEncryptionService(config);
  const run = randomUUID().slice(0, 8);

  // --- Fixture: tổ chức + role + Admin + 2 Seller ---
  const org = await prisma.organization.create({ data: { name: `E2E Handover ${run}`, slug: `e2e-handover-${run}` } });
  const roleOf = (code: string) =>
    prisma.role.create({ data: { organizationId: org.id, code, displayName: code } });
  const [adminRole, employeeRole] = [await roleOf('ADMIN'), await roleOf('EMPLOYEE')];
  const userOf = (name: string, roleId: string) =>
    prisma.user.create({
      data: { organizationId: org.id, roleId, email: `${name}-${run}@e2e.local`, passwordHash: 'x', fullName: name },
    });
  const admin = await userOf('admin', adminRole.id);
  const userA = await userOf('seller-a', employeeRole.id);
  const userB = await userOf('seller-b', employeeRole.id);
  const empA = await prisma.employee.create({ data: { organizationId: org.id, userId: userA.id } });
  const empB = await prisma.employee.create({ data: { organizationId: org.id, userId: userB.id } });

  const balanceOf = async (employeeId: string) =>
    Number((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).accountHandoverAmount);
  const ledgerOf = (employeeId: string) =>
    prisma.employeeAccountHandoverTransaction.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
  let accountSeq = 0;
  const newAccount = (sellerId: string | null = null) =>
    prisma.podTiktokAccount.create({
      data: {
        organizationId: org.id,
        accountName: `ACC-${run}-${++accountSeq}`,
        openId: `open-${run}-${accountSeq}`,
        userType: 0,
        accessTokenEnc: tiktokEncryption.encrypt('a'),
        accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
        refreshTokenEnc: tiktokEncryption.encrypt('r'),
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        status: 'ACTIVE',
        sellerId,
      },
    });
  const creditIn = (employeeId: string, tiktokAccountId: string, type: 'EMPLOYEE_LINK' | 'ADMIN_ASSIGN' = 'ADMIN_ASSIGN') =>
    prisma.$transaction((tx) =>
      handover.creditTiktokAccountHandover(tx, {
        organizationId: org.id,
        employeeId,
        tiktokAccountId,
        type,
        actorUserId: admin.id,
      }),
    );

  // TikTok client giả cho luồng link (không gọi TikTok thật).
  let linkOpenId = `link-open-${run}`;
  const authClient = {
    getAccessToken: async () => ({
      data: {
        access_token: 'TTP_access',
        access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 86_400,
        refresh_token: 'TTP_refresh',
        refresh_token_expire_in: Math.floor(Date.now() / 1000) + 180 * 86_400,
        open_id: linkOpenId,
        seller_name: 'Link Seller',
        seller_base_region: 'US',
        user_type: 0,
        granted_scopes: [],
      },
      requestId: 'req',
    }),
  };
  const apiClient = {
    getAuthorizedShops: async () => ({
      shops: [{ id: `shop-${linkOpenId}`, name: 'Linked shop', region: 'US', seller_type: 'LOCAL', cipher: 'c', code: 'x' }],
    }),
  };
  const accounts = new PodTiktokAccountService(
    prisma,
    repo,
    new PodTiktokAccountMapper(),
    tiktokEncryption,
    authClient as any,
    apiClient as any,
    handover,
  );
  (accounts as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  (handover as any).logger = { log: () => undefined };

  // ===========================================================================
  // 1. Tiền giao account
  // ===========================================================================
  {
    const acc = await newAccount();
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => creditIn(empA.id, acc.id)));
    const ledger = await prisma.employeeAccountHandoverTransaction.count({ where: { tiktokAccountId: acc.id } });
    check('đồng thời 10 request cho CÙNG account ⇒ đúng 1 lần cộng', outcomes.filter((o) => o.credited).length === 1 && ledger === 1, { ledger });
    check('số dư = 40 sau 10 request trùng', (await balanceOf(empA.id)) === 40, await balanceOf(empA.id));

    const retry = await creditIn(empA.id, acc.id);
    check('retry sau khi đã cộng ⇒ không cộng', !retry.credited && (await balanceOf(empA.id)) === 40);

    const otherEmployee = await creditIn(empB.id, acc.id);
    check('cùng account sang Employee khác ⇒ KHÔNG cộng (một account một lần)', !otherEmployee.credited && (await balanceOf(empB.id)) === 0);
  }
  {
    const accs = await Promise.all(Array.from({ length: 10 }, () => newAccount()));
    await Promise.all(accs.map((acc) => creditIn(empB.id, acc.id)));
    const ledger = await ledgerOf(empB.id);
    const afters = ledger.map((row) => Number(row.balanceAfter)).sort((a, b) => a - b);
    check('10 account KHÁC NHAU đồng thời cho một Employee ⇒ 400 (không mất cập nhật)', (await balanceOf(empB.id)) === 400, await balanceOf(empB.id));
    check('sổ cái: trước/sau nối tiếp 40 → 400 (khoá dòng FOR UPDATE)', JSON.stringify(afters) === JSON.stringify([40, 80, 120, 160, 200, 240, 280, 320, 360, 400]), afters);
  }
  {
    const acc = await newAccount();
    const before = await balanceOf(empA.id);
    await prisma
      .$transaction(async (tx) => {
        await handover.creditTiktokAccountHandover(tx, { organizationId: org.id, employeeId: empA.id, tiktokAccountId: acc.id, type: 'ADMIN_ASSIGN', actorUserId: admin.id });
        throw new Error('assign failed after credit');
      })
      .catch(() => undefined);
    const rows = await prisma.employeeAccountHandoverTransaction.count({ where: { tiktokAccountId: acc.id } });
    check('thao tác lỗi sau khi cộng ⇒ rollback: không sổ cái, không đổi số dư', rows === 0 && (await balanceOf(empA.id)) === before);
  }
  {
    // Luồng ADMIN assign thật (repository + service).
    const acc = await newAccount();
    const a0 = await balanceOf(empA.id);
    await accounts.assignSeller(org.id, admin.id, acc.id, { sellerId: empA.id });
    check('Admin giao account chưa có người phụ trách ⇒ +40 cho Employee được giao', (await balanceOf(empA.id)) === a0 + 40);
    check('Admin thao tác không có hồ sơ Employee ⇒ không bị cộng', (await prisma.employeeAccountHandoverTransaction.count({ where: { actorUserId: admin.id, employee: { userId: admin.id } } })) === 0);
    await accounts.assignSeller(org.id, admin.id, acc.id, { sellerId: empA.id });
    check('giao lại cùng người (retry) ⇒ không cộng', (await balanceOf(empA.id)) === a0 + 40);
    const b0 = await balanceOf(empB.id);
    await accounts.assignSeller(org.id, admin.id, acc.id, { sellerId: empB.id });
    check('chuyển A → B ⇒ A giữ nguyên, B không được cộng', (await balanceOf(empA.id)) === a0 + 40 && (await balanceOf(empB.id)) === b0);
    await accounts.assignSeller(org.id, admin.id, acc.id, { sellerId: null });
    await accounts.assignSeller(org.id, admin.id, acc.id, { sellerId: empA.id });
    check('bỏ phân công rồi giao lại ⇒ không cộng lần hai', (await balanceOf(empA.id)) === a0 + 40);

    const concurrent = await newAccount();
    const a1 = await balanceOf(empA.id);
    await Promise.allSettled(Array.from({ length: 5 }, () => accounts.assignSeller(org.id, admin.id, concurrent.id, { sellerId: empA.id })));
    check('5 lượt assign đồng thời cùng account ⇒ +40 đúng một lần', (await balanceOf(empA.id)) === a1 + 40, (await balanceOf(empA.id)) - a1);
  }
  {
    // Luồng Employee tự link (OAuth đã xác thực ⇒ actor = user của Seller A).
    const a0 = await balanceOf(empA.id);
    const linked = await accounts.completeAuthorization(org.id, userA.id, 'code', 'Self link');
    check('Employee tự link account MỚI ⇒ account gán cho họ + 40', linked.sellerId === empA.id && (await balanceOf(empA.id)) === a0 + 40);
    const ledgerRow = await prisma.employeeAccountHandoverTransaction.findFirst({ where: { tiktokAccountId: linked.id } });
    check('sổ cái ghi loại EMPLOYEE_LINK, actor = chính Employee', ledgerRow?.type === 'EMPLOYEE_LINK' && ledgerRow?.actorUserId === userA.id);
    await accounts.assignSeller(org.id, admin.id, linked.id, { sellerId: empA.id });
    check('account đã link rồi Admin assign lại cùng người ⇒ không cộng trùng', (await balanceOf(empA.id)) === a0 + 40);
    await accounts.unlink(org.id, admin.id, linked.id);
    await accounts.completeAuthorization(org.id, userA.id, 'code-2', 'Self link again');
    check('unlink rồi link lại ⇒ không cộng lần hai', (await balanceOf(empA.id)) === a0 + 40);
    const aBefore = await balanceOf(empA.id);
    linkOpenId = `admin-link-${run}`;
    const adminLinked = await accounts.completeAuthorization(org.id, admin.id, 'code-3', 'Admin link');
    check('Admin tự link ⇒ không gán, không cộng cho ai', adminLinked.sellerId === null && (await balanceOf(empA.id)) === aBefore);
    await accounts.assignSeller(org.id, admin.id, adminLinked.id, { sellerId: empB.id });
    const bLedger = await prisma.employeeAccountHandoverTransaction.findFirst({ where: { tiktokAccountId: adminLinked.id } });
    check('Admin link rồi giao cho B ⇒ B +40 (ADMIN_ASSIGN)', bLedger?.employeeId === empB.id && bLedger?.type === 'ADMIN_ASSIGN');
  }
  {
    const current = await balanceOf(empA.id);
    const conflict = await handover.setAmount(org.id, admin.id, empA.id, { amount: 1, expectedAmount: current - 40 }).then(
      () => 'ok',
      (error: any) => error?.response?.code,
    );
    check('chỉnh tay khi số dư đã đổi ⇒ 409 EMPLOYEE_ACCOUNT_HANDOVER_AMOUNT_CHANGED', conflict === 'EMPLOYEE_ACCOUNT_HANDOVER_AMOUNT_CHANGED', conflict);
    await handover.setAmount(org.id, admin.id, empA.id, { amount: 15, expectedAmount: current, note: 'điều chỉnh' });
    const last = (await ledgerOf(empA.id)).at(-1)!;
    check('chỉnh tay ghi MANUAL_ADJUSTMENT trước/sau', last.type === 'MANUAL_ADJUSTMENT' && Number(last.balanceBefore) === current && Number(last.balanceAfter) === 15);
    for (const employee of [empA, empB]) {
      const sum = (await ledgerOf(employee.id)).reduce((total, row) => total + Number(row.amount), 0);
      check(`sổ cái khớp số dư (${employee.id === empA.id ? 'A' : 'B'})`, near(sum, await balanceOf(employee.id)), { sum });
    }
    const page = await handover.listTransactions(org.id, empA.id, 1, 5);
    check('lịch sử phân trang, mới nhất trước, có tên người thao tác', page.items.length === 5 && page.items[0].type === 'MANUAL_ADJUSTMENT' && page.items[0].actorName === 'admin');
    const negative = await prisma.$executeRaw`UPDATE employees SET account_handover_amount = -1 WHERE id = ${empA.id}::uuid`.then(() => 'ok', () => 'rejected');
    check('CHECK DB: Tiền giao account không âm', negative === 'rejected');
  }

  // ===========================================================================
  // 2. TikTok Accounts — credential, ngày về tiền, onhold
  // ===========================================================================
  const acc = await newAccount(empA.id);
  const shop = await prisma.podTiktokShop.create({
    data: { organizationId: org.id, accountId: acc.id, tiktokShopId: `ts-${run}`, shopCipherEnc: 'x', name: 'Shop A', region: 'US', sellerType: 'LOCAL' },
  });
  {
    const info = new PodTiktokAccountInfoService(prisma, repo, new EncryptionService(config), accounts);
    (info as any).logger = { log: () => undefined, warn: () => undefined };
    const PASSWORD = 'P@ss w0rd-ÜNIQUE';
    const TOTP = 'JBSWY3DPEHPK3PXP';
    const detail = await info.updateLoginInfo(org.id, admin.id, acc.id, {
      tiktokMail: 'shop.a@gmail.com',
      tiktokPassword: PASSWORD,
      tiktokTwoFactorCode: TOTP,
      moneyReturnDate: '2026-11-05',
    }, ADMIN_SCOPE);
    const raw = await prisma.podTiktokAccount.findUniqueOrThrow({ where: { id: acc.id } });
    check('Password / 2FA lưu MÃ HOÁ (không phải plaintext)', raw.tiktokPasswordEnc?.startsWith('v1.') === true && !raw.tiktokPasswordEnc.includes(PASSWORD) && raw.tiktokTwoFactorEnc !== TOTP);
    check('response detail không chứa credential', !JSON.stringify(detail).includes(PASSWORD) && !JSON.stringify(detail).includes(TOTP) && detail.hasTiktokPassword && detail.hasTiktokTwoFactorCode);
    check('Ngày về tiền đọc lại đúng ngày (không lệch múi giờ)', detail.moneyReturnDate === '2026-11-05', detail.moneyReturnDate);

    await info.updateLoginInfo(org.id, admin.id, acc.id, { moneyReturnDate: '2026-12-01' }, ADMIN_SCOPE);
    const revealed = await info.revealCredentials(org.id, admin.id, acc.id, ADMIN_SCOPE);
    check('sửa một trường KHÔNG xoá Password / 2FA đã lưu', revealed.tiktokPassword === PASSWORD && revealed.tiktokTwoFactorCode === TOTP);
    const audits = await prisma.podTiktokAccountCredentialAudit.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: 'asc' } });
    check('audit: UPDATE (chỉ tên trường) + REVEAL, không có giá trị', audits.map((a) => a.action).join(',') === 'UPDATE,REVEAL' && !JSON.stringify(audits).includes(PASSWORD) && !JSON.stringify(audits).includes(TOTP), audits.map((a) => a.fields));

    await info.updateLoginInfo(org.id, admin.id, acc.id, { moneyReturnDate: null, tiktokTwoFactorCode: null }, ADMIN_SCOPE);
    const cleared = await info.revealCredentials(org.id, admin.id, acc.id, ADMIN_SCOPE);
    const afterClear = await accounts.findOne(org.id, acc.id);
    check('null = xoá (2FA, ngày); Password giữ nguyên', cleared.tiktokTwoFactorCode === null && cleared.tiktokPassword === PASSWORD && afterClear.moneyReturnDate === null);

    const outOfScope = await info.revealCredentials(org.id, userB.id, acc.id, { allShops: false, accountIds: [], shopIds: [] }).then(() => 'ok', (e: any) => e?.response?.code ?? e?.message);
    check('ngoài phạm vi shop ⇒ không reveal được', outOfScope !== 'ok', outOfScope);
  }
  {
    const hold = (id: string, currency: string, amount: number) =>
      prisma.podTiktokUnsettledTransaction.create({
        data: { organizationId: org.id, accountId: acc.id, shopId: shop.id, tiktokTransactionId: `hold-${run}-${id}`, type: 'ADJUSTMENT', currency, estSettlementAmount: new Prisma.Decimal(amount), fetchedAt: new Date() },
      });
    await hold('1', 'USD', 10.25);
    await hold('2', 'USD', 4.75);
    await hold('3', 'GBP', 3);
    const list = await accounts.findAll(org.id, { search: acc.accountName }, ADMIN_SCOPE);
    const item = list.items.find((row) => row.id === acc.id)!;
    const dashboard = new PodDashboardRepository(prisma);
    const totals = await dashboard.holdTotals({ organizationId: org.id, currency: 'USD', accountIds: [acc.id] });
    check('Onhold Amount theo đơn vị tiền', JSON.stringify(item.onholdAmounts) === JSON.stringify([{ currency: 'GBP', amount: 3 }, { currency: 'USD', amount: 15 }]), item.onholdAmounts);
    check('Onhold Amount (USD) = thẻ Hold của Dashboard cho cùng account', Number(totals.find((t) => t.currency === 'USD')?.amount) === 15);
    check('list không chứa ciphertext', !JSON.stringify(list).includes('v1.'));
  }

  // ===========================================================================
  // 3. Design Amount — lợi nhuận đơn & Seller Statistics
  // ===========================================================================
  const accB = await newAccount(empB.id);
  const shopB = await prisma.podTiktokShop.create({
    data: { organizationId: org.id, accountId: accB.id, tiktokShopId: `tsb-${run}`, shopCipherEnc: 'x', name: 'Shop B', region: 'US', sellerType: 'LOCAL' },
  });
  const fAccount = await prisma.fulfillmentAccount.create({ data: { organizationId: org.id, provider: 'CUSTOM', name: 'E2E provider' } });
  const inWindow = new Date('2026-10-10T05:00:00.000Z');
  const outWindow = new Date('2026-09-01T05:00:00.000Z');
  let orderSeq = 0;
  const order = async (opts: {
    account: { id: string };
    shop: { id: string };
    at: Date;
    design?: number;
    currency?: string;
    items?: number;
    proceeds?: number;
    shipCost?: number;
    baseCost?: number;
  }) => {
    const tiktokOrderId = `o-${run}-${++orderSeq}`;
    const created = await prisma.podOrder.create({
      data: {
        organizationId: org.id,
        accountId: opts.account.id,
        shopId: opts.shop.id,
        tiktokOrderId,
        status: 'AWAITING_SHIPMENT',
        currency: opts.currency ?? 'USD',
        shippingType: 'TIKTOK',
        tiktokCreateTime: BigInt(Math.floor(opts.at.getTime() / 1000)),
        tiktokUpdateTime: BigInt(Math.floor(opts.at.getTime() / 1000)),
        orderedAt: opts.at,
        tiktokUpdatedAt: opts.at,
        payloadHash: 'h'.repeat(64),
        rawPayload: {},
        syncSource: 'MANUAL',
        lastSyncedAt: new Date(),
        // `design` không truyền ⇒ dựa vào DEFAULT 0 của cột (dữ liệu cũ).
        ...(opts.design !== undefined ? { designAmount: new Prisma.Decimal(opts.design) } : {}),
        items: {
          create: Array.from({ length: opts.items ?? 1 }, (_, i) => ({ organizationId: org.id, tiktokLineItemId: `${tiktokOrderId}-li-${i}`, payloadHash: 'h' })),
        },
      },
    });
    if (opts.proceeds !== undefined) {
      await prisma.podTiktokUnsettledTransaction.create({
        data: { organizationId: org.id, accountId: opts.account.id, shopId: opts.shop.id, tiktokTransactionId: `tx-${tiktokOrderId}`, type: 'ORDER', tiktokOrderId, currency: opts.currency ?? 'USD', estSettlementAmount: new Prisma.Decimal(opts.proceeds), estShippingCostAmount: new Prisma.Decimal(opts.shipCost ?? 0), fetchedAt: new Date() },
      });
    }
    if (opts.baseCost !== undefined) {
      await prisma.fulfillmentOrder.create({
        data: {
          organizationId: org.id, accountId: fAccount.id, provider: 'CUSTOM', podOrderId: created.id,
          externalOrderId: `E2E-${tiktokOrderId}`.slice(0, 40), status: 'SHIPPED', submittedAt: new Date(), currency: opts.currency ?? 'USD',
          items: { create: [{ organizationId: org.id, providerSku: 'E2E', quantity: 1, baseCost: new Prisma.Decimal(opts.baseCost), baseCostConfirmedAt: new Date() }] },
        },
      });
    }
    return created;
  };

  // Seller A: O1 (3 line item, design 5.25), O2 (design 0), O3 ngoài khoảng (design 10), O4 cũ (không truyền design).
  // TikTok đã tính phí ship (est_shipping_cost −5) ⇒ phí ship ĐÃ nằm trong tiền thu về.
  const o1 = await order({ account: acc, shop, at: inWindow, design: 5.25, items: 3, proceeds: 100, shipCost: -5, baseCost: 20 });
  const o2 = await order({ account: acc, shop, at: inWindow, design: 0, proceeds: 100, shipCost: -5, baseCost: 20 });
  const o3 = await order({ account: acc, shop, at: outWindow, design: 10, proceeds: 100, shipCost: -5, baseCost: 20 });
  const o4 = await order({ account: acc, shop, at: inWindow, proceeds: 50, shipCost: -5, baseCost: 10 });
  // Seller B: O5 design 2, chưa có dữ liệu tài chính.
  const o5 = await order({ account: accB, shop: shopB, at: inWindow, design: 2 });
  // Đơn GBP có design ⇒ không quy đổi ⇒ lợi nhuận "—".
  const o6 = await order({ account: accB, shop: shopB, at: inWindow, design: 3, currency: 'GBP', proceeds: 80, shipCost: -4, baseCost: 10 });

  const finance = new PodOrderFinanceService(prisma, config);
  const label = finance.labelCost();
  const all = [o1, o2, o3, o4, o5, o6];
  const ts = await finance.summarize(org.id, all);
  const sqlRows = await prisma.$queryRaw<Array<{ id: string; profit: Prisma.Decimal | null; design_amount: Prisma.Decimal }>>(Prisma.sql`
    WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po WHERE po.id IN (${Prisma.join(all.map((x) => Prisma.sql`${x.id}::uuid`))})),
    ${orderProfitCtes(org.id, label)}
    SELECT id, profit, design_amount FROM order_profit`);
  const sql = new Map(sqlRows.map((row) => [row.id, row]));
  check('đơn cũ không truyền design ⇒ DEFAULT 0', Number(sql.get(o4.id)!.design_amount) === 0 && ts.get(o4.id)!.designAmount === 0);
  check('lợi nhuận O1 = 100 − 20 − 0.5 − 5.25 = 74.25 (phí ship đã trong tiền thu về không trừ lại)', ts.get(o1.id)!.profit === 74.25, ts.get(o1.id)!.profit);
  check('Design Amount = 0 ⇒ y như công thức cũ: O2 = 79.5', ts.get(o2.id)!.profit === 79.5);
  {
    // Label cấu hình GBP để đơn GBP qua được bước label ⇒ chạm đúng nhánh Design Amount (USD) khác đơn vị tiền.
    const gbpLabel = { amount: 0.5, currency: 'GBP' };
    const gbpFinance = new PodOrderFinanceService(prisma, new ConfigService({ orderLabelCost: gbpLabel }));
    const gbpTs = await gbpFinance.summarize(org.id, [o6]);
    const [gbpSql] = await prisma.$queryRaw<Array<{ profit: Prisma.Decimal | null }>>(Prisma.sql`
      WITH o AS (SELECT po.id, po.tiktok_order_id, po.shop_id FROM pod_orders po WHERE po.id = ${o6.id}::uuid),
      ${orderProfitCtes(org.id, gbpLabel)}
      SELECT profit FROM order_profit`);
    check('Design Amount ≠ 0 trên đơn GBP ⇒ DESIGN_CURRENCY_MISMATCH (TS) & NULL (SQL), không quy đổi', gbpTs.get(o6.id)!.status === 'DESIGN_CURRENCY_MISMATCH' && gbpSql.profit === null, gbpTs.get(o6.id)!.status);
  }
  const mismatches = all.filter((x) => !near(ts.get(x.id)!.profit, sql.get(x.id)!.profit === null ? null : Number(sql.get(x.id)!.profit)));
  check('TS (màn Order) == SQL (Dashboard / Thống kê nhân viên) cho mọi đơn', mismatches.length === 0, mismatches.map((m) => m.id));

  const orderRepo = new PodOrderRepository(prisma);
  const previous = await orderRepo.updateDesignAmount(org.id, o2.id, new Prisma.Decimal(1.5), admin.id);
  const ts2 = await finance.summarize(org.id, [o2]);
  check('cập nhật Design Amount: trả giá trị cũ, lợi nhuận tính lại 79.5 − 1.5 = 78', Number(previous) === 0 && ts2.get(o2.id)!.profit === 78, ts2.get(o2.id)!.profit);
  check('cập nhật Design Amount đơn tổ chức khác ⇒ không tìm thấy', (await orderRepo.updateDesignAmount(randomUUID(), o2.id, new Prisma.Decimal(9), admin.id)) === null);
  const negativeDesign = await prisma.$executeRaw`UPDATE pod_orders SET design_amount = -1 WHERE id = ${o2.id}::uuid`.then(() => 'ok', () => 'rejected');
  check('CHECK DB: Design Amount không âm', negativeDesign === 'rejected');

  const dashboard = new PodDashboardRepository(prisma);
  const window = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T23:59:59.999Z') };
  const stats = async (filter: Partial<{ shopId: string; sellerId: string }> = {}, w = window) =>
    (await dashboard.sellerStats({ organizationId: org.id, currency: 'USD', accountIds: null, ...filter }, w, {
      activeOnly: false, sort: 'designAmount', order: 'desc', page: 1, limit: 50, label,
    })).items;
  const rows = await stats();
  const rowA = rows.find((r) => r.sellerId === empA.id)!;
  const rowB = rows.find((r) => r.sellerId === empB.id)!;
  check('Seller A Design Amount = 5.25 + 1.5 + 0 (không nhân 3 line item, không tính O3 ngoài khoảng)', Number(rowA.designAmount) === 6.75, rowA.designAmount);
  check('Seller B Design Amount = 2 (đơn USD; đơn GBP không thuộc khoảng tiền đang xem)', Number(rowB.designAmount) === 2, rowB.designAmount);
  const estA = Number(sellerEstProfit(rowA));
  // Revenue 250 − Base 50 − Label 1.5 − (Shipping 15 − đã trong revenue 15) − Design 6.75 = 191.75
  check('Est. profit A = 250 − 50 − 1.5 − 0 − 6.75 = 191.75 (phí ship không trừ hai lần)', estA === 191.75, { estA, row: rowA });
  check('ORDER BY profit (SQL) khớp giá trị hiển thị', near(Number(rowA.profit), estA));
  const currentA = Number(sellerCurrentProfit(rowA));
  check('Current Profit A = Paid 0 − 50 − 1.5 − 15 − 6.75 = −73.25', currentA === -73.25, currentA);
  check('sắp xếp theo Design Amount giảm dần', rows[0].sellerId === empA.id);
  const onlyB = await stats({ sellerId: empB.id });
  check('lọc seller B ⇒ chỉ dòng B', onlyB.length === 1 && onlyB[0].sellerId === empB.id);
  const shopFilter = await stats({ shopId: shop.id });
  check('lọc shop A ⇒ B có Design Amount 0', Number(shopFilter.find((r) => r.sellerId === empB.id)?.designAmount ?? 0) === 0 && Number(shopFilter.find((r) => r.sellerId === empA.id)!.designAmount) === 6.75);
  const septStats = await stats({}, { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T23:59:59.999Z') });
  check('khoảng tháng 9 ⇒ chỉ O3 (design 10)', Number(septStats.find((r) => r.sellerId === empA.id)!.designAmount) === 10);
  const gbp = (await dashboard.sellerStats({ organizationId: org.id, currency: 'GBP', accountIds: null }, window, { activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 50, label })).items;
  const gbpB = gbp.find((r) => r.sellerId === empB.id)!;
  check('xem GBP có Design Amount (USD) ⇒ Design / Est. profit / Current Profit = "—" (không quy đổi)', gbpB.designAmount === null && gbpB.profit === null && sellerEstProfit(gbpB) === null);

  await prisma.$disconnect();
  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('❌')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
