import { Injectable, Logger } from '@nestjs/common';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  POD_SCOPE_SYSTEM,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TIKTOK_ACTIVITY_MAX_TITLE_LENGTH } from '../../tiktok-sdk/tiktok-sdk.constants';
import {
  FLASH_SALE_AUTO_ACTION,
  FLASH_SALE_AUTO_LOCK_PREFIX,
  FLASH_SALE_AUTO_LOCK_RENEW_MS,
  FLASH_SALE_AUTO_LOCK_TTL_MS,
  FLASH_SALE_AUTO_NAME_SUFFIX,
  FLASH_SALE_AUTO_PAGE_SIZE,
  FLASH_SALE_AUTO_RULES,
  FLASH_SALE_AUTO_RUN_STATUS,
  FLASH_SALE_AUTO_TRIGGER,
  FLASH_SALE_MIN_LEAD_SECONDS,
  type FlashSaleAutoAction,
  type FlashSaleAutoTrigger,
} from '../constants/pod-flash-sale.constants';
import type {
  PodFlashSaleAutoChainDto,
  PodFlashSaleAutoConfigDto,
  PodFlashSaleAutoNodeResultDto,
  PodFlashSaleAutoRunResultDto,
  UpdateFlashSaleAutoConfigDto,
} from '../dto/pod-flash-sale-auto.dto';
import {
  PodFlashSaleAutoBusyException,
  PodFlashSaleAutoChainActiveException,
  PodFlashSaleAutoConfigInvalidException,
  PodFlashSaleAutoHasNextException,
  PodFlashSaleInvalidStateException,
} from '../exceptions/pod-flash-sale.exceptions';
import type { FlashSaleDetailRow } from '../mappers/pod-flash-sale.mapper';
import {
  computeNextWindow,
  isDueForNext,
  isValidTimeZone,
  latestSlot,
  upcomingRun,
} from './pod-flash-sale-auto-schedule';
import {
  computeFlashSalePricing,
  toDecimal,
  validatePricing,
  validateQuantityLimit,
  type FlashSalePricing,
} from './pod-flash-sale-pricing';
import { PodFlashSalePublisherService } from './pod-flash-sale-publisher.service';
import { PodFlashSaleService } from './pod-flash-sale.service';

/** Những cột của một nút Auto cần để quyết định. */
const NODE_SELECT = {
  id: true,
  organizationId: true,
  accountId: true,
  shopId: true,
  name: true,
  status: true,
  endAt: true,
  timezone: true,
  autoMode: true,
  autoChainId: true,
  autoSequence: true,
  deletedAt: true,
} satisfies Prisma.PodFlashSaleSelect;
type AutoNode = Prisma.PodFlashSaleGetPayload<{ select: typeof NODE_SELECT }>;

interface NodeOutcome {
  action: FlashSaleAutoAction;
  nextFlashSaleId: string | null;
  message: string | null;
}

/**
 * Auto Flash Sale — tự nối dài một CHUỖI đợt sale: A → B → C …
 *
 * ```
 *   lượt chạy (cron mỗi ngày một lần, hoặc Run Now — CÙNG một đường)
 *     └─ khoá Redis theo tổ chức
 *         └─ mỗi đợt auto_mode = ON và end_at ≤ now + 24h (duyệt theo trang)
 *              ├─ chưa có đợt kế tiếp ⇒ tạo B LOCAL (chép đủ mọi dòng) ⇒ publish lên TikTok
 *              │                         ⇒ B RUNNING ⇒ chuyển Auto A → B (một transaction)
 *              ├─ có B, B RUNNING/ENDED  ⇒ chỉ chuyển Auto (lượt trước chết giữa chừng)
 *              ├─ có B, B PUBLISHING     ⇒ chờ lượt sau
 *              ├─ có B, B READY/FAILED   ⇒ publish/retry CHÍNH B (không bao giờ tạo C)
 *              └─ có B, B CANCELLED      ⇒ bỏ qua, ghi rõ lý do
 * ```
 *
 * 🔴 **Không bao giờ tắt Auto của A trước khi B lên sàn.** Lỗi ở bất kỳ bước nào ⇒ A vẫn ON,
 * lượt sau thử lại đúng B.
 *
 * 🔴 **Không trùng.** Ba lớp: khoá Redis theo tổ chức; khoá hàng A (`FOR UPDATE`) khi tạo B;
 * và partial unique index `auto_parent_id` ở DATABASE — hai tiến trình có lọt qua hai lớp trên
 * thì lớp cuối vẫn chỉ cho một B tồn tại.
 *
 * 🔴 **Một chuỗi lỗi không kéo chuỗi khác.** Mỗi nút bọc try/catch riêng.
 */
@Injectable()
export class PodFlashSaleAutoService {
  private readonly logger = new Logger(PodFlashSaleAutoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSales: PodFlashSaleService,
    private readonly publisher: PodFlashSalePublisherService,
    private readonly locks: DistributedLockService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cấu hình lịch chạy (Admin)
  // ---------------------------------------------------------------------------

  async getConfig(organizationId: string, now: Date = new Date()): Promise<PodFlashSaleAutoConfigDto> {
    const row = await this.prisma.podFlashSaleAutoConfig.findFirst({
      where: { organizationId, deletedAt: null },
    });
    return {
      configured: row !== null,
      enabled: row?.enabled ?? false,
      runTime: row?.runTime ?? null,
      timezone: row?.timezone ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastRunTrigger: row?.lastRunTrigger ?? null,
      lastRunStatus: row?.lastRunStatus ?? null,
      lastRunSummary: (row?.lastRunSummary as unknown as PodFlashSaleAutoRunResultDto | null) ?? null,
      nextRunAt:
        row && row.enabled
          ? upcomingRun(now, row.runTime, row.timezone, row.lastScheduledAt).toISOString()
          : null,
      rules: {
        leadHours: FLASH_SALE_AUTO_RULES.LEAD_MS / 3_600_000,
        gapMinutes: FLASH_SALE_AUTO_RULES.GAP_MS / 60_000,
        durationDays: FLASH_SALE_AUTO_RULES.DURATION_DAYS,
        endTrimMinutes: FLASH_SALE_AUTO_RULES.END_TRIM_MS / 60_000,
      },
    };
  }

  /**
   * Lưu cấu hình. Đổi giờ/múi giờ hoặc vừa bật ⇒ mốc đã qua của hôm nay được coi là ĐÃ XỬ LÝ,
   * lần chạy đầu tiên là mốc KẾ TIẾP — lưu cấu hình lúc 10:00 với giờ chạy 05:00 không được kích
   * hoạt ngay một lượt tạo đợt sale (muốn chạy ngay thì dùng Run Now).
   */
  async updateConfig(
    organizationId: string,
    userId: string,
    dto: UpdateFlashSaleAutoConfigDto,
    now: Date = new Date(),
  ): Promise<PodFlashSaleAutoConfigDto> {
    if (!isValidTimeZone(dto.timezone)) {
      throw new PodFlashSaleAutoConfigInvalidException(`Múi giờ "${dto.timezone}" không phải múi giờ IANA hợp lệ.`);
    }
    const existing = await this.prisma.podFlashSaleAutoConfig.findUnique({ where: { organizationId } });
    const scheduleChanged =
      !existing ||
      existing.deletedAt !== null ||
      (!existing.enabled && dto.enabled) ||
      existing.runTime !== dto.runTime ||
      existing.timezone !== dto.timezone;
    const baseline = scheduleChanged ? { lastScheduledAt: latestSlot(now, dto.runTime, dto.timezone) } : {};

    await this.prisma.podFlashSaleAutoConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        enabled: dto.enabled,
        runTime: dto.runTime,
        timezone: dto.timezone,
        createdBy: userId,
        updatedBy: userId,
        ...baseline,
      },
      update: {
        enabled: dto.enabled,
        runTime: dto.runTime,
        timezone: dto.timezone,
        deletedAt: null,
        updatedBy: userId,
        ...baseline,
      },
    });
    return this.getConfig(organizationId, now);
  }

  /** Run Now — CÙNG đường với cron, không có lối tắt nào. */
  async runNow(organizationId: string): Promise<PodFlashSaleAutoRunResultDto> {
    const result = await this.runOrganization(organizationId, FLASH_SALE_AUTO_TRIGGER.MANUAL);
    if (!result) throw new PodFlashSaleAutoBusyException();
    return result;
  }

  // ---------------------------------------------------------------------------
  // Lượt quét của scheduler
  // ---------------------------------------------------------------------------

  /**
   * Nhịp quét: tổ chức nào tới mốc chạy thì chạy.
   *
   * 🔴 "Mỗi ngày đúng một lần" được bảo đảm bằng phép so-sánh-và-đổi `last_scheduled_at`: nhiều
   * instance cùng quét thì đúng một instance giành được mốc. Mốc bị lỡ (server tắt đúng giờ
   * chạy) vẫn chưa được giành ⇒ chạy bù ở nhịp quét đầu tiên sau khi server lên lại.
   */
  async runDueOrganizations(now: Date = new Date()): Promise<void> {
    const configs = await this.prisma.podFlashSaleAutoConfig.findMany({
      where: { enabled: true, deletedAt: null },
      select: { id: true, organizationId: true, runTime: true, timezone: true },
    });

    for (const config of configs) {
      try {
        const slot = latestSlot(now, config.runTime, config.timezone);
        const claim = await this.prisma.podFlashSaleAutoConfig.updateMany({
          where: {
            id: config.id,
            enabled: true,
            OR: [{ lastScheduledAt: null }, { lastScheduledAt: { lt: slot } }],
          },
          data: { lastScheduledAt: slot },
        });
        if (claim.count === 0) continue;
        await this.runOrganization(config.organizationId, FLASH_SALE_AUTO_TRIGGER.CRON, now);
      } catch (error) {
        // Một tổ chức lỗi không được chặn tổ chức khác.
        this.logger.error({
          module: 'pod-flash-sale',
          operation: 'flashSale.auto.tick',
          organizationId: config.organizationId,
          msg: `AUTO_FLASH_SALE_FAILED: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
        });
      }
    }
  }

  /**
   * Một lượt chạy cho MỘT tổ chức. Trả `null` khi một lượt khác đang giữ khoá.
   *
   * Chỉ nạp những đợt `auto_mode = ON` và `end_at ≤ now + LEAD` (partial index
   * `pod_flash_sales_auto_due_idx`), theo trang, duyệt bằng con trỏ `(end_at, id)` — không nạp
   * cả bảng, không phụ thuộc số lượng.
   */
  async runOrganization(
    organizationId: string,
    trigger: FlashSaleAutoTrigger,
    now: Date = new Date(),
  ): Promise<PodFlashSaleAutoRunResultDto | null> {
    const lock = await this.locks.acquire(`${FLASH_SALE_AUTO_LOCK_PREFIX}${organizationId}`, FLASH_SALE_AUTO_LOCK_TTL_MS);
    if (!lock) {
      this.logger.warn({
        module: 'pod-flash-sale',
        operation: 'flashSale.auto.run',
        organizationId,
        trigger,
        msg: 'AUTO_FLASH_SALE_SKIPPED: tổ chức đang có một lượt Auto khác chạy',
      });
      return null;
    }
    const watchdog = setInterval(() => {
      void this.locks.renew(lock, FLASH_SALE_AUTO_LOCK_TTL_MS);
    }, FLASH_SALE_AUTO_LOCK_RENEW_MS);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    const startedAt = new Date();
    const result: PodFlashSaleAutoRunResultDto = {
      trigger,
      status: FLASH_SALE_AUTO_RUN_STATUS.SUCCESS,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      checked: 0,
      notDue: 0,
      created: 0,
      transferred: 0,
      inProgress: 0,
      skipped: 0,
      failed: 0,
      nodes: [],
    };
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.run',
      organizationId,
      trigger,
      msg: 'AUTO_FLASH_SALE_JOB_STARTED',
    });

    try {
      const dueBefore = new Date(now.getTime() + FLASH_SALE_AUTO_RULES.LEAD_MS);
      let cursor: { endAt: Date; id: string } | null = null;
      for (;;) {
        const page: AutoNode[] = await this.prisma.podFlashSale.findMany({
          where: {
            organizationId,
            autoMode: true,
            deletedAt: null,
            endAt: { lte: dueBefore },
            ...(cursor
              ? { OR: [{ endAt: { gt: cursor.endAt } }, { endAt: cursor.endAt, id: { gt: cursor.id } }] }
              : {}),
          },
          orderBy: [{ endAt: 'asc' }, { id: 'asc' }],
          take: FLASH_SALE_AUTO_PAGE_SIZE,
          select: NODE_SELECT,
        });
        if (page.length === 0) break;
        cursor = { endAt: page[page.length - 1].endAt, id: page[page.length - 1].id };

        for (const node of page) {
          result.checked += 1;
          const outcome = await this.processNodeSafely(node, now);
          this.count(result, outcome.action);
          result.nodes.push({
            flashSaleId: node.id,
            name: node.name,
            shopId: node.shopId,
            chainId: node.autoChainId,
            ...outcome,
          } satisfies PodFlashSaleAutoNodeResultDto);
        }
        if (page.length < FLASH_SALE_AUTO_PAGE_SIZE) break;
      }
      result.status =
        result.failed === 0
          ? FLASH_SALE_AUTO_RUN_STATUS.SUCCESS
          : result.failed === result.checked
            ? FLASH_SALE_AUTO_RUN_STATUS.FAILED
            : FLASH_SALE_AUTO_RUN_STATUS.PARTIAL;
    } catch (error) {
      result.status = FLASH_SALE_AUTO_RUN_STATUS.FAILED;
      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'flashSale.auto.run',
        organizationId,
        trigger,
        msg: `AUTO_FLASH_SALE_FAILED: lượt chạy dừng bất thường — ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    } finally {
      clearInterval(watchdog);
      await this.locks.release(lock);
    }

    result.finishedAt = new Date().toISOString();
    await this.prisma.podFlashSaleAutoConfig.updateMany({
      where: { organizationId },
      data: {
        lastRunAt: startedAt,
        lastRunTrigger: trigger,
        lastRunStatus: result.status,
        lastRunSummary: result as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.run',
      organizationId,
      trigger,
      status: result.status,
      checked: result.checked,
      created: result.created,
      transferred: result.transferred,
      inProgress: result.inProgress,
      skipped: result.skipped,
      failed: result.failed,
      durationMs: Date.now() - startedAt.getTime(),
      msg: 'AUTO_FLASH_SALE_JOB_COMPLETED',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Một nút của chuỗi
  // ---------------------------------------------------------------------------

  private async processNodeSafely(node: AutoNode, now: Date): Promise<NodeOutcome> {
    try {
      return await this.processNode(node, now);
    } catch (error) {
      const failure = this.publisher.describeFailure(error);
      return this.fail(node, null, `Lỗi không mong đợi: ${failure.message}`, now);
    }
  }

  /** Quyết định cho MỘT đợt đang bật Auto. Public để kiểm thử từng nhánh. */
  async processNode(node: AutoNode, now: Date = new Date()): Promise<NodeOutcome> {
    const remainingMs = node.endAt.getTime() - now.getTime();
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.check',
      organizationId: node.organizationId,
      shopId: node.shopId,
      accountId: node.accountId,
      flashSaleId: node.id,
      chainId: node.autoChainId,
      currentEndAt: node.endAt.toISOString(),
      remainingMs,
      msg: 'AUTO_FLASH_SALE_CHECKED',
    });

    if (!node.autoMode || node.deletedAt) return this.skip(node, null, 'Đợt không còn bật Auto.');
    if (node.status === PodFlashSaleStatus.CANCELLED) {
      return this.skip(node, null, 'Đợt đã bị huỷ — không tạo đợt kế tiếp. Tắt Auto ở đợt này.');
    }
    if (!isDueForNext(node.endAt, now)) {
      return { action: FLASH_SALE_AUTO_ACTION.NOT_DUE, nextFlashSaleId: null, message: null };
    }

    const child = await this.prisma.podFlashSale.findFirst({
      where: { organizationId: node.organizationId, autoParentId: node.id, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (child) return this.continueChild(node, child, now);
    return this.createNext(node, now);
  }

  /**
   * Đã có đợt kế tiếp (lượt trước tạo xong nhưng chưa chuyển Auto, hoặc publish hỏng).
   *
   * 🔴 Đây là chỗ bảo đảm "B hỏng thì thử lại B, KHÔNG tạo C".
   */
  private async continueChild(
    node: AutoNode,
    child: { id: string; name: string; status: PodFlashSaleStatus },
    now: Date,
  ): Promise<NodeOutcome> {
    switch (child.status) {
      case PodFlashSaleStatus.RUNNING:
      case PodFlashSaleStatus.ENDED:
        return this.transfer(node, child.id, FLASH_SALE_AUTO_ACTION.TRANSFERRED);
      case PodFlashSaleStatus.PUBLISHING:
        return this.outcome(node, FLASH_SALE_AUTO_ACTION.IN_PROGRESS, child.id, `Đợt kế tiếp "${child.name}" đang được gửi lên TikTok.`);
      case PodFlashSaleStatus.CANCELLED:
        return this.skip(
          node,
          child.id,
          `Đợt kế tiếp "${child.name}" đã bị huỷ — xoá đợt đó để chuỗi tạo lại, hoặc tắt Auto.`,
        );
      default:
        // DRAFT / READY / FAILED: publish (hoặc retry) CHÍNH đợt đó.
        return this.publishChild(node, child.id, child.status, FLASH_SALE_AUTO_ACTION.TRANSFERRED, now);
    }
  }

  /** Tạo đợt kế tiếp LOCAL (chép đủ cấu hình + mọi dòng), rồi đưa lên TikTok. */
  private async createNext(node: AutoNode, now: Date): Promise<NodeOutcome> {
    const window = computeNextWindow(node.endAt, node.timezone);
    // TikTok đòi begin_time ở TƯƠNG LAI (cùng đệm với validator). Quá hạn ⇒ không tự dời lịch.
    if (window.startAt.getTime() < now.getTime() + FLASH_SALE_MIN_LEAD_SECONDS * 1_000) {
      return this.fail(
        node,
        null,
        `Giờ bắt đầu của đợt kế tiếp (${window.startAt.toISOString()}) đã ở quá khứ — không tạo tự động. ` +
          'Hãy tạo đợt mới và bật Auto ở đó, hoặc tắt Auto ở đợt này.',
        now,
      );
    }

    const source = await this.flashSales.get(node.organizationId, node.id, POD_SCOPE_SYSTEM);
    if (source.items.length === 0) return this.fail(node, null, 'Đợt hiện tại không có sản phẩm nào để chép.', now);

    const sequence = (node.autoSequence ?? 1) + 1;
    const chainId = node.autoChainId ?? node.id;
    const name = await this.nextName(node.organizationId, node.shopId, source.name, sequence);
    const rows = await this.buildItems(source);

    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        // Khoá hàng A rồi đọc lại: Admin vừa tắt Auto, hoặc tiến trình khác vừa tạo B ⇒ dừng.
        const [locked] = await tx.$queryRaw<Array<{ auto_mode: boolean; deleted_at: Date | null }>>`
          SELECT auto_mode, deleted_at FROM pod_flash_sales WHERE id = ${node.id}::uuid FOR UPDATE
        `;
        if (!locked || !locked.auto_mode || locked.deleted_at) return '';
        const already = await tx.podFlashSale.findFirst({
          where: { autoParentId: node.id, deletedAt: null },
          select: { id: true },
        });
        if (already) return '';

        const created = await tx.podFlashSale.create({
          data: {
            organizationId: node.organizationId,
            accountId: source.accountId,
            shopId: source.shopId,
            name,
            description: source.description,
            status: PodFlashSaleStatus.READY,
            productLevel: source.productLevel,
            startAt: window.startAt,
            endAt: window.endAt,
            timezone: source.timezone,
            itemCount: rows.filter((row) => row.status !== PodFlashSaleItemStatus.REMOVED).length,
            autoMode: false,
            autoChainId: chainId,
            autoParentId: node.id,
            autoSequence: sequence,
          },
          select: { id: true },
        });
        await tx.podFlashSaleItem.createMany({
          data: rows.map((row) => ({ ...row, organizationId: node.organizationId, flashSaleId: created.id })),
        });
        return created.id;
      });
    } catch (error) {
      if (this.isUniqueViolation(error, 'auto_parent')) {
        return this.skip(node, null, 'Đợt kế tiếp vừa được một tiến trình khác tạo — bỏ qua.');
      }
      throw error;
    }
    if (!createdId) return this.skip(node, null, 'Đợt đã tắt Auto hoặc đã có đợt kế tiếp — bỏ qua.');

    const ready = rows.filter((row) => row.status === PodFlashSaleItemStatus.READY).length;
    const message =
      `Tạo đợt kế tiếp "${name}" (#${sequence}): ${rows.length} dòng (${ready} sẵn sàng), ` +
      `${window.startAt.toISOString()} → ${window.endAt.toISOString()}.`;
    await this.writeChainLog(node.organizationId, node.id, message, PodFlashSaleLogLevel.INFO);
    await this.writeChainLog(
      node.organizationId,
      createdId,
      `Được tạo tự động từ "${node.name}" (chuỗi ${chainId}, #${sequence}).`,
      PodFlashSaleLogLevel.INFO,
    );
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.create',
      organizationId: node.organizationId,
      shopId: node.shopId,
      flashSaleId: node.id,
      chainId,
      nextFlashSaleId: createdId,
      totalItems: rows.length,
      readyItems: ready,
      startAt: window.startAt.toISOString(),
      endAt: window.endAt.toISOString(),
      msg: 'AUTO_FLASH_SALE_CREATED (local) — đang đưa lên TikTok',
    });

    return this.publishChild(node, createdId, PodFlashSaleStatus.READY, FLASH_SALE_AUTO_ACTION.CREATED, now);
  }

  /**
   * Đưa đợt kế tiếp lên TikTok bằng ĐÚNG đường Publish/Retry của module (chia lô ≤ 300 SKU,
   * một activity_id, chạy lại từ dòng chưa lên sàn), chờ lượt gửi xong rồi mới chuyển Auto.
   */
  private async publishChild(
    node: AutoNode,
    childId: string,
    childStatus: PodFlashSaleStatus,
    successAction: FlashSaleAutoAction,
    now: Date,
  ): Promise<NodeOutcome> {
    try {
      // Dòng không hợp lệ (SKU đã xoá, chưa có giá) được bỏ qua và GIỮ LẠI trong đợt mới —
      // không chặn cả chuỗi vì một SKU.
      const options = { skipInvalidItems: true };
      if (childStatus === PodFlashSaleStatus.FAILED) {
        await this.publisher.retry(node.organizationId, null, childId, options, POD_SCOPE_SYSTEM);
      } else {
        await this.publisher.publish(node.organizationId, null, childId, options, POD_SCOPE_SYSTEM);
      }
    } catch (error) {
      const failure = this.publisher.describeFailure(error);
      return this.fail(node, childId, `Đưa đợt kế tiếp lên TikTok thất bại: ${failure.message}`, now);
    }

    await this.publisher.whenPublishIdle(childId);
    const child = await this.prisma.podFlashSale.findUnique({
      where: { id: childId },
      select: { status: true, lastErrorMessage: true },
    });
    if (child?.status === PodFlashSaleStatus.RUNNING) return this.transfer(node, childId, successAction);
    if (child?.status === PodFlashSaleStatus.PUBLISHING) {
      return this.outcome(node, FLASH_SALE_AUTO_ACTION.IN_PROGRESS, childId, 'Đợt kế tiếp vẫn đang được gửi lên TikTok.');
    }
    return this.fail(
      node,
      childId,
      `Đợt kế tiếp chưa lên sàn (${child?.status ?? 'không rõ'})${child?.lastErrorMessage ? `: ${child.lastErrorMessage}` : ''}.`,
      now,
    );
  }

  /**
   * Chuyển Auto A → B trong MỘT transaction. Chỉ gọi khi B đã RUNNING trên TikTok.
   * A đã bị Admin tắt Auto trong lúc chờ ⇒ tôn trọng quyết định đó, KHÔNG bật B.
   */
  private async transfer(node: AutoNode, childId: string, action: FlashSaleAutoAction): Promise<NodeOutcome> {
    const moved = await this.prisma.$transaction(async (tx) => {
      const off = await tx.podFlashSale.updateMany({
        where: { id: node.id, autoMode: true, deletedAt: null },
        data: { autoMode: false },
      });
      if (off.count === 0) return false;
      await tx.podFlashSale.update({ where: { id: childId }, data: { autoMode: true } });
      return true;
    });
    if (!moved) return this.skip(node, childId, 'Đợt hiện tại vừa bị tắt Auto — không chuyển Auto sang đợt kế tiếp.');

    await this.writeChainLog(node.organizationId, node.id, 'Đã chuyển Auto sang đợt kế tiếp (Auto = OFF).', PodFlashSaleLogLevel.INFO);
    await this.writeChainLog(node.organizationId, childId, `Nhận Auto từ "${node.name}" (Auto = ON).`, PodFlashSaleLogLevel.INFO);
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.transfer',
      organizationId: node.organizationId,
      shopId: node.shopId,
      flashSaleId: node.id,
      chainId: node.autoChainId,
      nextFlashSaleId: childId,
      action,
      msg: action === FLASH_SALE_AUTO_ACTION.CREATED ? 'AUTO_FLASH_SALE_CREATED' : 'AUTO_FLASH_SALE_CREATED (transfer)',
    });
    return { action, nextFlashSaleId: childId, message: null };
  }

  // ---------------------------------------------------------------------------
  // Chép dòng
  // ---------------------------------------------------------------------------

  /**
   * Dòng của đợt kế tiếp — ĐỦ mọi dòng của đợt hiện tại (kể cả FAILED/REMOVED; mọi trang: đọc
   * thẳng từ database, không qua phân trang giao diện).
   *
   * Giá: GIỮ % giảm của TỪNG dòng, tính lại giá deal trên giá bán HIỆN TẠI của biến thể (sản
   * phẩm ở mức PRODUCT) — giống Template áp lại. Không lấy được giá hiện tại (SKU đã xoá, sản
   * phẩm chưa có giá) ⇒ chép nguyên cấu hình cũ, dòng vào PENDING/READY theo bộ luật chuẩn và
   * validator nói rõ lý do.
   *
   * KHÔNG chép kết quả chạy: trạng thái dòng, `provider_sku_id`, lỗi cũ.
   */
  private async buildItems(
    source: FlashSaleDetailRow,
  ): Promise<Array<Omit<Prisma.PodFlashSaleItemCreateManyInput, 'organizationId' | 'flashSaleId'>>> {
    const products = await this.prisma.podProduct.findMany({
      where: {
        organizationId: source.organizationId,
        id: { in: [...new Set(source.items.map((item) => item.productId))] },
      },
      select: {
        id: true,
        minPrice: true,
        currency: true,
        tiktokProductId: true,
        variants: {
          where: { deletedAt: null },
          select: { id: true, salePrice: true, listPrice: true, currency: true, tiktokSkuId: true, sellerSku: true },
        },
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const productLevel = source.productLevel === PodFlashSaleProductLevel.PRODUCT;

    return [...source.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item, index) => {
        const product = productById.get(item.productId);
        const variant = item.variantId ? product?.variants.find((v) => v.id === item.variantId) : undefined;
        const currentOriginal = toDecimal(
          productLevel ? (product?.minPrice ?? null) : (variant?.salePrice ?? variant?.listPrice ?? null),
        );
        const repriced =
          currentOriginal && currentOriginal.greaterThan(0)
            ? computeFlashSalePricing({ originalPrice: currentOriginal, discountPercent: item.discountPercent })
            : null;
        const pricing: FlashSalePricing = repriced ?? {
          originalPrice: item.originalPrice,
          flashSalePrice: item.flashSalePrice,
          discountPercent: item.discountPercent,
        };
        const valid =
          validatePricing(pricing).length === 0 &&
          validateQuantityLimit(item.totalPurchaseLimit, 'totalPurchaseLimit').length === 0 &&
          validateQuantityLimit(item.customerPurchaseLimit, 'customerPurchaseLimit').length === 0;

        return {
          productId: item.productId,
          variantId: item.variantId,
          skuId: variant?.sellerSku ?? item.skuId,
          originalPrice: pricing.originalPrice,
          flashSalePrice: pricing.flashSalePrice,
          discountPercent: pricing.discountPercent,
          currency: (productLevel ? product?.currency : variant?.currency) ?? item.currency,
          totalPurchaseLimit: item.totalPurchaseLimit,
          customerPurchaseLimit: item.customerPurchaseLimit,
          providerProductId: product?.tiktokProductId ?? item.providerProductId,
          providerVariantId: variant?.tiktokSkuId ?? item.providerVariantId,
          providerSkuId: null,
          status: valid ? PodFlashSaleItemStatus.READY : PodFlashSaleItemStatus.PENDING,
          sortOrder: index,
        };
      });
  }

  /**
   * `<tên gốc> - Auto #<n>`. Tên gốc bỏ hậu tố Auto cũ (không thành "X - Auto #2 - Auto #3"),
   * cắt để vừa trần 50 ký tự của TikTok, và né tên đã có trong shop.
   */
  private async nextName(organizationId: string, shopId: string, currentName: string, sequence: number): Promise<string> {
    const suffixAt = currentName.lastIndexOf(FLASH_SALE_AUTO_NAME_SUFFIX);
    const base =
      suffixAt >= 0 && /^\d+$/.test(currentName.slice(suffixAt + FLASH_SALE_AUTO_NAME_SUFFIX.length))
        ? currentName.slice(0, suffixAt)
        : currentName;
    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = `${FLASH_SALE_AUTO_NAME_SUFFIX}${sequence}${attempt === 0 ? '' : `-${attempt + 1}`}`;
      const name = `${base.slice(0, TIKTOK_ACTIVITY_MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`;
      const taken = await this.prisma.podFlashSale.findFirst({
        where: { organizationId, shopId, name, deletedAt: null },
        select: { id: true },
      });
      if (!taken) return name;
    }
    throw new PodFlashSaleInvalidStateException('đặt tên đợt kế tiếp (trùng tên)', PodFlashSaleStatus.READY);
  }

  // ---------------------------------------------------------------------------
  // Bật/tắt Auto ở một đợt + xem chuỗi
  // ---------------------------------------------------------------------------

  async setAutoMode(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    enabled: boolean,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);

    if (!enabled) {
      if (flashSale.autoMode) {
        await this.prisma.podFlashSale.update({ where: { id: flashSaleId }, data: { autoMode: false, updatedBy: userId } });
        await this.writeChainLog(organizationId, flashSaleId, 'Tắt Auto — chuỗi dừng ở đợt này.', PodFlashSaleLogLevel.INFO, userId);
      }
      return this.flashSales.get(organizationId, flashSaleId, scope);
    }

    if (flashSale.autoMode) return flashSale;
    if (flashSale.status === PodFlashSaleStatus.CANCELLED) {
      throw new PodFlashSaleInvalidStateException('bật Auto Flash Sale', flashSale.status);
    }
    // Đợt đã sinh ra đợt kế tiếp ⇒ bật lại ở đây sẽ làm cron "chuyển" Auto sang đợt con dù Admin
    // đã chủ động tắt nó. Bật ở đợt cuối chuỗi mới đúng ý định.
    const next = await this.prisma.podFlashSale.findFirst({
      where: { organizationId, autoParentId: flashSaleId, deletedAt: null },
      select: { name: true },
    });
    if (next) throw new PodFlashSaleAutoHasNextException(next.name);

    try {
      await this.prisma.podFlashSale.update({
        where: { id: flashSaleId },
        data: {
          autoMode: true,
          autoChainId: flashSale.autoChainId ?? flashSale.id,
          autoSequence: flashSale.autoSequence ?? 1,
          updatedBy: userId,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error, 'auto_chain')) throw new PodFlashSaleAutoChainActiveException();
      throw error;
    }
    await this.writeChainLog(organizationId, flashSaleId, 'Bật Auto — cron sẽ tạo đợt kế tiếp khi còn ≤ 24 giờ.', PodFlashSaleLogLevel.INFO, userId);
    return this.flashSales.get(organizationId, flashSaleId, scope);
  }

  async getChain(organizationId: string, flashSaleId: string, scope: PodAccessScope): Promise<PodFlashSaleAutoChainDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (!flashSale.autoChainId) return { chainId: null, previousId: null, nextId: null, nodes: [] };

    const nodes = await this.prisma.podFlashSale.findMany({
      where: { organizationId, autoChainId: flashSale.autoChainId, deletedAt: null },
      orderBy: [{ autoSequence: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        status: true,
        startAt: true,
        endAt: true,
        autoMode: true,
        autoSequence: true,
        autoParentId: true,
        providerFlashSaleId: true,
      },
    });
    return {
      chainId: flashSale.autoChainId,
      previousId: flashSale.autoParentId,
      nextId: nodes.find((node) => node.autoParentId === flashSale.id)?.id ?? null,
      nodes: nodes.map((node) => ({
        ...node,
        startAt: node.startAt.toISOString(),
        endAt: node.endAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Tiện ích
  // ---------------------------------------------------------------------------

  private count(result: PodFlashSaleAutoRunResultDto, action: FlashSaleAutoAction): void {
    switch (action) {
      case FLASH_SALE_AUTO_ACTION.NOT_DUE:
        result.notDue += 1;
        break;
      case FLASH_SALE_AUTO_ACTION.CREATED:
        result.created += 1;
        break;
      case FLASH_SALE_AUTO_ACTION.TRANSFERRED:
        result.transferred += 1;
        break;
      case FLASH_SALE_AUTO_ACTION.IN_PROGRESS:
        result.inProgress += 1;
        break;
      case FLASH_SALE_AUTO_ACTION.SKIPPED:
        result.skipped += 1;
        break;
      default:
        result.failed += 1;
    }
  }

  private outcome(node: AutoNode, action: FlashSaleAutoAction, nextFlashSaleId: string | null, message: string): NodeOutcome {
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.skip',
      organizationId: node.organizationId,
      shopId: node.shopId,
      flashSaleId: node.id,
      chainId: node.autoChainId,
      nextFlashSaleId,
      action,
      msg: `AUTO_FLASH_SALE_SKIPPED: ${message}`,
    });
    return { action, nextFlashSaleId, message };
  }

  private skip(node: AutoNode, nextFlashSaleId: string | null, message: string): NodeOutcome {
    return this.outcome(node, FLASH_SALE_AUTO_ACTION.SKIPPED, nextFlashSaleId, message);
  }

  /** Lỗi ⇒ Auto của đợt hiện tại GIỮ NGUYÊN (ON), ghi nhật ký của đợt, lượt sau thử lại. */
  private async fail(node: AutoNode, nextFlashSaleId: string | null, message: string, now: Date): Promise<NodeOutcome> {
    this.logger.error({
      module: 'pod-flash-sale',
      operation: 'flashSale.auto.failed',
      organizationId: node.organizationId,
      shopId: node.shopId,
      accountId: node.accountId,
      flashSaleId: node.id,
      chainId: node.autoChainId,
      currentEndAt: node.endAt.toISOString(),
      remainingMs: node.endAt.getTime() - now.getTime(),
      nextFlashSaleId,
      msg: `AUTO_FLASH_SALE_FAILED: ${message}`,
    });
    await this.writeChainLog(node.organizationId, node.id, `Auto thất bại (Auto vẫn ON): ${message}`, PodFlashSaleLogLevel.ERROR);
    return { action: FLASH_SALE_AUTO_ACTION.FAILED, nextFlashSaleId, message };
  }

  private writeChainLog(
    organizationId: string,
    flashSaleId: string,
    message: string,
    level: PodFlashSaleLogLevel,
    userId: string | null = null,
  ): Promise<void> {
    return this.flashSales.writeLog({
      organizationId,
      flashSaleId,
      action: PodFlashSaleLogAction.AUTO_CHAIN,
      level,
      message,
      userId,
    });
  }

  /** P2002 trên một index cụ thể (tên index chứa `hint`). */
  private isUniqueViolation(error: unknown, hint: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = JSON.stringify(error.meta ?? {});
    return target.includes(hint);
  }
}
