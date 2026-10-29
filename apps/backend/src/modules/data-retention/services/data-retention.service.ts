import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BUSINESS_TIMEZONE } from '../../../common/time/business-time';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  DATA_RETENTION_DEFAULT_KEEP_DAYS,
  DATA_RETENTION_TASK_LOCK_PREFIX,
  DATA_RETENTION_TASK_LOCK_TTL_MS,
  DATA_RETENTION_TASKS,
  type DataRetentionTask,
} from '../constants/data-retention.constants';
import { retentionCutoff } from './data-retention-cutoff';
import {
  buildRetentionTaskPlan,
  countStageQuery,
  deleteBatchQuery,
  type RetentionStage,
} from './data-retention.tasks';

export interface DataRetentionOptions {
  /** Tác vụ được bật — tác vụ không có tên ở đây KHÔNG bị đụng tới. */
  tasks: readonly DataRetentionTask[];
  /** `true` (mặc định) ⇒ chỉ đếm, KHÔNG xoá gì. */
  dryRun: boolean;
  /** Số ngày giữ (tính cả hôm nay) của Publish History / Draft Listings. Notifications luôn = 1 (hôm nay). */
  publishHistoryDays: number;
  draftListingDays: number;
  /** Số dòng tối đa mỗi lệnh DELETE (một transaction ngắn). */
  batchSize: number;
  /** Số lô tối đa của MỘT bước trong một lượt — phần còn lại để lượt sau. */
  maxBatchesPerStage: number;
  /** Nghỉ giữa các lô để không dồn I/O / WAL. */
  pauseMs: number;
  /** Múi giờ nghiệp vụ xác định ranh giới ngày. */
  timeZone: string;
  now?: Date;
}

export interface DataRetentionStageResult {
  stage: string;
  table: string;
  /** Số dòng đủ điều kiện LÚC BẮT ĐẦU. */
  eligible: number;
  deleted: number;
  batches: number;
  /** Còn lại sau lượt (> 0 khi chạm trần số lô hoặc dòng đang bị khoá — lượt sau làm tiếp). */
  remaining: number;
}

export type DataRetentionTaskStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'LOCKED' | 'DISABLED';

export interface DataRetentionTaskResult {
  task: DataRetentionTask;
  status: DataRetentionTaskStatus;
  keepDays: number | null;
  /** Ngày nghiệp vụ đầu tiên được giữ lại (YYYY-MM-DD). */
  keepFromDay: string | null;
  /** Mốc thời điểm (UTC ISO) — dữ liệu `< cutoff` là hết hạn. */
  cutoff: string | null;
  stages: DataRetentionStageResult[];
  /** Số dòng cũ hơn mốc nhưng CỐ Ý giữ lại, theo lý do. */
  kept: Record<string, number>;
  error: string | null;
  durationMs: number;
}

export interface DataRetentionRunResult {
  dryRun: boolean;
  timeZone: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  tasks: DataRetentionTaskResult[];
}

/**
 * DataRetentionService — dọn dữ liệu vận hành hết hạn (docs/data-retention.md).
 *
 * Nguyên tắc (cùng khuôn với retention Flash Sale):
 *  - Mặc định DRY-RUN; tác vụ không được bật thì không đụng tới.
 *  - Mỗi tác vụ ĐỘC LẬP: khoá Redis riêng, lỗi riêng — một tác vụ lỗi không chặn tác vụ khác.
 *  - Xoá theo LÔ nhỏ (mỗi lô một lệnh DELETE ⇒ một transaction ngắn), có trần số lô mỗi bước.
 *  - Điều kiện chọn dòng là TRẠNG THÁI DỮ LIỆU, không có con trỏ ⇒ chạy lại / bị ngắt giữa chừng thì
 *    lượt sau làm tiếp đúng phần còn lại; không còn gì để xoá thì lượt chạy kết thúc với 0 dòng.
 *  - Lỗi ở một lô ⇒ DỪNG tác vụ đó (không cố chạy tiếp khi có điều bất thường).
 *  - Log tối thiểu: một dòng cho mỗi tác vụ (số đếm, mốc, thời lượng) — không log dữ liệu nghiệp vụ.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: DistributedLockService,
    private readonly config: ConfigService,
  ) {}

  /** Tuỳ chọn từ cấu hình (`dataRetention.*`, múi giờ `businessTimeZone`). */
  configuredOptions(): DataRetentionOptions {
    const get = <T>(key: string, fallback: T): T => this.config.get<T>(key, fallback) ?? fallback;
    return {
      tasks: get<DataRetentionTask[]>('dataRetention.tasks', [...DATA_RETENTION_TASKS]),
      dryRun: get<boolean>('dataRetention.dryRun', true),
      publishHistoryDays: get<number>(
        'dataRetention.publishHistoryDays',
        DATA_RETENTION_DEFAULT_KEEP_DAYS,
      ),
      draftListingDays: get<number>(
        'dataRetention.draftListingDays',
        DATA_RETENTION_DEFAULT_KEEP_DAYS,
      ),
      batchSize: get<number>('dataRetention.batchSize', 1000),
      maxBatchesPerStage: get<number>('dataRetention.maxBatchesPerStage', 200),
      pauseMs: get<number>('dataRetention.pauseMs', 100),
      timeZone: get<string>('businessTimeZone', DEFAULT_BUSINESS_TIMEZONE),
    };
  }

  /** Một lượt cho mọi tác vụ. Không bao giờ ném lỗi ra ngoài — lỗi nằm trong kết quả từng tác vụ. */
  async run(options: DataRetentionOptions): Promise<DataRetentionRunResult> {
    const startedAt = new Date();
    const now = options.now ?? startedAt;

    const tasks: DataRetentionTaskResult[] = [];
    for (const task of DATA_RETENTION_TASKS) {
      tasks.push(
        options.tasks.includes(task)
          ? await this.runTask(task, options, now)
          : this.emptyResult(task, 'DISABLED', null),
      );
    }

    const finishedAt = new Date();
    return {
      dryRun: options.dryRun,
      timeZone: options.timeZone,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      tasks,
    };
  }

  /** Số ngày giữ (tính cả hôm nay) của từng tác vụ. */
  keepDaysOf(task: DataRetentionTask, options: DataRetentionOptions): number {
    switch (task) {
      case 'RECENT_NOTIFICATIONS':
        return 1;
      case 'PUBLISH_HISTORY':
        return options.publishHistoryDays;
      case 'DRAFT_LISTINGS':
        return options.draftListingDays;
    }
  }

  /** Tách riêng để test thay được (không chờ thật). */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runTask(
    task: DataRetentionTask,
    options: DataRetentionOptions,
    now: Date,
  ): Promise<DataRetentionTaskResult> {
    const started = Date.now();
    const keepDays = this.keepDaysOf(task, options);
    const result = this.emptyResult(task, 'COMPLETED', keepDays);

    let lock: Awaited<ReturnType<DistributedLockService['acquire']>> = null;
    try {
      lock = await this.locks.acquire(
        `${DATA_RETENTION_TASK_LOCK_PREFIX}${task}`,
        DATA_RETENTION_TASK_LOCK_TTL_MS,
      );
      if (!lock) {
        result.status = 'LOCKED';
        return result;
      }
      const heldLock = lock;

      const { keepFromDay, cutoff } = retentionCutoff(now, options.timeZone, keepDays);
      result.keepFromDay = keepFromDay;
      result.cutoff = cutoff.toISOString();

      const plan = buildRetentionTaskPlan(task, cutoff);
      for (const stage of plan.stages) {
        result.stages.push(
          await this.runStage(stage, options, () =>
            this.locks.renew(heldLock, DATA_RETENTION_TASK_LOCK_TTL_MS),
          ),
        );
      }
      for (const rule of plan.kept) result.kept[rule.reason] = await this.count(rule.count);

      if (!options.dryRun && result.stages.some((stage) => stage.remaining > 0))
        result.status = 'PARTIAL';
    } catch (error) {
      result.status = 'FAILED';
      result.error = error instanceof Error ? error.message.slice(0, 500) : 'Lỗi không xác định';
    } finally {
      if (lock) await this.locks.release(lock);
      result.durationMs = Date.now() - started;
      this.logTask(result, options.dryRun);
    }
    return result;
  }

  private async runStage(
    stage: RetentionStage,
    options: DataRetentionOptions,
    renewLock: () => Promise<boolean>,
  ): Promise<DataRetentionStageResult> {
    const result: DataRetentionStageResult = {
      stage: stage.name,
      table: stage.table,
      eligible: await this.count(countStageQuery(stage)),
      deleted: 0,
      batches: 0,
      remaining: 0,
    };
    if (options.dryRun || result.eligible === 0) {
      result.remaining = result.eligible;
      return result;
    }

    while (result.batches < options.maxBatchesPerStage) {
      await renewLock();
      const deleted = await this.prisma.$executeRaw(deleteBatchQuery(stage, options.batchSize));
      if (deleted === 0) break;
      result.deleted += deleted;
      result.batches += 1;
      if (deleted < options.batchSize) break;
      if (options.pauseMs > 0) await this.sleep(options.pauseMs);
    }
    result.remaining = await this.count(countStageQuery(stage));
    return result;
  }

  private async count(query: Parameters<PrismaService['$queryRaw']>[0]): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>(query);
    return Number(rows[0]?.n ?? 0);
  }

  private emptyResult(
    task: DataRetentionTask,
    status: DataRetentionTaskStatus,
    keepDays: number | null,
  ): DataRetentionTaskResult {
    return {
      task,
      status,
      keepDays,
      keepFromDay: null,
      cutoff: null,
      stages: [],
      kept: {},
      error: null,
      durationMs: 0,
    };
  }

  private logTask(result: DataRetentionTaskResult, dryRun: boolean): void {
    const payload = {
      module: 'data-retention',
      operation: dryRun ? 'retention.task.dry-run' : 'retention.task',
      task: result.task,
      status: result.status,
      keepFromDay: result.keepFromDay,
      cutoff: result.cutoff,
      stages: result.stages,
      kept: result.kept,
      durationMs: result.durationMs,
      error: result.error,
    };
    if (result.status === 'FAILED') this.logger.error({ ...payload, msg: 'Retention: tác vụ lỗi' });
    else if (result.status === 'LOCKED') {
      this.logger.warn({
        ...payload,
        msg: 'Retention: tác vụ đang chạy ở tiến trình khác — bỏ qua',
      });
    } else {
      this.logger.log({
        ...payload,
        msg: dryRun ? 'Retention (DRY-RUN — không xoá gì)' : 'Retention: đã dọn dữ liệu hết hạn',
      });
    }
  }
}
