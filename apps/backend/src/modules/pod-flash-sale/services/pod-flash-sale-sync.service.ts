import { Injectable, Logger } from '@nestjs/common';
import { PodFlashSaleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { POD_SCOPE_SYSTEM, type PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import {
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
      msg: 'Đã đồng bộ trạng thái Flash Sale',
    });
    return { scanned: due.length, updated, ended };
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
