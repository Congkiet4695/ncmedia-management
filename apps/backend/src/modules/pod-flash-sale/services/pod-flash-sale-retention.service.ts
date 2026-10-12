import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';

/**
 * Hạng mục dữ liệu mà retention quản lý (docs/pod-flash-sale/retention.md).
 *
 *  - `SYNC_STATUS_LOGS`  — log `SYNC_STATUS` mức INFO (ảnh chụp trạng thái — nguồn chính của 7 GB).
 *  - `OTHER_LOGS`        — mọi log còn lại (thao tác, lỗi, cảnh báo, Auto chain).
 *  - `DELETED_FS_ITEMS`  — item của đợt sale ĐÃ XOÁ MỀM (không còn mở / nhân bản được từ giao diện).
 *  - `CLOSED_FS_ITEMS`   — item của đợt ENDED / CANCELLED / FAILED CHƯA xoá. 🔴 Ảnh hưởng nghiệp vụ:
 *    "Nhân bản" đợt cũ và cột số liệu ở danh sách đọc chính các item này — chỉ bật khi PO đã duyệt.
 */
export type FlashSaleRetentionCategory =
  | 'SYNC_STATUS_LOGS'
  | 'OTHER_LOGS'
  | 'DELETED_FS_ITEMS'
  | 'CLOSED_FS_ITEMS';

export const FLASH_SALE_RETENTION_CATEGORIES: readonly FlashSaleRetentionCategory[] = [
  'SYNC_STATUS_LOGS',
  'OTHER_LOGS',
  'DELETED_FS_ITEMS',
  'CLOSED_FS_ITEMS',
];

/**
 * Số ngày giữ lại theo hạng mục. `null` = hạng mục TẮT (không bao giờ xoá).
 *
 * 🔴 KHÔNG có giá trị mặc định: thời hạn lưu là quyết định nghiệp vụ, phải được PO duyệt rồi đặt qua ENV
 * / tham số CLI. Thiếu ⇒ hạng mục đó không bị đụng tới.
 */
export type FlashSaleRetentionPolicy = Record<FlashSaleRetentionCategory, number | null>;

export interface FlashSaleRetentionOptions {
  policy: FlashSaleRetentionPolicy;
  /** `true` (mặc định) ⇒ chỉ đếm, KHÔNG xoá gì. */
  dryRun: boolean;
  /** Số dòng tối đa mỗi lệnh DELETE (một transaction ngắn). */
  batchSize: number;
  /** Số lô tối đa của MỘT lượt — phần còn lại để lượt sau (điều kiện tự tiếp tục). */
  maxBatches: number;
  /** Nghỉ giữa các lô để không dồn I/O / WAL. */
  pauseMs: number;
  now?: Date;
}

export interface FlashSaleRetentionCategoryResult {
  category: FlashSaleRetentionCategory;
  /** Số ngày giữ lại đã áp dụng; `null` = hạng mục tắt. */
  retentionDays: number | null;
  cutoff: string | null;
  /** Số dòng đủ điều kiện xoá LÚC BẮT ĐẦU. */
  eligible: number;
  deleted: number;
  batches: number;
  /** Số dòng đủ điều kiện CÒN LẠI sau lượt (> 0 khi chạm `maxBatches` — lượt sau làm tiếp). */
  remaining: number;
  error: string | null;
}

export interface FlashSaleRetentionResult {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'LOCKED';
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  categories: FlashSaleRetentionCategoryResult[];
}

/** Số dòng đủ điều kiện theo nhiều mốc — phục vụ quyết định thời hạn lưu. */
export interface FlashSaleRetentionPreviewRow {
  category: FlashSaleRetentionCategory;
  /** `days` ⇒ số dòng cũ hơn `days` ngày (theo đúng điều kiện của hạng mục). */
  olderThanDays: Record<string, number>;
  /** Tổng số dòng của hạng mục (mọi tuổi) — chỉ tính đợt sale ĐÃ ĐÓNG. */
  total: number;
}

/** Mốc ngày dùng để thống kê khi chưa có thời hạn được duyệt. */
export const FLASH_SALE_RETENTION_PREVIEW_DAYS = [7, 14, 30, 60, 90, 180] as const;

const LOCK_KEY = 'pod:flash-sale:retention:lock';
const LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Đợt sale ĐÃ ĐÓNG — điều kiện chung của mọi hạng mục. 🔴 Đợt đang sống (DRAFT / READY / PUBLISHING /
 * RUNNING chưa xoá) KHÔNG BAO GIỜ bị đụng tới; đợt PUBLISHING / RUNNING bị loại kể cả khi đã xoá mềm
 * (hoạt động trên sàn có thể vẫn chạy, log của nó là thứ cần để điều tra).
 */
const CLOSED_FLASH_SALE = Prisma.sql`
  (f.status IN ('ENDED', 'CANCELLED', 'FAILED')
   OR (f.deleted_at IS NOT NULL AND f.status NOT IN ('PUBLISHING', 'RUNNING')))`;

/**
 * PodFlashSaleRetentionService — dọn `pod_flash_sale_logs` / `pod_flash_sale_items` theo thời hạn lưu.
 *
 * Nguyên tắc:
 *  - Mặc định DRY-RUN; hạng mục không có thời hạn ⇒ không đụng tới.
 *  - Xoá theo LÔ nhỏ (mỗi lô một lệnh DELETE ⇒ một transaction ngắn), có trần số lô mỗi lượt.
 *  - Điều kiện chọn dòng là TRẠNG THÁI DỮ LIỆU (không có con trỏ) ⇒ chạy lại / bị ngắt giữa chừng thì
 *    lượt sau tự làm tiếp đúng phần còn lại; xoá lại dòng đã xoá là không thể ⇒ idempotent.
 *  - Khoá Redis chặn hai lượt chạy đồng thời (cron + CLI, nhiều instance).
 *  - Lỗi ở một lô ⇒ DỪNG cả lượt (không cố chạy tiếp khi có điều bất thường).
 *  - Không xoá bản ghi cha: chỉ DELETE trên chính bảng log / item; hai bảng này không có bảng con.
 */
@Injectable()
export class PodFlashSaleRetentionService {
  private readonly logger = new Logger(PodFlashSaleRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: DistributedLockService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Chính sách + tham số từ cấu hình (`flashSaleRetention.*`). */
  configuredOptions(): FlashSaleRetentionOptions {
    const get = <T>(key: string, fallback: T): T =>
      this.config?.get<T>(`flashSaleRetention.${key}`, fallback) ?? fallback;
    return {
      dryRun: get<boolean>('dryRun', true),
      batchSize: get<number>('batchSize', 1000),
      maxBatches: get<number>('maxBatchesPerRun', 500),
      pauseMs: get<number>('pauseMs', 200),
      policy: {
        SYNC_STATUS_LOGS: get<number | null>('syncLogDays', null),
        OTHER_LOGS: get<number | null>('logDays', null),
        DELETED_FS_ITEMS: get<number | null>('deletedItemDays', null),
        CLOSED_FS_ITEMS: get<number | null>('closedItemDays', null),
      },
    };
  }

  /**
   * Thống kê số dòng đủ điều kiện theo nhiều mốc ngày — CHỈ ĐỌC. Dùng để PO chọn thời hạn lưu.
   */
  async preview(
    days: readonly number[] = FLASH_SALE_RETENTION_PREVIEW_DAYS,
    now: Date = new Date(),
  ): Promise<FlashSaleRetentionPreviewRow[]> {
    const rows: FlashSaleRetentionPreviewRow[] = [];
    for (const category of FLASH_SALE_RETENTION_CATEGORIES) {
      const counts = await this.prisma.$queryRaw<Array<Record<string, bigint>>>(
        this.previewQuery(category, days, now),
      );
      const row = counts[0] ?? {};
      rows.push({
        category,
        total: Number(row.total ?? 0n),
        olderThanDays: Object.fromEntries(days.map((d) => [String(d), Number(row[`d${d}`] ?? 0n)])),
      });
    }
    return rows;
  }

  /** Một lượt dọn (hoặc dry-run). Không bao giờ ném lỗi ra ngoài — lỗi nằm trong kết quả. */
  async run(options: FlashSaleRetentionOptions): Promise<FlashSaleRetentionResult> {
    const startedAt = new Date();
    const now = options.now ?? startedAt;
    const base = { dryRun: options.dryRun, startedAt: startedAt.toISOString() };

    const lock = await this.locks.acquire(LOCK_KEY, LOCK_TTL_MS);
    if (!lock) {
      this.logger.warn({
        module: 'pod-flash-sale',
        operation: 'retention.locked',
        msg: 'Đang có lượt dọn Flash Sale khác chạy — bỏ qua lượt này',
      });
      return { ...base, status: 'LOCKED', finishedAt: new Date().toISOString(), durationMs: 0, categories: [] };
    }

    const categories: FlashSaleRetentionCategoryResult[] = [];
    let batchesLeft = options.maxBatches;
    let failed = false;
    try {
      for (const category of FLASH_SALE_RETENTION_CATEGORIES) {
        const days = options.policy[category];
        const result: FlashSaleRetentionCategoryResult = {
          category,
          retentionDays: days,
          cutoff: null,
          eligible: 0,
          deleted: 0,
          batches: 0,
          remaining: 0,
          error: null,
        };
        categories.push(result);
        if (days === null || failed) continue;

        const cutoff = new Date(now.getTime() - days * 86_400_000);
        result.cutoff = cutoff.toISOString();
        result.eligible = await this.countEligible(category, cutoff);

        if (!options.dryRun) {
          while (batchesLeft > 0) {
            let deleted: number;
            try {
              await this.locks.renew(lock, LOCK_TTL_MS);
              deleted = await this.prisma.$executeRaw(this.deleteBatchQuery(category, cutoff, options.batchSize));
            } catch (error) {
              result.error = error instanceof Error ? error.message.slice(0, 500) : 'Lỗi không xác định';
              failed = true;
              this.logger.error({
                module: 'pod-flash-sale',
                operation: 'retention.batch.fail',
                category,
                batch: result.batches + 1,
                msg: result.error,
              });
              break;
            }
            if (deleted === 0) break;
            result.deleted += deleted;
            result.batches += 1;
            batchesLeft -= 1;
            this.logger.log({
              module: 'pod-flash-sale',
              operation: 'retention.batch',
              category,
              batch: result.batches,
              deleted,
              totalDeleted: result.deleted,
            });
            if (deleted < options.batchSize) break;
            if (options.pauseMs > 0) await this.sleep(options.pauseMs);
          }
        }

        result.remaining = options.dryRun ? result.eligible : await this.countEligible(category, cutoff);
      }
    } finally {
      await this.locks.release(lock);
    }

    const finishedAt = new Date();
    const status = failed
      ? 'FAILED'
      : categories.some((category) => category.remaining > 0) && !options.dryRun
        ? 'PARTIAL'
        : 'COMPLETED';
    const summary: FlashSaleRetentionResult = {
      ...base,
      status,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      categories,
    };
    this.logger.log({
      module: 'pod-flash-sale',
      operation: options.dryRun ? 'retention.dry-run' : 'retention.run',
      ...summary,
      msg: options.dryRun
        ? 'Retention Flash Sale (DRY-RUN — không xoá gì)'
        : 'Retention Flash Sale — đã dọn dữ liệu quá hạn',
    });
    return summary;
  }

  /** Tách riêng để test thay được (không chờ thật). */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // SQL — một nguồn điều kiện cho đếm, xem trước và xoá
  // ---------------------------------------------------------------------------

  /** Điều kiện TUỔI của từng hạng mục (ngoài điều kiện "đợt đã đóng"). */
  private ageCondition(category: FlashSaleRetentionCategory, cutoff: Date): Prisma.Sql {
    switch (category) {
      case 'SYNC_STATUS_LOGS':
        return Prisma.sql`x.action = 'SYNC_STATUS' AND x.level = 'INFO' AND x.created_at < ${cutoff}`;
      case 'OTHER_LOGS':
        return Prisma.sql`NOT (x.action = 'SYNC_STATUS' AND x.level = 'INFO') AND x.created_at < ${cutoff}`;
      case 'DELETED_FS_ITEMS':
        return Prisma.sql`f.deleted_at IS NOT NULL AND f.deleted_at < ${cutoff}`;
      case 'CLOSED_FS_ITEMS':
        // Đợt chưa xoá, đã kết thúc: tuổi tính từ mốc MUỘN NHẤT giữa giờ kết thúc và lần cập nhật cuối
        // (đợt huỷ sớm / thất bại có end_at ở tương lai thì `updated_at` mới là lúc đóng).
        return Prisma.sql`f.deleted_at IS NULL AND f.status IN ('ENDED', 'CANCELLED', 'FAILED')
          AND GREATEST(f.end_at, f.updated_at) < ${cutoff}`;
    }
  }

  private isLogCategory(category: FlashSaleRetentionCategory): boolean {
    return category === 'SYNC_STATUS_LOGS' || category === 'OTHER_LOGS';
  }

  private table(category: FlashSaleRetentionCategory): Prisma.Sql {
    return this.isLogCategory(category)
      ? Prisma.raw('pod_flash_sale_logs')
      : Prisma.raw('pod_flash_sale_items');
  }

  /**
   * Câu FROM … WHERE chung của đếm và xoá (alias `x` = dòng log/item, `f` = đợt sale).
   *
   * 🔴 Dạng `x.flash_sale_id = ANY(ARRAY(SELECT f.id …))`, KHÔNG JOIN: mảng id đợt sale được tính MỘT lần
   * (bảng đợt sale chỉ ~1 nghìn dòng) rồi Postgres đi theo index `flash_sale_id` của bảng con. Dạng JOIN
   * cho kế hoạch Seq Scan toàn bộ ~2 triệu item ở MỖI lô (đã đo bằng EXPLAIN trên dữ liệu thật).
   */
  private eligibleFrom(category: FlashSaleRetentionCategory, cutoff: Date): Prisma.Sql {
    const { flashSale, row } = this.splitConditions(category, cutoff);
    return Prisma.sql`FROM ${this.table(category)} x
      WHERE x.flash_sale_id = ANY(ARRAY(
        SELECT f.id FROM pod_flash_sales f WHERE ${CLOSED_FLASH_SALE} AND ${flashSale}))
      AND ${row}`;
  }

  /** Tách điều kiện tuổi thành phần của ĐỢT SALE (`f`) và phần của DÒNG (`x`). */
  private splitConditions(
    category: FlashSaleRetentionCategory,
    cutoff: Date,
  ): { flashSale: Prisma.Sql; row: Prisma.Sql } {
    return this.isLogCategory(category)
      ? { flashSale: Prisma.sql`TRUE`, row: this.ageCondition(category, cutoff) }
      : { flashSale: this.ageCondition(category, cutoff), row: Prisma.sql`TRUE` };
  }

  private async countEligible(category: FlashSaleRetentionCategory, cutoff: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS n ${this.eligibleFrom(category, cutoff)}`,
    );
    return Number(row?.n ?? 0n);
  }

  /** MỘT lô: xoá tối đa `limit` dòng đủ điều kiện (theo id, không có con trỏ ⇒ tự tiếp tục). */
  deleteBatchQuery(category: FlashSaleRetentionCategory, cutoff: Date, limit: number): Prisma.Sql {
    return Prisma.sql`DELETE FROM ${this.table(category)} WHERE id IN (
      SELECT x.id ${this.eligibleFrom(category, cutoff)} LIMIT ${limit})`;
  }

  private previewQuery(
    category: FlashSaleRetentionCategory,
    days: readonly number[],
    now: Date,
  ): Prisma.Sql {
    // Mốc 0 ngày = mọi tuổi ⇒ "total" của hạng mục.
    const total = Prisma.sql`COUNT(*) FILTER (WHERE ${this.ageCondition(category, now)}) AS total`;
    const buckets = days.map((d) => {
      const cutoff = new Date(now.getTime() - d * 86_400_000);
      return Prisma.sql`COUNT(*) FILTER (WHERE ${this.ageCondition(category, cutoff)}) AS ${Prisma.raw(`d${d}`)}`;
    });
    return Prisma.sql`SELECT ${Prisma.join([total, ...buckets])}
      FROM ${this.table(category)} x
      JOIN pod_flash_sales f ON f.id = x.flash_sale_id
      WHERE ${CLOSED_FLASH_SALE}`;
  }
}
