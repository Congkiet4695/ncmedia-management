/**
 * BACKFILL Global Catalog — chiếu danh mục CŨ (`fulfillment_catalogues / products / variants`) của mọi tài
 * khoản sang lớp mới (`provider_catalog_*` + `fulfillment_account_*`).
 *
 * Dùng CHÍNH hàm dual write chạy sau mỗi lượt đồng bộ (`FulfillmentGlobalCatalogRepository`) — không có
 * luật chuẩn hoá thứ hai. Không gọi API nhà cung cấp. KHÔNG đọc/ghi Product Mapping, Design, đơn hàng hay
 * Base Cost; KHÔNG sửa/xoá bảng cũ.
 *
 * Mặc định CHẠY THỬ: mọi tài khoản trong MỘT transaction rồi ROLLBACK ⇒ báo cáo đúng như khi chạy thật,
 * không ghi gì. Ghi thật phải truyền `--apply` (mỗi tài khoản một transaction, chạy lại bao nhiêu lần cũng
 * không sinh bản ghi trùng).
 *
 * Chạy:
 *   node -r ts-node/register -r dotenv/config scripts/backfill-global-catalog.ts              # dry-run
 *   node -r ts-node/register -r dotenv/config scripts/backfill-global-catalog.ts --apply      # ghi
 *   … --provider MANGO|SELLERWIX --account <fulfillmentAccountId>
 *
 * Xung đột metadata giữa các tài khoản: bản có `synced_at` MỚI HƠN thắng (tất định, không phụ thuộc thứ tự
 * chạy); mọi xung đột được đếm + lấy mẫu trong báo cáo, payload nguyên văn của từng tài khoản vẫn nằm ở
 * lớp theo tài khoản. Kiểm tra sau khi chạy: scripts/verify-global-catalog.ts (chỉ SELECT).
 */
import { FulfillmentProvider, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import {
  FulfillmentGlobalCatalogRepository,
  type GlobalCatalogProjectionReport,
  type GlobalLevelReport,
} from '../src/modules/fulfillment/repositories/fulfillment-global-catalog.repository';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sumLevel(
  reports: GlobalCatalogProjectionReport[],
  pick: (r: GlobalCatalogProjectionReport) => GlobalLevelReport,
) {
  return reports.reduce(
    (acc, report) => {
      const level = pick(report);
      acc.processed += level.processed;
      acc.inserted += level.inserted;
      acc.reused += level.reused;
      acc.conflicts += level.conflicts;
      acc.conflictsSkipped += level.conflictsSkipped;
      return acc;
    },
    { processed: 0, inserted: 0, reused: 0, conflicts: 0, conflictsSkipped: 0 },
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const accountArg = argValue('--account');
  const providerArg = argValue('--provider')?.toUpperCase();
  if (providerArg && !(providerArg in FulfillmentProvider))
    throw new Error(`--provider không hợp lệ: ${providerArg}`);

  const prisma = new PrismaClient();
  const repo = new FulfillmentGlobalCatalogRepository(prisma as unknown as PrismaService);
  try {
    // Thứ tự: tài khoản đồng bộ CŨ trước, MỚI sau — chỉ để log dễ đọc; kết quả không phụ thuộc thứ tự.
    const accounts = await prisma.$queryRaw<
      Array<{ id: string; provider: FulfillmentProvider; last: Date | null }>
    >`
      SELECT a.id, a.provider, MAX(p.synced_at) AS last
      FROM fulfillment_accounts a
      JOIN fulfillment_products p ON p.account_id = a.id AND p.deleted_at IS NULL
      WHERE a.deleted_at IS NULL
        AND (${accountArg ?? null}::uuid IS NULL OR a.id = ${accountArg ?? null}::uuid)
        AND (${providerArg ?? null}::text IS NULL OR a.provider::text = ${providerArg ?? null}::text)
      GROUP BY a.id, a.provider
      ORDER BY MAX(p.synced_at) ASC NULLS FIRST, a.id ASC`;

    console.log(
      `Global Catalog backfill — ${apply ? 'APPLY (ghi thật)' : 'DRY-RUN (rollback, không ghi)'}`,
    );
    console.log(`Tài khoản có danh mục: ${accounts.length}`);

    const reports: GlobalCatalogProjectionReport[] = [];
    const errors: Array<{ accountId: string; message: string }> = [];
    if (apply) {
      for (const account of accounts) {
        try {
          reports.push(await repo.projectAccount(account.id, account.provider));
        } catch (error) {
          errors.push({ accountId: account.id, message: (error as Error).message });
        }
      }
    } else {
      reports.push(...(await repo.dryRunAccounts(accounts)));
    }

    for (const r of reports) {
      console.log(
        `- ${r.provider} ${r.accountId}: ` +
          `products +${r.products.inserted}/=${r.products.reused} (conflict ${r.products.conflicts}, skipped ${r.products.conflictsSkipped}) · ` +
          `variants +${r.variants.inserted}/=${r.variants.reused} (conflict ${r.variants.conflicts}, skipped ${r.variants.conflictsSkipped}) · ` +
          `account products +${r.accountProducts.inserted}/~${r.accountProducts.updated} · ` +
          `account variants +${r.accountVariants.inserted}/~${r.accountVariants.updated} · ${r.durationMs} ms`,
      );
      const samples = [
        ...r.catalogues.conflictSample,
        ...r.products.conflictSample,
        ...r.variants.conflictSample,
      ];
      if (samples.length > 0) console.log(`    conflict sample: ${samples.join(', ')}`);
    }

    const total = {
      catalogues: sumLevel(reports, (r) => r.catalogues),
      products: sumLevel(reports, (r) => r.products),
      variants: sumLevel(reports, (r) => r.variants),
      accountCatalogues: reports.reduce(
        (n, r) => n + r.accountCatalogues.inserted + r.accountCatalogues.updated,
        0,
      ),
      accountProducts: {
        inserted: reports.reduce((n, r) => n + r.accountProducts.inserted, 0),
        updated: reports.reduce((n, r) => n + r.accountProducts.updated, 0),
      },
      accountVariants: {
        inserted: reports.reduce((n, r) => n + r.accountVariants.inserted, 0),
        updated: reports.reduce((n, r) => n + r.accountVariants.updated, 0),
      },
      errors,
    };
    console.log('\nGlobal Catalog Backfill Report');
    console.log(JSON.stringify(total, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
