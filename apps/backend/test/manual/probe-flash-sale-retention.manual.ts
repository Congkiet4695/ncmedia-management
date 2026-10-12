/* eslint-disable */
/**
 * Kiểm chứng CHỈ ĐỌC cơ chế retention Flash Sale trên database thật (docs/pod-flash-sale/retention.md):
 *   1. Thống kê số dòng đủ điều kiện theo mốc 7/14/30/60/90/180 ngày (đúng SQL của service).
 *   2. Dry-run với các số ngày truyền vào.
 *   3. `EXPLAIN` (KHÔNG ANALYZE — không thực thi) câu DELETE theo lô của từng hạng mục: kiểm cú pháp + kế hoạch.
 *
 * 🔴 An toàn: mọi truy vấn chạy trong transaction `READ ONLY` + `statement_timeout`; `$executeRaw` bị thay
 * bằng hàm NÉM LỖI — không có đường nào xoá được dữ liệu. Không dựng AppModule (không kéo theo cron).
 *
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/probe-flash-sale-retention.manual.ts [syncLogDays logDays deletedItemDays closedItemDays]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import {
  FLASH_SALE_RETENTION_CATEGORIES,
  PodFlashSaleRetentionService,
} from '../../src/modules/pod-flash-sale/services/pod-flash-sale-retention.service';

async function main() {
  const [sync, other, deleted, closed] = process.argv.slice(2).map((v) => (v && v !== '-' ? Number(v) : null));
  const prisma = new PrismaClient();
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
      const [{ db }] = await tx.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
      console.log('database:', db, '(READ ONLY)');

      const readOnly = {
        $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql),
        $executeRaw: () => {
          throw new Error('probe chỉ đọc — cấm ghi');
        },
      };
      const locks = { acquire: async () => ({ key: 'probe', fenceToken: 'probe' }), release: async () => undefined, renew: async () => true };
      const service = new PodFlashSaleRetentionService(readOnly as never, locks as never);
      (service as any).logger = { log: () => undefined, warn: () => undefined, error: console.error };

      console.log('\n▶ Số dòng đủ điều kiện theo mốc tuổi (đợt sale ĐÃ ĐÓNG):');
      console.table((await service.preview()).map((r) => ({ category: r.category, total: r.total, ...r.olderThanDays })));

      const result = await service.run({
        dryRun: true,
        batchSize: 1000,
        maxBatches: 1,
        pauseMs: 0,
        policy: { SYNC_STATUS_LOGS: sync, OTHER_LOGS: other, DELETED_FS_ITEMS: deleted, CLOSED_FS_ITEMS: closed },
      });
      console.log('\n▶ Dry-run:', JSON.stringify(result.categories, null, 2));

      console.log('\n▶ EXPLAIN câu DELETE theo lô (không thực thi):');
      const cutoff = new Date(Date.now() - 14 * 86_400_000);
      for (const category of FLASH_SALE_RETENTION_CATEGORIES) {
        const sql = service.deleteBatchQuery(category, cutoff, 1000);
        try {
          const plan = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`EXPLAIN ${sql}`);
          console.log(`-- ${category}\n${plan.map((r) => r['QUERY PLAN']).join('\n')}\n`);
        } catch (error) {
          console.log(`-- ${category}: EXPLAIN lỗi: ${(error as Error).message.split('\n').slice(-1)[0]}`);
        }
      }
    },
    { timeout: 900_000, maxWait: 20_000 },
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
