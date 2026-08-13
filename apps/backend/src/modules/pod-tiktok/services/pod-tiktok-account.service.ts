import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountStatus, PodTiktokTokenAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  TIKTOK_AUTHORIZE_PATH,
  TIKTOK_SELLER_USER_TYPES,
  TIKTOK_SELLER_TYPES,
  type TiktokRegion,
} from '../constants/tiktok.constants';
import {
  TIKTOK_ERROR_CODES,
  TiktokErrorClass,
} from '../constants/tiktok-error-code.constants';
import { TiktokApiClient } from '../clients/tiktok-api.client';
import { TiktokAuthClient } from '../clients/tiktok-auth.client';
import { LinkTiktokAccountDto } from '../dto/link-account.dto';
import {
  AssignFulfillmentProviderDto,
  AssignPodSellerDto,
  PodSellerOptionQueryDto,
  PodTiktokAccountQueryDto,
} from '../dto/pod-tiktok-query.dto';
import {
  PaginatedPodTiktokAccountResponseDto,
  PodSellerOptionDto,
  PodTiktokAccountResponseDto,
  PodTiktokAuthorizeUrlDto,
} from '../dto/pod-tiktok-response.dto';
import {
  PodTiktokAccountAlreadyLinkedException,
  PodTiktokAccountNotFoundException,
  PodTiktokApiException,
  PodTiktokApiTimeoutException,
  PodTiktokInvalidAuthCodeException,
  PodTiktokInvalidUserTypeException,
  PodTiktokNoShopException,
  PodTiktokRateLimitedException,
  PodTiktokScopeMissingException,
  PodTiktokFulfillmentProviderInvalidException,
  PodTiktokSellerInvalidException,
  PodTiktokShopAlreadyLinkedException,
  TiktokClientError,
} from '../exceptions/pod-tiktok.exceptions';
import { PodTiktokAccountMapper } from '../mappers/pod-tiktok-account.mapper';
import {
  PodTiktokAccountRepository,
  PodTiktokAccountWriteData,
} from '../repositories/pod-tiktok-account.repository';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { TiktokShopItem, TiktokTokenData } from '../types/tiktok-api.types';

/** Metadata request để ghi audit token. */
export interface PodTiktokRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * PodTiktokAccountService — nghiệp vụ Link TikTok Shop Account (Sprint 1).
 *
 * Luồng đúng theo tài liệu chính thức TikTok:
 *   Bước 1: đổi `auth_code` → access_token + refresh_token (+ expire time, open_id, user_type).
 *   Bước 2: gọi Get Authorized Shops → toàn bộ shop (có thể NHIỀU shop) + shop_cipher.
 *   Bước 3: lưu DB trong MỘT transaction (token & cipher đã mã hoá AES-256-GCM).
 *
 * Tenant isolation: mọi thao tác nhận `organizationId` từ JWT (ADR-004).
 */
@Injectable()
export class PodTiktokAccountService {
  private readonly logger = new Logger(PodTiktokAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly repo: PodTiktokAccountRepository,
    private readonly mapper: PodTiktokAccountMapper,
    private readonly encryption: TiktokEncryptionService,
    private readonly authClient: TiktokAuthClient,
    private readonly apiClient: TiktokApiClient,
  ) {}

  /**
   * Sinh authorization link để Seller mở, đăng nhập và Approve.
   * Domain theo thị trường (Authorization overview):
   *   US  → https://services.us.tiktokshop.com/open/authorize?service_id=...
   *   ROW → https://services.tiktokshop.com/open/authorize?service_id=...
   */
  buildAuthorizeUrl(region?: TiktokRegion): PodTiktokAuthorizeUrlDto {
    const effectiveRegion =
      region ?? (this.config.get<string>('tiktok.defaultRegion', 'US') as TiktokRegion);
    const base =
      effectiveRegion === 'US'
        ? this.config.getOrThrow<string>('tiktok.authorizeBaseUrlUs')
        : this.config.getOrThrow<string>('tiktok.authorizeBaseUrlRow');

    const url = new URL(TIKTOK_AUTHORIZE_PATH, base);
    url.searchParams.set('service_id', this.config.getOrThrow<string>('tiktok.serviceId'));
    return { authorizeUrl: url.toString(), region: effectiveRegion };
  }

  /**
   * Link TikTok Shop Account bằng Authorization Code do Seller dán vào.
   *
   * Gọi TikTok TRƯỚC transaction (I/O ngoài không nằm trong transaction DB),
   * sau đó ghi DB nguyên tử ở bước cuối.
   */
  async link(
    organizationId: string,
    actorUserId: string,
    dto: LinkTiktokAccountDto,
    meta: PodTiktokRequestMeta = {},
  ): Promise<PodTiktokAccountResponseDto> {
    // --- Bước 1: đổi Authorization Code lấy token ---
    const tokenResult = await this.exchangeAuthorizationCode(dto.authorizationCode);
    const token = tokenResult.data;

    // Chỉ chấp nhận token của Seller (0) / Global Selling seller (4,5).
    if (!TIKTOK_SELLER_USER_TYPES.includes(token.userTypeSafe)) {
      throw new PodTiktokInvalidUserTypeException(token.userTypeSafe);
    }

    // --- Bước 2: lấy toàn bộ shop đã uỷ quyền (có thể nhiều shop) ---
    const shopsResult = await this.fetchAuthorizedShops(token.access_token);
    const shops = shopsResult.shops;
    if (shops.length === 0) throw new PodTiktokNoShopException();

    // --- Bước 3: ghi DB nguyên tử ---
    const accountId = await this.persistLink(
      organizationId,
      actorUserId,
      dto.accountName,
      token,
      shops,
      { requestId: tokenResult.requestId, ...meta },
    );

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.link',
      organizationId,
      accountId,
      shopCount: shops.length,
      msg: 'Đã liên kết TikTok Shop account',
    });

    return this.findOne(organizationId, accountId);
  }

  async findAll(
    organizationId: string,
    query: PodTiktokAccountQueryDto,
  ): Promise<PaginatedPodTiktokAccountResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findMany(organizationId, {
      page,
      limit,
      search: query.search,
      status: query.status,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    });
    return {
      items: items.map((item) => this.mapper.toListItem(item)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(organizationId: string, id: string): Promise<PodTiktokAccountResponseDto> {
    const account = await this.repo.findById(organizationId, id);
    if (!account) throw new PodTiktokAccountNotFoundException();
    return this.mapper.toResponse(account);
  }

  /**
   * Danh sách Employee được phép chọn làm Seller phụ trách (đổ vào dropdown).
   * Cùng bộ điều kiện với validation khi phân công ⇒ UI không bao giờ hiển thị lựa chọn
   * mà backend sẽ từ chối.
   */
  async findSellerOptions(
    organizationId: string,
    query: PodSellerOptionQueryDto,
  ): Promise<PodSellerOptionDto[]> {
    const rows = await this.repo.findEligibleSellers(organizationId, query.search || undefined);
    return rows.map((row) => ({
      id: row.id,
      fullName: row.user.fullName,
      email: row.user.email,
    }));
  }

  /**
   * Phân công / bỏ phân công Seller phụ trách (`sellerId = null` để bỏ).
   *
   * `sellerId` là ID **Employee**. Điều kiện hợp lệ (kiểm ở repository, một truy vấn):
   * cùng Organization + hồ sơ ACTIVE + Role `EMPLOYEE`. Admin/Fulfillment bị từ chối.
   *
   * Đổi người phụ trách có hiệu lực NGAY trên toàn hệ thống (Order, Payout, Dashboard)
   * vì các nơi đó join ngược qua account chứ không lưu bản sao seller.
   */
  /**
   * Gán nhà cung cấp fulfillment cho một kết nối TikTok.
   *
   * Chỉ chấp nhận nhà cung cấp CÙNG TỔ CHỨC và đang ACTIVE — chặn ngay tại đây thay vì để
   * lỗi hiện ra lúc gửi đơn, khi người dùng đã tưởng mọi thứ đã cấu hình xong.
   */
  async assignFulfillmentAccount(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: AssignFulfillmentProviderDto,
  ): Promise<PodTiktokAccountResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new PodTiktokAccountNotFoundException();

    if (dto.fulfillmentAccountId) {
      const eligible = await this.repo.isEligibleFulfillmentAccount(
        organizationId,
        dto.fulfillmentAccountId,
      );
      if (!eligible) throw new PodTiktokFulfillmentProviderInvalidException();
    }

    await this.repo.assignFulfillmentAccount(
      existing.id,
      dto.fulfillmentAccountId ?? null,
      actorUserId,
    );
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.assign-fulfillment-provider',
      organizationId,
      accountId: id,
      fulfillmentAccountId: dto.fulfillmentAccountId ?? null,
      previousFulfillmentAccountId: existing.fulfillmentAccountId,
      msg: dto.fulfillmentAccountId
        ? 'Đã gán nhà cung cấp fulfillment'
        : 'Đã bỏ gán nhà cung cấp fulfillment',
    });

    return this.findOne(organizationId, id);
  }

  async assignSeller(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: AssignPodSellerDto,
  ): Promise<PodTiktokAccountResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new PodTiktokAccountNotFoundException();

    if (dto.sellerId) {
      const eligible = await this.repo.isEligibleSeller(organizationId, dto.sellerId);
      if (!eligible) throw new PodTiktokSellerInvalidException();
    }

    await this.repo.assignSeller(existing.id, dto.sellerId ?? null, actorUserId);
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.assign-seller',
      organizationId,
      accountId: id,
      sellerId: dto.sellerId ?? null,
      previousSellerId: existing.sellerId,
      msg: dto.sellerId ? 'Đã phân công Seller phụ trách' : 'Đã bỏ phân công Seller',
    });

    return this.findOne(organizationId, id);
  }

  /**
   * Unlink — ngắt kết nối phía NCMedia: xoá mềm kết nối + shop, ghi audit.
   *
   * ⚠️ TikTok KHÔNG cung cấp API để developer thu hồi uỷ quyền
   * (tài liệu "Disconnecting shops"). Đây là hành động cục bộ; muốn thu hồi thật,
   * Seller phải vào Seller Center → App Store → My apps and incidents.
   */
  async unlink(
    organizationId: string,
    actorUserId: string,
    id: string,
    meta: PodTiktokRequestMeta = {},
  ): Promise<void> {
    const account = await this.repo.findById(organizationId, id);
    if (!account) throw new PodTiktokAccountNotFoundException();

    await this.prisma.$transaction(async (tx) => {
      await this.repo.softDeleteAccount(tx, account.id, actorUserId);
      await this.repo.insertTokenAudit(tx, {
        organizationId,
        accountId: account.id,
        action: PodTiktokTokenAction.REVOKE_LOCAL,
        success: true,
        performedBy: actorUserId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    });

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'account.unlink',
      organizationId,
      accountId: account.id,
      msg: 'Đã ngắt kết nối TikTok Shop account (local disconnect)',
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Bước 1 — đổi auth_code lấy token, dịch lỗi TikTok sang exception nghiệp vụ. */
  private async exchangeAuthorizationCode(authorizationCode: string): Promise<{
    data: TiktokTokenData & { userTypeSafe: number };
    requestId?: string;
  }> {
    try {
      const result = await this.authClient.getAccessToken(authorizationCode);
      return {
        data: { ...result.data, userTypeSafe: Number(result.data.user_type) },
        requestId: result.requestId,
      };
    } catch (error) {
      throw this.translateTiktokError(error, 'TOKEN_GET');
    }
  }

  /** Bước 2 — lấy shop đã uỷ quyền. */
  private async fetchAuthorizedShops(
    accessToken: string,
  ): Promise<{ shops: TiktokShopItem[]; requestId?: string }> {
    try {
      return await this.apiClient.getAuthorizedShops(accessToken);
    } catch (error) {
      throw this.translateTiktokError(error, 'GET_AUTHORIZED_SHOPS');
    }
  }

  /** Bước 3 — ghi DB nguyên tử: kết nối + shop + audit. */
  private async persistLink(
    organizationId: string,
    actorUserId: string,
    accountName: string,
    token: TiktokTokenData & { userTypeSafe: number },
    shops: TiktokShopItem[],
    meta: PodTiktokRequestMeta & { requestId?: string },
  ): Promise<string> {
    const writeData: PodTiktokAccountWriteData = {
      accountName,
      openId: token.open_id,
      sellerName: token.seller_name ?? null,
      sellerBaseRegion: token.seller_base_region ?? null,
      userType: token.userTypeSafe,
      accessTokenEnc: this.encryption.encrypt(token.access_token),
      accessTokenExpiresAt: this.unixToDate(token.access_token_expire_in),
      refreshTokenEnc: this.encryption.encrypt(token.refresh_token),
      refreshTokenExpiresAt: this.unixToDate(token.refresh_token_expire_in),
      grantedScopes: token.granted_scopes ?? [],
      status: PodTiktokAccountStatus.ACTIVE,
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Kết nối cũ của cùng seller (kể cả đã xoá mềm) → uỷ quyền lại, không tạo bản ghi mới.
        const existing = await this.repo.findByOpenIdIncludingDeleted(
          tx,
          organizationId,
          token.open_id,
        );

        // Chặn link trùng Shop: shop đang thuộc kết nối KHÁC trong cùng Organization.
        const conflicts = await this.repo.findConflictingShops(
          tx,
          organizationId,
          shops.map((shop) => shop.id),
          existing?.id,
        );
        if (conflicts.length > 0) {
          throw new PodTiktokShopAlreadyLinkedException(conflicts[0].name);
        }

        let accountId: string;
        let action: PodTiktokTokenAction;

        if (existing) {
          // Bản ghi còn sống → coi như uỷ quyền lại (REAUTHORIZE); đã xoá mềm → khôi phục.
          accountId = existing.id;
          action = existing.deletedAt
            ? PodTiktokTokenAction.ISSUE
            : PodTiktokTokenAction.REAUTHORIZE;
          await this.repo.updateAccountTokens(tx, accountId, actorUserId, writeData);
        } else {
          const created = await this.repo.createAccount(
            tx,
            organizationId,
            actorUserId,
            writeData,
          );
          accountId = created.id;
          action = PodTiktokTokenAction.ISSUE;
        }

        for (const shop of shops) {
          await this.repo.upsertShop(tx, organizationId, accountId, actorUserId, {
            tiktokShopId: shop.id,
            shopCipherEnc: this.encryption.encrypt(shop.cipher),
            shopCode: shop.code ?? null,
            name: shop.name,
            region: shop.region,
            sellerType: this.normalizeSellerType(shop.seller_type),
          });
        }
        // Shop không còn được uỷ quyền → xoá mềm để không đồng bộ nhầm ở Sprint sau.
        await this.repo.softDeleteShopsNotIn(
          tx,
          accountId,
          shops.map((shop) => shop.id),
          actorUserId,
        );

        await this.repo.insertTokenAudit(tx, {
          organizationId,
          accountId,
          action,
          success: true,
          tiktokRequestId: meta.requestId,
          accessTokenExpiresAt: writeData.accessTokenExpiresAt,
          refreshTokenExpiresAt: writeData.refreshTokenExpiresAt,
          performedBy: actorUserId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });

        return accountId;
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  /**
   * `seller_type` được TikTok trả về dạng chuỗi. Chuẩn hoá về giá trị hợp lệ
   * (CHECK constraint ở DB chỉ chấp nhận LOCAL | CROSS_BORDER); giá trị lạ →
   * mặc định LOCAL + ghi cảnh báo, để việc TikTok thêm enum mới không làm hỏng link.
   */
  private normalizeSellerType(value: string): string {
    const upper = (value ?? '').toUpperCase();
    if ((TIKTOK_SELLER_TYPES as readonly string[]).includes(upper)) return upper;
    this.logger.warn({
      module: 'pod-tiktok',
      msg: `seller_type không nằm trong danh mục đã biết: "${value}" — tạm ghi nhận LOCAL`,
    });
    return 'LOCAL';
  }

  /** Unix seconds (TikTok) → Date. */
  private unixToDate(seconds: number): Date {
    return new Date(Number(seconds) * 1000);
  }

  /**
   * Dịch lỗi thô từ client TikTok sang exception nghiệp vụ.
   * KHÔNG trả nguyên văn message của TikTok ra người dùng; giữ chi tiết trong log.
   */
  private translateTiktokError(error: unknown, endpoint: string): Error {
    if (!(error instanceof TiktokClientError)) {
      return error instanceof Error ? error : new PodTiktokApiException();
    }

    this.logger.error({
      module: 'pod-tiktok',
      endpoint,
      tiktokCode: error.tiktokCode,
      tiktokRequestId: error.requestId,
      errorClass: error.errorClass,
      httpStatus: error.httpStatus,
      msg: error.tiktokMessage,
    });

    if (error.tiktokCode === TIKTOK_ERROR_CODES.INVALID_AUTH_CODE) {
      return new PodTiktokInvalidAuthCodeException();
    }
    if (error.tiktokCode === TIKTOK_ERROR_CODES.SCOPE_DENIED) {
      return new PodTiktokScopeMissingException();
    }
    switch (error.errorClass) {
      case TiktokErrorClass.RATE_LIMIT:
        return new PodTiktokRateLimitedException();
      case TiktokErrorClass.NETWORK:
        return new PodTiktokApiTimeoutException();
      case TiktokErrorClass.AUTH:
        // Token/credential không hợp lệ khi vừa đổi code ⇒ nguyên nhân thực tế là code sai.
        return new PodTiktokInvalidAuthCodeException();
      default:
        return new PodTiktokApiException();
    }
  }

  /** Vi phạm UNIQUE ở DB → exception nghiệp vụ rõ nghĩa (hàng rào cuối cùng). */
  private mapWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // `meta.target` có thể là string hoặc string[] tuỳ phiên bản Prisma/driver.
      const rawTarget: unknown = error.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      if (target.includes('tiktok_shop_id')) return new PodTiktokShopAlreadyLinkedException();
      if (target.includes('open_id')) return new PodTiktokAccountAlreadyLinkedException();
    }
    return error instanceof Error ? error : new PodTiktokApiException();
  }
}
