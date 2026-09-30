import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountStatus, PodTiktokShopStatus } from '@prisma/client';
import { TiktokApiClient } from '../clients/tiktok-api.client';
import type { SyncTiktokShopsDto } from '../dto/pod-tiktok-query.dto';
import type {
  PodTiktokShopSyncItemDto,
  PodTiktokShopSyncResultDto,
} from '../dto/pod-tiktok-response.dto';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import {
  PodTiktokShopSyncRepository,
  type ShopSyncAccount,
} from '../repositories/pod-tiktok-shop-sync.repository';
import { runWithBoundedConcurrency } from '../shared/bounded-concurrency';
import { normalizeSellerType } from '../shared/seller-type';
import type { TiktokShopItem } from '../types/tiktok-api.types';
import { PodAccessScopeService, type PodAccessScope } from './pod-access-scope.service';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';

/**
 * Trạng thái KẾT NỐI cho phép gọi TikTok trong Shop Sync.
 *
 * `ERROR` vẫn thử: đó là lỗi refresh tạm thời, token có thể đã dùng lại được. Còn
 * `REAUTH_REQUIRED` / `DEAUTHORIZED` / `DISCONNECTED` / `PENDING` thì gọi chắc chắn hỏng —
 * chỉ đốt quota chung của app — nên BỎ QUA và nói rõ lý do.
 */
const SYNCABLE_ACCOUNT_STATUSES: readonly PodTiktokAccountStatus[] = [
  PodTiktokAccountStatus.ACTIVE,
  PodTiktokAccountStatus.ERROR,
];

/** Mã lý do cho shop KHÔNG được xử lý vì request đã hết ngân sách thời gian. */
const DEADLINE_EXCEEDED_CODE = 'DEADLINE_EXCEEDED';

/**
 * PodTiktokShopSyncService — **"Sync Shops"**: đọc lại thông tin + trạng thái shop từ TikTok.
 *
 * ```
 *  phạm vi người bấm (PodAccessScope)  ← Seller chỉ thấy kết nối được gán; Admin cả tổ chức
 *      ↓
 *  mỗi KẾT NỐI (song song có trần, có deadline)
 *      ├─ kết nối không hoạt động      ⇒ SKIPPED (không gọi TikTok)
 *      ├─ token (tự refresh nếu cần)   ⇒ hỏng ⇒ FAILED cho shop của kết nối đó
 *      ├─ Get Authorized Shops          ⇒ tên, mã, vùng, seller_type, cipher
 *      └─ Get Active Shops              ⇒ shop nào ĐANG HOẠT ĐỘNG
 *      ↓
 *  mỗi SHOP: ACTIVE | INACTIVE | DEAUTHORIZED  (chỉ ghi trường TikTok trả về)
 * ```
 *
 * 🔴 Lỗi ở một kết nối/shop KHÔNG làm hỏng cả lượt: mỗi phần tử tự bắt lỗi của mình và trả về
 * kết quả riêng. Cuối cùng là một bản tổng kết.
 *
 * 🔴 Không có vòng phụ thuộc với module sản phẩm: Product Sync đọc cột `status` do service
 * này ghi, không gọi ngược vào đây.
 */
@Injectable()
export class PodTiktokShopSyncService {
  private readonly logger = new Logger(PodTiktokShopSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: PodTiktokShopSyncRepository,
    private readonly apiClient: TiktokApiClient,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  /**
   * Đồng bộ shop trong phạm vi người dùng.
   *
   * 🔴 Phạm vi lấy từ `PodAccessScope` (đã nạp theo JWT), KHÔNG từ request. `accountId` gửi lên
   * chỉ thu hẹp — ngoài phạm vi là 403 (`assertAccountAllowed`), và truy vấn vẫn GIAO với phạm vi.
   */
  async syncShops(
    organizationId: string,
    actorUserId: string,
    dto: SyncTiktokShopsDto,
    scope: PodAccessScope,
  ): Promise<PodTiktokShopSyncResultDto> {
    this.accessScope.assertAccountAllowed(scope, dto.accountId);

    const accounts = await this.repo.findAccounts(organizationId, {
      accountScope: scope.allShops ? undefined : scope.accountIds,
      accountId: dto.accountId,
    });

    const startedAt = Date.now();
    const deadlineAt =
      startedAt + this.config.get<number>('tiktok.shopSync.requestDeadlineMs', 120_000);

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'shop-sync.start',
      organizationId,
      accounts: accounts.length,
      shops: accounts.reduce((sum, account) => sum + account.shops.length, 0),
      msg: 'Bắt đầu đồng bộ shop TikTok',
    });

    const perAccount = await runWithBoundedConcurrency(
      accounts,
      {
        limit: this.config.get<number>('tiktok.shopSync.concurrency', 2),
        deadlineAt,
        onDeadline: (account) =>
          this.itemsFor(account, 'SKIPPED', {
            code: DEADLINE_EXCEEDED_CODE,
            message: 'Hết thời gian của lượt đồng bộ — hãy chạy lại cho kết nối này.',
          }),
      },
      (account) => this.syncAccount(account, actorUserId),
    );

    const items = perAccount.flat();
    const synced = items.filter((item) => item.result === 'SYNCED');
    const result: PodTiktokShopSyncResultDto = {
      totalShops: items.length,
      syncedShops: synced.length,
      activeShops: synced.filter((item) => item.shopStatus === PodTiktokShopStatus.ACTIVE).length,
      inactiveShops: synced.filter((item) => item.shopStatus === PodTiktokShopStatus.INACTIVE)
        .length,
      deauthorizedShops: synced.filter(
        (item) => item.shopStatus === PodTiktokShopStatus.DEAUTHORIZED,
      ).length,
      skippedShops: items.filter((item) => item.result === 'SKIPPED').length,
      failedShops: items.filter((item) => item.result === 'FAILED').length,
      items,
    };

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'shop-sync.finish',
      organizationId,
      durationMs: Date.now() - startedAt,
      totalShops: result.totalShops,
      syncedShops: result.syncedShops,
      inactiveShops: result.inactiveShops,
      deauthorizedShops: result.deauthorizedShops,
      skippedShops: result.skippedShops,
      failedShops: result.failedShops,
      msg: 'Hoàn tất đồng bộ shop TikTok',
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Một kết nối. Không bao giờ ném lỗi ra ngoài — lỗi thành kết quả của từng shop. */
  private async syncAccount(
    account: ShopSyncAccount,
    actorUserId: string,
  ): Promise<PodTiktokShopSyncItemDto[]> {
    const startedAt = Date.now();
    const scope = { organizationId: account.organizationId, accountId: account.id };

    if (!SYNCABLE_ACCOUNT_STATUSES.includes(account.status)) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'shop-sync.account.skip',
        ...scope,
        accountStatus: account.status,
        msg: 'Kết nối không hoạt động — không gọi TikTok',
      });
      return this.itemsFor(account, 'SKIPPED', {
        code: `ACCOUNT_${account.status}`,
        message: `Kết nối TikTok đang ở trạng thái ${account.status} — cần uỷ quyền lại trước khi đồng bộ.`,
      });
    }

    try {
      const token = await this.tokenService.ensureValidAccessToken(account);
      if (!token.ok) {
        throw new ShopSyncAccountError(token.errorCode ?? token.reason, token.message);
      }

      // Tuần tự trong MỘT kết nối: cả hai là API cấp Seller, dùng chung một token.
      const authorized = await this.apiClient.getAuthorizedShops(token.accessToken);
      const active = await this.apiClient.getActiveShops(token.accessToken);

      const items = await this.applyShops(
        account,
        authorized.shops,
        new Set(active.shopIds),
        actorUserId,
      );

      this.logger.log({
        module: 'pod-tiktok',
        operation: 'shop-sync.account.finish',
        ...scope,
        durationMs: Date.now() - startedAt,
        shops: items.length,
        failed: items.filter((item) => item.result === 'FAILED').length,
        tiktokRequestId: active.requestId ?? authorized.requestId,
        msg: 'Đã đối chiếu shop của kết nối với TikTok',
      });
      return items;
    } catch (error) {
      const described = describeShopSyncError(error);
      this.logger.error({
        module: 'pod-tiktok',
        operation: 'shop-sync.account.fail',
        ...scope,
        durationMs: Date.now() - startedAt,
        errorCode: described.code,
        tiktokRequestId: error instanceof TiktokClientError ? error.requestId : undefined,
        msg: described.message,
      });
      await this.repo
        .recordError(scope, described, actorUserId)
        .catch((writeError: unknown) =>
          this.logger.error({
            module: 'pod-tiktok',
            operation: 'shop-sync.account.record-error.fail',
            ...scope,
            msg: writeError instanceof Error ? writeError.message : String(writeError),
          }),
        );
      return this.itemsFor(account, 'FAILED', described);
    }
  }

  /**
   * Ghi kết quả cho từng shop ĐÃ LIÊN KẾT của kết nối.
   *
   * 🔴 Chỉ cập nhật shop đã có trong hệ thống. Shop mới xuất hiện ở TikTok thì KHÔNG tự thêm:
   * liên kết shop là việc của luồng OAuth (kiểm trùng shop giữa các kết nối, gán seller…).
   */
  private async applyShops(
    account: ShopSyncAccount,
    authorizedShops: TiktokShopItem[],
    activeShopIds: Set<string>,
    actorUserId: string,
  ): Promise<PodTiktokShopSyncItemDto[]> {
    const checkedAt = new Date();
    const authorizedById = new Map(authorizedShops.map((shop) => [shop.id, shop]));
    const items: PodTiktokShopSyncItemDto[] = [];

    for (const shop of account.shops) {
      const scope = { organizationId: account.organizationId, accountId: account.id, shopId: shop.id };
      const remote = authorizedById.get(shop.tiktokShopId);
      try {
        let status: PodTiktokShopStatus;
        let name = shop.name;
        if (!remote) {
          status = PodTiktokShopStatus.DEAUTHORIZED;
          await this.repo.markDeauthorized(scope, checkedAt, actorUserId);
        } else {
          status = activeShopIds.has(shop.tiktokShopId)
            ? PodTiktokShopStatus.ACTIVE
            : PodTiktokShopStatus.INACTIVE;
          name = remote.name;
          await this.repo.applyTiktokShop(
            scope,
            {
              name: remote.name,
              region: remote.region,
              shopCode: remote.code ?? null,
              sellerType: this.sellerTypeOf(remote),
              shopCipherEnc: this.encryption.encrypt(remote.cipher),
              status,
            },
            checkedAt,
            actorUserId,
          );
        }

        if (status !== shop.status) {
          this.logger.log({
            module: 'pod-tiktok',
            operation: 'shop-sync.status-change',
            ...scope,
            from: shop.status,
            to: status,
            msg: 'Trạng thái shop thay đổi theo TikTok',
          });
        }
        items.push(this.itemOf(account, shop, 'SYNCED', status, null, name));
      } catch (error) {
        const described = describeShopSyncError(error);
        this.logger.error({
          module: 'pod-tiktok',
          operation: 'shop-sync.shop.fail',
          ...scope,
          errorCode: described.code,
          msg: described.message,
        });
        items.push(this.itemOf(account, shop, 'FAILED', shop.status, described));
      }
    }

    const linked = new Set(account.shops.map((shop) => shop.tiktokShopId));
    const unlinked = authorizedShops.filter((shop) => !linked.has(shop.id)).length;
    if (unlinked > 0) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'shop-sync.unlinked-shops',
        organizationId: account.organizationId,
        accountId: account.id,
        unlinked,
        msg: 'TikTok có shop được uỷ quyền nhưng chưa liên kết — cần uỷ quyền lại để thêm vào hệ thống',
      });
    }

    return items;
  }

  private sellerTypeOf(shop: TiktokShopItem): string {
    const normalized = normalizeSellerType(shop.seller_type);
    if (!normalized.known) {
      this.logger.warn({
        module: 'pod-tiktok',
        msg: `seller_type không nằm trong danh mục đã biết: "${shop.seller_type}" — tạm ghi nhận LOCAL`,
      });
    }
    return normalized.value;
  }

  /** Cùng một kết quả cho MỌI shop của kết nối (bỏ qua / lỗi cấp kết nối). */
  private itemsFor(
    account: ShopSyncAccount,
    result: 'SKIPPED' | 'FAILED',
    error: { code: string | null; message: string },
  ): PodTiktokShopSyncItemDto[] {
    return account.shops.map((shop) => this.itemOf(account, shop, result, shop.status, error));
  }

  private itemOf(
    account: ShopSyncAccount,
    shop: ShopSyncAccount['shops'][number],
    result: PodTiktokShopSyncItemDto['result'],
    shopStatus: PodTiktokShopStatus,
    error: { code: string | null; message: string } | null,
    shopName: string = shop.name,
  ): PodTiktokShopSyncItemDto {
    return {
      shopId: shop.id,
      shopName,
      tiktokShopId: shop.tiktokShopId,
      accountId: account.id,
      accountName: account.accountName,
      result,
      shopStatus,
      previousShopStatus: shop.status,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    };
  }
}

/** Lỗi cấp kết nối không đến từ TikTok (vd không lấy được token). */
class ShopSyncAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ShopSyncAccountError';
  }
}

/**
 * Lỗi ⇒ `{ code, message }` hiển thị được.
 *
 * Mã TikTok giữ nguyên văn (người vận hành tra được ở tài liệu TikTok); lỗi mạng (mã 0) dùng
 * lớp lỗi (`NETWORK`) để phân biệt timeout với lỗi nghiệp vụ. KHÔNG bao giờ chứa token.
 */
function describeShopSyncError(error: unknown): { code: string | null; message: string } {
  if (error instanceof TiktokClientError) {
    return {
      code: error.tiktokCode ? String(error.tiktokCode) : error.errorClass,
      message: error.tiktokMessage,
    };
  }
  if (error instanceof ShopSyncAccountError) return { code: error.code, message: error.message };
  return { code: null, message: error instanceof Error ? error.message : 'Lỗi không xác định' };
}
