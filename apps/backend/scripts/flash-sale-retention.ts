/**
 * Retention Flash Sale — công cụ quản trị (docs/pod-flash-sale/retention.md).
 *
 * Mặc định CHỈ ĐỌC: in thống kê số dòng đủ điều kiện theo nhiều mốc ngày (7/14/30/60/90/180) và kế hoạch
 * của chính sách đang chọn. Xoá thật phải truyền ĐỦ `--apply` và `--confirm-db <tên database>` trùng với
 * database đang kết nối — chặn chạy nhầm môi trường.
 *
 * Chạy (trong apps/backend):
 *   node -r ts-node/register -r dotenv/config scripts/flash-sale-retention.ts
 *   node -r ts-node/register -r dotenv/config scripts/flash-sale-retention.ts --sync-log-days 14
 *   node -r ts-node/register -r dotenv/config scripts/flash-sale-retention.ts --sync-log-days 14 \
 *        --apply --confirm-db ncmedia --max-batches 50
 *   Production (image `tools` — stage build có ts-node; `scripts/` KHÔNG có trong image runtime):
 *     docker compose -f deploy/docker-compose.production.yml --profile tools run --rm seed \n *       node -r ts-node/register scripts/flash-sale-retention.ts [tham số]
 *     (rebuild image tools trước: `… --profile tools build seed`; xem docs/pod-flash-sale/retention.md)
 *
 * Tham số (ghi đè ENV FLASH_SALE_RETENTION_*):
 *   --sync-log-days N        log SYNC_STATUS mức INFO
 *   --log-days N             mọi log còn lại
 *   --deleted-item-days N    item của đợt sale ĐÃ XOÁ MỀM
 *   --closed-item-days N     item của đợt ENDED/CANCELLED/FAILED chưa xoá (🔴 ảnh hưởng Nhân bản / số liệu lịch sử)
 *   --batch-size N --max-batches N --pause-ms N
 *   --skip-preview           bỏ bước thống kê theo mốc (bảng item lớn — thống kê quét ~0,5 GB)
 *
 * Không có token / credentials nào được in ra.
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import {
  type FlashSaleRetentionOptions,
  PodFlashSaleRetentionService,
} from '../src/modules/pod-flash-sale/services/pod-flash-sale-retention.service';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argInt(name: string): number | undefined {
  const raw = argValue(name);
  if (raw === undefined) return undefined;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} phải là số nguyên dương`);
  return value;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmDb = argValue('--confirm-db');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  // Không để các lịch nền của ứng dụng chạy trong tiến trình script.
  const scheduler = app.get(SchedulerRegistry);
  scheduler.getCronJobs().forEach((job) => void job.stop());
  scheduler.getIntervals().forEach((name) => scheduler.deleteInterval(name));
  scheduler.getTimeouts().forEach((name) => scheduler.deleteTimeout(name));

  try {
    const prisma = app.get(PrismaService);
    const retention = app.get(PodFlashSaleRetentionService);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;

    const configured = retention.configuredOptions();
    const options: FlashSaleRetentionOptions = {
      ...configured,
      dryRun: !apply,
      batchSize: argInt('--batch-size') ?? configured.batchSize,
      maxBatches: argInt('--max-batches') ?? configured.maxBatches,
      pauseMs: argValue('--pause-ms') !== undefined ? Number(argValue('--pause-ms')) : configured.pauseMs,
      policy: {
        SYNC_STATUS_LOGS: argInt('--sync-log-days') ?? configured.policy.SYNC_STATUS_LOGS,
        OTHER_LOGS: argInt('--log-days') ?? configured.policy.OTHER_LOGS,
        DELETED_FS_ITEMS: argInt('--deleted-item-days') ?? configured.policy.DELETED_FS_ITEMS,
        CLOSED_FS_ITEMS: argInt('--closed-item-days') ?? configured.policy.CLOSED_FS_ITEMS,
      },
    };

    console.log(JSON.stringify({ database: db, mode: apply ? 'APPLY' : 'DRY-RUN', options }, null, 2));

    if (apply && confirmDb !== db) {
      throw new Error(
        `Từ chối xoá: --confirm-db (${confirmDb ?? 'thiếu'}) không trùng database đang kết nối (${db}).`,
      );
    }
    if (apply && Object.values(options.policy).every((days) => days === null)) {
      throw new Error('Từ chối xoá: chưa có hạng mục nào được đặt số ngày giữ lại.');
    }

    if (!process.argv.includes('--skip-preview')) {
      console.log('▶ Số dòng đủ điều kiện theo mốc tuổi (chỉ tính đợt sale ĐÃ ĐÓNG):');
      console.table(
        (await retention.preview()).map((row) => ({ category: row.category, total: row.total, ...row.olderThanDays })),
      );
    }

    const result = await retention.run(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'FAILED' || result.status === 'LOCKED') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
