/* eslint-disable */
/**
 * Đối chiếu CHỈ-ĐỌC (database thật) cho các thay đổi 2026-10-14:
 *   - Dashboard "Tất cả thời gian": ngày sớm nhất == truy vấn độc lập; số liệu all-time == cửa sổ không giới hạn.
 *   - Popup Hold / Trạng thái shop: cột Seller Employee == employee của `pod_tiktok_accounts.seller_id` (truy vấn độc
 *     lập), đọc hết mọi trang; số dòng / tổng không đổi so với thẻ.
 *   - TikTok Accounts: bộ lọc Active / Inactive (trạng thái shop) + Seller được assign (kể cả Chưa assign) + kết hợp;
 *     meta.total / totalShops == đếm độc lập; đọc hết mọi trang không trùng / không sót kết nối.
 *
 * Chạy:  node -r ts-node/register/transpile-only -r dotenv/config test/manual/verify-dashboard-accounts-filters.manual.ts
 *
 * 🔴 KHÔNG ghi gì: mọi truy vấn nằm trong MỘT transaction `READ ONLY`, không dựng AppModule (không khởi động cron).
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { PodDashboardRepository } from '../../src/modules/pod-tiktok/repositories/pod-dashboard.repository';
import { PodTiktokAccountRepository } from '../../src/modules/pod-tiktok/repositories/pod-tiktok-account.repository';
import { PodOrderFinanceService } from '../../src/modules/pod-tiktok/services/pod-order-finance.service';
import { resolveAllTimeRange } from '../../src/modules/pod-tiktok/shared/dashboard-metrics';

const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
/** Múi giờ của fixture gốc (UTC+7, không đổi giờ mùa hè) — giữ nguyên ý nghĩa các phép so. */
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const config = { get: (_key: string, fallback: unknown) => fallback } as never;
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const db = tx as unknown as PrismaService;
        const dash = new PodDashboardRepository(db);
        // Client của transaction tương tác không có `$transaction` lồng ⇒ chạy mảng truy vấn tuần tự trên CÙNG tx READ ONLY.
        const accountsDb = new Proxy(db, {
          get: (target, prop) =>
            prop === '$transaction'
              ? (queries: Array<Promise<unknown>>) => Promise.all(queries)
              : (target as unknown as Record<string | symbol, unknown>)[prop],
        });
        const accounts = new PodTiktokAccountRepository(accountsDb);
        const label = new PodOrderFinanceService(db, config).labelCost();

        const orgs = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT DISTINCT organization_id AS id FROM pod_tiktok_accounts WHERE deleted_at IS NULL`);

        for (const { id: org } of orgs) {
          const tag = `[org ${org.slice(0, 8)}]`;
          const [{ currency }] = await db.$queryRaw<Array<{ currency: string }>>(Prisma.sql`
            SELECT COALESCE((SELECT currency FROM pod_orders WHERE organization_id = ${org}::uuid AND deleted_at IS NULL
                              GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1), 'USD') AS currency`);
          const filter = { organizationId: org, currency, accountIds: null };

          // --- Tất cả thời gian ---------------------------------------------------------------
          const earliest = await dash.earliestActivityDay(filter, TIME_ZONE);
          const [naive] = await db.$queryRaw<Array<{ day: string | null }>>(Prisma.sql`
            SELECT to_char((MIN(at) AT TIME ZONE 'UTC') + INTERVAL '7 hours', 'YYYY-MM-DD') AS day FROM (
              SELECT ordered_at AS at FROM pod_orders WHERE organization_id = ${org}::uuid AND deleted_at IS NULL
              UNION ALL SELECT COALESCE(paid_at, payment_created_at) FROM pod_tiktok_payments WHERE organization_id = ${org}::uuid AND deleted_at IS NULL
              UNION ALL SELECT statement_at FROM pod_tiktok_statements WHERE organization_id = ${org}::uuid AND deleted_at IS NULL) x`);
          check(`${tag} Ngày sớm nhất (all-time) == truy vấn độc lập (${earliest})`, earliest === naive.day, { earliest, naive: naive.day });

          const all = resolveAllTimeRange(earliest, TIME_ZONE);
          const unbounded = { from: new Date('2000-01-01T00:00:00Z'), before: all.before };
          const opts = { activeOnly: false, sort: 'orders' as const, order: 'desc' as const, page: 1, limit: 500, label };
          const [a, b] = [await dash.sellerStats(filter, all, opts), await dash.sellerStats(filter, unbounded, opts)];
          const sum = (rows: typeof a.items, key: 'orders' | 'revenue' | 'paid') => rows.reduce((s, r) => s + Number(r[key]), 0);
          check(
            `${tag} All-time (${all.days} ngày, > 366 được phép) không sót dữ liệu so với cửa sổ không giới hạn`,
            (['orders', 'revenue', 'paid'] as const).every((key) => Math.abs(sum(a.items, key) - sum(b.items, key)) < 0.005),
            { orders: sum(a.items, 'orders'), revenue: sum(a.items, 'revenue').toFixed(2) },
          );

          // --- Seller Employee trong hai popup ------------------------------------------------
          const expectedSeller = new Map(
            (
              await db.$queryRaw<Array<{ shop_id: string; seller_id: string | null; name: string | null }>>(Prisma.sql`
                SELECT s.id AS shop_id, a.seller_id, COALESCE(NULLIF(u.full_name, ''), u.email) AS name
                  FROM pod_tiktok_shops s JOIN pod_tiktok_accounts a ON a.id = s.account_id
                  LEFT JOIN employees e ON e.id = a.seller_id LEFT JOIN users u ON u.id = e.user_id
                 WHERE s.organization_id = ${org}::uuid`)
            ).map((row) => [row.shop_id, row]),
          );
          const holdRows: Array<{ shopId: string; sellerId: string | null; sellerName: string | null; amount: string }> = [];
          for (let page = 1; ; page += 1) {
            const res = await dash.holdShops(filter, { page, limit: 100 });
            holdRows.push(...res.items);
            if (holdRows.length >= res.total || res.items.length === 0) break;
          }
          const holdTotal = (await dash.holdTotals(filter)).find((row) => row.currency === currency);
          const holdBad = holdRows.filter((row) => {
            const exp = expectedSeller.get(row.shopId);
            return (exp?.seller_id ?? null) !== row.sellerId || (exp?.name ?? null) !== row.sellerName;
          });
          check(
            `${tag} Popup Hold: Seller Employee đúng ${holdRows.length} shop (${holdRows.filter((r) => !r.sellerId).length} chưa gán); số shop == thẻ`,
            holdBad.length === 0 && holdRows.length === (holdTotal?.shopCount ?? 0),
            holdBad.slice(0, 3),
          );

          const statuses = await dash.shopStatuses(filter);
          for (const status of ['ACTIVE', 'INACTIVE'] as const) {
            const rows: Array<{ shopId: string; sellerId: string | null; sellerName: string | null }> = [];
            for (let page = 1; ; page += 1) {
              const res = await dash.shopsByStatus(filter, status, { page, limit: 100 });
              rows.push(...res.items);
              if (rows.length >= res.total || res.items.length === 0) break;
            }
            const bad = rows.filter((row) => {
              const exp = expectedSeller.get(row.shopId);
              return (exp?.seller_id ?? null) !== row.sellerId || (exp?.name ?? null) !== row.sellerName;
            });
            const cardCount = statuses.find((row) => row.status === status)?.count ?? 0;
            check(`${tag} Popup ${status === 'ACTIVE' ? 'Live' : 'Die'}: Seller Employee đúng ${rows.length} shop; số dòng == thẻ (${cardCount})`, bad.length === 0 && rows.length === cardCount, bad.slice(0, 3));
          }

          // --- TikTok Accounts: bộ lọc + tổng shop ----------------------------------------------
          const sellers = await db.$queryRaw<Array<{ seller_id: string }>>(Prisma.sql`
            SELECT seller_id FROM pod_tiktok_accounts WHERE organization_id = ${org}::uuid AND deleted_at IS NULL AND seller_id IS NOT NULL
             GROUP BY seller_id ORDER BY COUNT(*) DESC LIMIT 1`);
          const sellerId = sellers[0]?.seller_id;
          const combos: Array<{ name: string; shopStatus?: 'ACTIVE' | 'INACTIVE'; sellerId?: string | null }> = [
            { name: 'Tất cả' },
            { name: 'Active', shopStatus: 'ACTIVE' },
            { name: 'Inactive', shopStatus: 'INACTIVE' },
            { name: 'Chưa assign', sellerId: null },
            ...(sellerId ? [{ name: 'Seller', sellerId }, { name: 'Active + Seller', shopStatus: 'ACTIVE' as const, sellerId }, { name: 'Inactive + Seller', shopStatus: 'INACTIVE' as const, sellerId }] : []),
          ];
          for (const combo of combos) {
            const accountCond = Prisma.sql`a.organization_id = ${org}::uuid AND a.deleted_at IS NULL
              ${combo.sellerId === undefined ? Prisma.empty : combo.sellerId === null ? Prisma.sql`AND a.seller_id IS NULL` : Prisma.sql`AND a.seller_id = ${combo.sellerId}::uuid`}
              ${combo.shopStatus ? Prisma.sql`AND EXISTS (SELECT 1 FROM pod_tiktok_shops x WHERE x.account_id = a.id AND x.deleted_at IS NULL AND x.status = ${combo.shopStatus}::"pod_tiktok_shop_status")` : Prisma.empty}`;
            const [expected] = await db.$queryRaw<Array<{ accounts: bigint; shops: bigint }>>(Prisma.sql`
              SELECT (SELECT COUNT(*) FROM pod_tiktok_accounts a WHERE ${accountCond})::bigint AS accounts,
                     (SELECT COUNT(DISTINCT s.id) FROM pod_tiktok_shops s JOIN pod_tiktok_accounts a ON a.id = s.account_id
                       WHERE ${accountCond} AND s.deleted_at IS NULL AND s.organization_id = ${org}::uuid
                       ${combo.shopStatus ? Prisma.sql`AND s.status = ${combo.shopStatus}::"pod_tiktok_shop_status"` : Prisma.empty})::bigint AS shops`);
            const ids = new Set<string>();
            let total = -1;
            let totalShops = -1;
            for (let page = 1; ; page += 1) {
              const res = await accounts.findMany(org, { page, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', shopStatus: combo.shopStatus, sellerId: combo.sellerId });
              res.items.forEach((item) => ids.add(item.id));
              total = res.total;
              totalShops = res.totalShops;
              if (page * 20 >= res.total) break;
            }
            check(
              `${tag} Accounts [${combo.name}]: meta.total ${total} · totalShops ${totalShops} == đếm độc lập; đọc hết mọi trang không trùng`,
              total === Number(expected.accounts) && totalShops === Number(expected.shops) && ids.size === total,
              { expected: { accounts: Number(expected.accounts), shops: Number(expected.shops) }, uniqueIds: ids.size },
            );
          }
          const options = await accounts.findAssignedSellers(org);
          const [assigned] = await db.$queryRaw<Array<{ sellers: bigint; unassigned: bigint }>>(Prisma.sql`
            SELECT COUNT(DISTINCT seller_id)::bigint AS sellers, COUNT(*) FILTER (WHERE seller_id IS NULL)::bigint AS unassigned
              FROM pod_tiktok_accounts WHERE organization_id = ${org}::uuid AND deleted_at IS NULL`);
          check(
            `${tag} Lựa chọn "Seller được assign": ${options.sellers.length} seller, ${options.unassignedAccounts} kết nối chưa assign`,
            options.sellers.length === Number(assigned.sellers) && options.unassignedAccounts === Number(assigned.unassigned),
          );
        }
      },
      { timeout: 600_000, maxWait: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
  console.log(results.join('\n'));
  if (results.some((line) => line.startsWith('❌'))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
