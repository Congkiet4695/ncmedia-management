import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentTrigger } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { CatalogSyncResultDto, FulfillmentAccountDto, PlatformProviderDto } from '../dto/fulfillment.dto';
import { FulfillmentAccountNotFoundException } from '../exceptions/fulfillment.exceptions';
import { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentCatalogSyncService } from './fulfillment-catalog-sync.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * PlatformFulfillmentService — nghiệp vụ của khu vực quản trị NỀN TẢNG.
 *
 * 🔴 Khác `FulfillmentService` ở đúng một điểm: **không có `organizationId`**. Super Admin
 * nhìn toàn bộ nhà cung cấp của nền tảng, còn mọi đường của tổ chức vẫn phải đi qua hàng rào
 * tenant như cũ. Vì thế hai nghiệp vụ nằm ở hai service, không trộn cờ `isPlatform` vào một
 * hàm dùng chung rồi quên kiểm ở một nhánh nào đó.
 *
 * 🔴 Đồng bộ danh mục dùng LẠI `FulfillmentCatalogSyncService` — đúng một đường ghi danh mục
 * cho cả nền tảng lẫn tổ chức, nên không thể có hai kiểu chuẩn hoá dữ liệu khác nhau.
 */
@Injectable()
export class PlatformFulfillmentService {
  private readonly logger = new Logger(PlatformFulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FulfillmentRepository,
    private readonly catalogRepo: FulfillmentCatalogRepository,
    private readonly catalogSync: FulfillmentCatalogSyncService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  /** Mọi nhà cung cấp của nền tảng, kèm số liệu danh mục ĐẾM THẬT trong database. */
  async list(): Promise<PlatformProviderDto[]> {
    const accounts = await this.prisma.fulfillmentAccount.findMany({
      where: { deletedAt: null },
      orderBy: [{ isGlobal: 'desc' }, { createdAt: 'asc' }],
      include: { organization: { select: { name: true } } },
    });

    // Đếm từng tài khoản: số lượng tài khoản ở cấp nền tảng là hàng đơn vị, không phải N+1
    // đáng lo — và con số phải là số THẬT trong database, không phải con số nhà cung cấp báo.
    return Promise.all(
      accounts.map(async (account) => {
        const [counts, lastSyncedAt, lastLog] = await Promise.all([
          this.catalogRepo.countActive(account.id),
          this.catalogRepo.lastSyncedAt(account.id),
          this.prisma.fulfillmentSyncLog.findFirst({
            where: { accountId: account.id },
            orderBy: { createdAt: 'desc' },
            select: { status: true, errorMessage: true, createdAt: true },
          }),
        ]);

        return {
          id: account.id,
          name: account.name,
          provider: account.provider,
          isActive: account.isActive,
          isGlobal: account.isGlobal,
          ownerOrganizationName: account.organization?.name ?? null,
          catalogues: counts.catalogues,
          products: counts.products,
          variants: counts.variants,
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
          lastSyncStatus: lastLog?.status ?? null,
          lastSyncMessage: lastLog?.errorMessage ?? null,
          lastSyncAt: lastLog?.createdAt?.toISOString() ?? null,
        };
      }),
    );
  }

  /** Bật/tắt chế độ dùng chung. Không đụng tới danh mục, ánh xạ hay đơn đã gửi. */
  async setGlobal(actorUserId: string, accountId: string, isGlobal: boolean): Promise<FulfillmentAccountDto> {
    const account = await this.prisma.fulfillmentAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!account) throw new FulfillmentAccountNotFoundException();

    const updated = await this.repo.updateAccount(accountId, { isGlobal, updatedBy: actorUserId });

    this.logger.log({
      module: 'fulfillment',
      operation: 'platform.provider.setGlobal',
      accountId,
      provider: account.provider,
      isGlobal,
      actorUserId,
      msg: isGlobal
        ? 'Nhà cung cấp được chia sẻ cho MỌI tổ chức'
        : 'Nhà cung cấp trở lại phạm vi tổ chức sở hữu',
    });

    return this.fulfillment.toAccountDto(updated);
  }

  /**
   * Đồng bộ danh mục của một nhà cung cấp.
   *
   * Đi qua đúng `FulfillmentCatalogSyncService.syncAccount` mà tổ chức vẫn dùng, chỉ khác là
   * `organizationId` lấy từ CHÍNH tài khoản (Super Admin không thuộc tổ chức nghiệp vụ nào).
   */
  async syncCatalog(accountId: string): Promise<CatalogSyncResultDto> {
    const account = await this.prisma.fulfillmentAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!account) throw new FulfillmentAccountNotFoundException();

    return this.catalogSync.syncAccount(
      account.organizationId,
      account.id,
      FulfillmentTrigger.MANUAL,
    );
  }
}
