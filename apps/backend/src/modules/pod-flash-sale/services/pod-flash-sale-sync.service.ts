import { Injectable, Logger } from '@nestjs/common';
import { PodFlashSaleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { POD_SCOPE_SYSTEM, type PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
  FLASH_SALE_PUBLISH_SWEEP_BATCH,
  FLASH_SALE_PUBLISH_STALE_MS,
  FLASH_SALE_SYNC_BATCH_SIZE,
  FLASH_SALE_SYNCABLE_STATUSES,
} from '../constants/pod-flash-sale.constants';
import type { PodFlashSaleDetailDto } from '../dto/pod-flash-sale-response.dto';
import { PodFlashSalePublisherService } from './pod-flash-sale-publisher.service';
import { PodFlashSaleService } from './pod-flash-sale.service';

/** Kết quả một lượt đồng bộ. */
export interface FlashSaleSyncResult {
  scanned: number;
  updated: number;
  ended: number;
  /** Số lượt publish đứt gánh đã được nhặt lại trong lượt quét này. */
  resumed: number;
}

/**
 * PodFlashSaleSyncService — giữ trạng thái trong hệ thống khớp với trạng thái trên sàn.
 *
 * Hai việc, theo đúng thứ tự rẻ trước đắt sau:
 *
 * 1. **Đóng theo đồng hồ** (không tốn một lượt gọi nào): mọi đợt `RUNNING` đã qua `endAt`
 *    chuyển thẳng sang `ENDED`. Đây là phần lớn công việc và nó không cần hỏi TikTok —
 *    khung giờ chính là con số hệ thống đã gửi đi.
 * 2. **Hỏi TikTok** cho những đợt còn đang chạy hoặc đang publish dở. Chỉ những đợt đó,
 *    và chỉ tối đa `FLASH_SALE_SYNC_BATCH_SIZE` mỗi lượt.
 *
 * 🔴 Đây là tiến trình NỀN, không có người dùng nào đứng sau ⇒ dùng `POD_SCOPE_SYSTEM`.
 * Hằng số đó chỉ được xuất hiện ở những chỗ như thế này; thấy nó trong một controller là bug.
 */
@Injectable()
export class PodFlashSaleSyncService {
  private readonly logger = new Logger(PodFlashSaleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: PodFlashSalePublisherService,
    private readonly flashSales: PodFlashSaleService,
  ) {}

  /**
   * Một lượt đồng bộ cho MỌI tổ chức.
   *
   * Không lọc theo tổ chức: đây là tiến trình của hệ thống (Public App phục vụ nhiều
   * seller), giống `PodProductSyncJob`.
   */
  async syncDueFlashSales(now: Date = new Date()): Promise<FlashSaleSyncResult> {
    const ended = await this.closeExpired(now);
    const resumed = await this.resumeStalledPublishes(now);

    const due = await this.prisma.podFlashSale.findMany({
      where: {
        deletedAt: null,
        status: { in: FLASH_SALE_SYNCABLE_STATUSES },
        providerFlashSaleId: { not: null },
      },
      // Đợt lâu chưa hỏi lại được ưu tiên; `null` (chưa hỏi lần nào) lên đầu.
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      take: FLASH_SALE_SYNC_BATCH_SIZE,
      select: {
        id: true,
        organizationId: true,
        shopId: true,
        providerFlashSaleId: true,
        status: true,
        endAt: true,
      },
    });

    let updated = 0;
    for (const flashSale of due) {
      // Tuần tự chứ không song song: mỗi đợt là một lượt gọi TikTok, và quota được cấp
      // theo App × Shop dùng chung cho mọi tổ chức. Bắn 50 request cùng lúc là cách nhanh
      // nhất để cả hệ thống bị giới hạn tần suất.
      const next = await this.publisher.syncStatus(flashSale);
      if (next !== flashSale.status) updated += 1;
    }

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'sync.tick',
      scanned: due.length,
      updated,
      ended,
      resumed,
      msg: 'Đã đồng bộ trạng thái Flash Sale',
    });
    return { scanned: due.length, updated, ended, resumed };
  }

  /**
   * Nhặt lại các lượt publish ĐỨT GÁNH.
   *
   * 🔴 Vì sao cần: lượt gửi lô chạy trong tiến trình API. Deploy, OOM hay một lần restart
   * giữa lô 12 và lô 13 sẽ để đợt sale kẹt ở `PUBLISHING` mãi mãi — trên sàn thì hoạt động
   * đã có 3.600 SKU, trong hệ thống thì không ai gửi nốt phần còn lại. Đây là thứ thay cho
   * "job đã chết" của một hàng đợi có broker: trạng thái thật nằm ở DATABASE, nên chỉ cần
   * một lượt quét là tìm lại được việc dở.
   *
   * 🔴 Mốc `FLASH_SALE_PUBLISH_STALE_MS` dài hơn TTL khoá rất nhiều. Khoá hết hạn chỉ nói
   * "không ai đang giữ"; mốc này mới nói "chắc chắn không còn ai chạy". Đặt sát nhau là tự
   * cướp việc của một lượt đang chạy chậm và gửi trùng lô.
   */
  private async resumeStalledPublishes(now: Date): Promise<number> {
    const threshold = new Date(now.getTime() - FLASH_SALE_PUBLISH_STALE_MS);

    const stalled = await this.prisma.podFlashSale.findMany({
      where: {
        deletedAt: null,
        status: PodFlashSaleStatus.PUBLISHING,
        // Nhịp tim được cập nhật sau MỖI lô. Đứng yên quá lâu = tiến trình đã chết.
        // `null` là lượt cũ có từ trước khi có cột này — cũng coi là mồ côi.
        OR: [{ publishHeartbeatAt: { lt: threshold } }, { publishHeartbeatAt: null }],
      },
      orderBy: { publishHeartbeatAt: { sort: 'asc', nulls: 'first' } },
      take: FLASH_SALE_PUBLISH_SWEEP_BATCH,
      select: { id: true, organizationId: true, publishRunId: true },
    });

    let resumed = 0;
    for (const flashSale of stalled) {
      try {
        // Tuần tự: mỗi lượt nhặt lại kéo theo một loạt lời gọi TikTok của riêng nó.
        if (await this.publisher.resumeStalledPublish(flashSale)) resumed += 1;
      } catch (error) {
        // Một đợt không nhặt được không được làm hỏng lượt quét của các đợt còn lại.
        this.logger.error({
          module: 'pod-flash-sale',
          operation: 'sync.resume',
          flashSaleId: flashSale.id,
          msg: `Không nhặt lại được lượt publish: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
        });
      }
    }
    return resumed;
  }

  /**
   * Đồng bộ MỘT đợt theo yêu cầu người dùng (nút Refresh ở màn hình chi tiết).
   *
   * Đi qua `get()` để phép kiểm phạm vi shop được thực hiện như mọi đường khác.
   */
  async syncOne(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleDetailDto> {
    const flashSale = await this.flashSales.get(organizationId, id, scope);
    await this.publisher.syncStatus(flashSale);
    return this.flashSales.getDetail(organizationId, id, scope);
  }

  /**
   * Đóng các đợt đã quá giờ kết thúc.
   *
   * 🔴 Một lệnh `updateMany` cho mọi tổ chức: không có lượt gọi mạng nào ở đây, nên không
   * có lý do gì phải chia lô hay giới hạn số lượng.
   */
  private async closeExpired(now: Date): Promise<number> {
    const result = await this.prisma.podFlashSale.updateMany({
      where: {
        deletedAt: null,
        status: PodFlashSaleStatus.RUNNING,
        endAt: { lte: now },
      },
      data: { status: PodFlashSaleStatus.ENDED },
    });
    return result.count;
  }

  /** Phạm vi dùng cho tiến trình nền — công khai để scheduler đọc được cùng một hằng số. */
  static readonly SYSTEM_SCOPE = POD_SCOPE_SYSTEM;
}
