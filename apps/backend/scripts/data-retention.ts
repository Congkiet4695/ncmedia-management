/**
 * Retention dữ liệu theo ngày — công cụ quản trị (docs/data-retention.md).
 *
 * Mặc định CHỈ ĐỌC (DRY-RUN): in mốc cutoff theo múi giờ nghiệp vụ, số dòng đủ điều kiện của từng bảng và
 * số dòng cố ý giữ lại. Xoá thật phải truyền ĐỦ `--apply` và `--confirm-db <tên database>` trùng với database
 * đang kết nối — chặn chạy nhầm môi trường.
 *
 * Chạy (trong apps/backend):
 *   node -r ts-node/register -r dotenv/config scripts/data-retention.ts
 *   node -r ts-node/register -r dotenv/config scripts/data-retention.ts --tasks RECENT_NOTIFICATIONS
 *   node -r ts-node/register -r dotenv/config scripts/data-retention.ts --apply --confirm-db ncmedia --max-batches 50
 *   Production (image `tools` — stage build có ts-node; `scripts/` KHÔNG có trong image runtime):
 *     docker compose -f deploy/docker-compose.production.yml --profile tools run --rm seed \
 *       node -r ts-node/register scripts/data-retention.ts [tham số]
 *
 * Tham số (ghi đè ENV DATA_RETENTION_*):
 *   --tasks A,B                  RECENT_NOTIFICATIONS | PUBLISH_HISTORY | DRAFT_LISTINGS (mặc định: theo ENV)
 *   --publish-history-days N     số ngày giữ, TÍNH CẢ HÔM NAY (mặc định 7)
 *   --draft-listing-days N       số ngày giữ, TÍNH CẢ HÔM NAY (mặc định 7)
 *   --batch-size N --max-batches N --pause-ms N
 *   --now <ISO>                  giả lập "bây giờ" để kiểm mốc cutoff (CHỈ cho DRY-RUN)
 *
 * Không có token / credentials nào được in ra.
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import {
  DATA_RETENTION_TASKS,
  type DataRetentionTask,
} from '../src/modules/data-retention/constants/data-retention.constants';
import {
  type DataRetentionOptions,
  DataRetentionService,
} from '../src/modules/data-retention/services/data-retention.service';

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

function argTasks(): DataRetentionTask[] | undefined {
  const raw = argValue('--tasks');
  if (raw === undefined) return undefined;
  const names = raw.split(',').map((name) => name.trim().toUpperCase());
  const unknown = names.filter(
    (name) => !(DATA_RETENTION_TASKS as readonly string[]).includes(name),
  );
  if (unknown.length > 0) throw new Error(`--tasks có tác vụ không tồn tại: ${unknown.join(', ')}`);
  return DATA_RETENTION_TASKS.filter((task) => names.includes(task));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmDb = argValue('--confirm-db');
  const nowArg = argValue('--now');
  if (apply && nowArg)
    throw new Error('Từ chối: --now chỉ dùng cho DRY-RUN (kiểm mốc), không dùng khi xoá thật.');
  const now = nowArg ? new Date(nowArg) : undefined;
  if (now && Number.isNaN(now.getTime())) throw new Error('--now phải là thời điểm ISO hợp lệ');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  // Không để các lịch nền của ứng dụng chạy trong tiến trình script.
  const scheduler = app.get(SchedulerRegistry);
  scheduler.getCronJobs().forEach((job) => void job.stop());
  scheduler.getIntervals().forEach((name) => scheduler.deleteInterval(name));
  scheduler.getTimeouts().forEach((name) => scheduler.deleteTimeout(name));

  try {
    const prisma = app.get(PrismaService);
    const retention = app.get(DataRetentionService);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;

    const configured = retention.configuredOptions();
    const options: DataRetentionOptions = {
      ...configured,
      dryRun: !apply,
      tasks: argTasks() ?? configured.tasks,
      publishHistoryDays: argInt('--publish-history-days') ?? configured.publishHistoryDays,
      draftListingDays: argInt('--draft-listing-days') ?? configured.draftListingDays,
      batchSize: argInt('--batch-size') ?? configured.batchSize,
      maxBatchesPerStage: argInt('--max-batches') ?? configured.maxBatchesPerStage,
      pauseMs:
        argValue('--pause-ms') !== undefined ? Number(argValue('--pause-ms')) : configured.pauseMs,
      now,
    };

    console.log(
      JSON.stringify({ database: db, mode: apply ? 'APPLY' : 'DRY-RUN', options }, null, 2),
    );

    if (apply && confirmDb !== db) {
      throw new Error(
        `Từ chối xoá: --confirm-db (${confirmDb ?? 'thiếu'}) không trùng database đang kết nối (${db}).`,
      );
    }

    const result = await retention.run(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.tasks.some((task) => task.status === 'FAILED' || task.status === 'LOCKED'))
      process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
