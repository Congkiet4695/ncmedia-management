import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  TIKTOK_AUTHORIZE_PATH,
  TIKTOK_AUTHORIZE_SERVICE_ID_PARAM,
  TIKTOK_AUTHORIZE_STATE_PARAM,
  TIKTOK_OAUTH_STATE_BYTES,
  type TiktokRegion,
} from '../constants/tiktok.constants';
import {
  PodTiktokAuthorizeUrlDto,
  PodTiktokLinkResultDto,
} from '../dto/pod-tiktok-response.dto';
import {
  POD_TIKTOK_OAUTH_ERROR_CODES,
  PodTiktokLinkResultNotFoundException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodTiktokOAuthStateRepository } from '../repositories/pod-tiktok-oauth-state.repository';
import { PodTiktokAccountService, PodTiktokRequestMeta } from './pod-tiktok-account.service';

/** Tham số TikTok gửi về Redirect URL (đã tách khỏi query string ở controller). */
export interface TiktokCallbackParams {
  /** `code` (bí danh `auth_code`) — 🔴 KHÔNG BAO GIỜ log giá trị này. */
  authorizationCode?: string;
  state?: string;
  /** `error=auth_denied` khi Seller bấm Từ chối. */
  error?: string;
}

/** Kết quả xử lý callback — controller chỉ cần biết chuyển hướng đi đâu. */
export interface TiktokCallbackOutcome {
  success: boolean;
  /** Vé một lần để trang kết quả đọc tóm tắt. Không có khi state không hợp lệ. */
  resultToken?: string;
  /** Mã lỗi nghiệp vụ (chỉ khi thất bại). */
  errorCode?: string;
}

/**
 * PodTiktokOAuthService — toàn bộ luồng uỷ quyền TikTok Shop.
 *
 * 🔴 Yêu cầu App Review của TikTok: sau khi Seller Approve trên Seller Center, hệ thống
 * phải TỰ hoàn tất phần còn lại. Người dùng KHÔNG copy, KHÔNG dán `auth_code`.
 *
 * Trình tự (Authorization overview + Connecting shops):
 *   1. `startAuthorization`: người dùng nhập Account Name → sinh `state` một lần,
 *      lưu DB kèm tên đó, dựng authorization link để người dùng copy.
 *   2. Seller Approve → TikTok redirect về Redirect URL kèm `code` + `state`.
 *   3. `handleCallback`: xác thực `state` (nguyên tử, một lần) → đổi token →
 *      Get Authorized Shops → lưu kết nối với đúng Account Name → phát vé đọc kết quả.
 */
@Injectable()
export class PodTiktokOAuthService {
  private readonly logger = new Logger(PodTiktokOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly stateRepo: PodTiktokOAuthStateRepository,
    private readonly accountService: PodTiktokAccountService,
  ) {}

  /**
   * Bước 1 — nhận Account Name, sinh `state` và dựng authorization link để người dùng copy.
   *
   * Domain theo thị trường (Authorization overview):
   *   US  → https://services.us.tiktokshop.com/open/authorize?service_id=...&state=...
   *   ROW → https://services.tiktokshop.com/open/authorize?service_id=...&state=...
   *
   * ⚠️ `redirect_uri` KHÔNG phải tham số của authorization link dành cho Seller: TikTok dùng
   * Redirect URL đã khai báo sẵn trong Partner Center cho app (một app = một Redirect URL).
   * Tự thêm tham số ngoài tài liệu chỉ khiến link bị từ chối — xem `01-tiktok-documentation-summary` §1.2.
   */
  async startAuthorization(
    organizationId: string,
    userId: string,
    accountName: string,
    region?: TiktokRegion,
  ): Promise<PodTiktokAuthorizeUrlDto> {
    const effectiveRegion =
      region ?? (this.config.get<string>('tiktok.defaultRegion', 'US') as TiktokRegion);
    const base =
      effectiveRegion === 'US'
        ? this.config.getOrThrow<string>('tiktok.authorizeBaseUrlUs')
        : this.config.getOrThrow<string>('tiktok.authorizeBaseUrlRow');

    // Dọn rác trước khi ghi thêm — bảng này chỉ chứa dữ liệu tạm thời.
    await this.purgeStaleStates();

    const state = this.generateState();
    const ttlSeconds = this.config.get<number>('tiktok.oauthStateTtlSeconds', 900);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.stateRepo.create({
      organizationId,
      userId,
      accountName,
      state,
      region: effectiveRegion,
      expiresAt,
    });

    const url = new URL(TIKTOK_AUTHORIZE_PATH, base);
    url.searchParams.set(
      TIKTOK_AUTHORIZE_SERVICE_ID_PARAM,
      this.config.getOrThrow<string>('tiktok.serviceId'),
    );
    url.searchParams.set(TIKTOK_AUTHORIZE_STATE_PARAM, state);

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'oauth.start',
      organizationId,
      userId,
      region: effectiveRegion,
      expiresAt: expiresAt.toISOString(),
      msg: 'Đã tạo phiên uỷ quyền TikTok',
    });

    return {
      authorizeUrl: url.toString(),
      accountName,
      region: effectiveRegion,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Bước 3 — xử lý callback từ TikTok. KHÔNG ném lỗi ra ngoài: trình duyệt của Seller
   * đang đứng ở đây, nên mọi nhánh đều kết thúc bằng một hướng chuyển trang.
   *
   * Thứ tự kiểm tra là cố ý: `state` được xác thực TRƯỚC khi đụng tới `auth_code`,
   * để một callback giả mạo không bao giờ khiến hệ thống gọi TikTok.
   */
  async handleCallback(
    params: TiktokCallbackParams,
    meta: PodTiktokRequestMeta = {},
  ): Promise<TiktokCallbackOutcome> {
    const now = new Date();

    if (!params.state) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'oauth.callback',
        msg: 'Callback không có state — từ chối',
      });
      return { success: false, errorCode: POD_TIKTOK_OAUTH_ERROR_CODES.INVALID_STATE };
    }

    // Tiêu thụ state: PENDING + còn hạn → USED, nguyên tử, chỉ một lần.
    const consumed = await this.stateRepo.consume(params.state, now);
    if (!consumed) {
      const existed = await this.stateRepo.markExpiredIfPending(params.state, now);
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'oauth.callback',
        // Không log giá trị state — chỉ ghi việc nó có tồn tại hay không.
        stateKnown: existed,
        msg: existed
          ? 'State đã dùng hoặc hết hạn — từ chối'
          : 'State không tồn tại — từ chối',
      });
      return { success: false, errorCode: POD_TIKTOK_OAUTH_ERROR_CODES.INVALID_STATE };
    }

    // Từ đây đã biết phiên thuộc Organization nào ⇒ mọi kết cục đều tra cứu được.
    const resultToken = this.generateState();

    // Seller bấm Từ chối: TikTok vẫn redirect, nhưng không có code.
    if (params.error || !params.authorizationCode) {
      const errorCode: string = params.error
        ? POD_TIKTOK_OAUTH_ERROR_CODES.AUTH_DENIED
        : POD_TIKTOK_OAUTH_ERROR_CODES.INVALID_STATE;
      await this.stateRepo.markFailed(consumed.id, errorCode, resultToken);
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'oauth.callback',
        organizationId: consumed.organizationId,
        errorCode,
        // Giá trị `error` do TikTok định nghĩa (vd auth_denied) — an toàn để log.
        tiktokError: params.error ?? null,
        msg: 'Uỷ quyền không hoàn tất',
      });
      return { success: false, resultToken, errorCode };
    }

    try {
      const account = await this.accountService.completeAuthorization(
        consumed.organizationId,
        consumed.userId,
        params.authorizationCode,
        // Tên do người dùng nhập ở bước tạo link — đi kèm bản ghi `state` chứ không
        // phải hỏi lại, vì callback không có ngữ cảnh người dùng.
        consumed.accountName,
        meta,
      );
      await this.stateRepo.markSucceeded(consumed.id, account.id, resultToken);

      this.logger.log({
        module: 'pod-tiktok',
        operation: 'oauth.callback',
        organizationId: consumed.organizationId,
        accountId: account.id,
        shopCount: account.shops.length,
        msg: 'Hoàn tất uỷ quyền TikTok tự động',
      });
      return { success: true, resultToken };
    } catch (error) {
      const errorCode = this.extractErrorCode(error);
      await this.stateRepo.markFailed(consumed.id, errorCode, resultToken);
      this.logger.error({
        module: 'pod-tiktok',
        operation: 'oauth.callback',
        organizationId: consumed.organizationId,
        errorCode,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định khi hoàn tất uỷ quyền',
      });
      return { success: false, resultToken, errorCode };
    }
  }

  /**
   * Tóm tắt cho trang kết quả (công khai, người dùng có thể chưa đăng nhập).
   * Chỉ trả dữ liệu hiển thị được: tên shop, region, thời điểm liên kết, mã lỗi.
   */
  async getLinkResult(resultToken: string): Promise<PodTiktokLinkResultDto> {
    const row = await this.stateRepo.findResultByToken(resultToken);
    if (!row) throw new PodTiktokLinkResultNotFoundException();

    const shops = row.account?.shops ?? [];
    return {
      success: Boolean(row.account) && !row.errorCode,
      accountName: row.account?.accountName ?? null,
      sellerName: row.account?.sellerName ?? null,
      shopName: shops[0]?.name ?? null,
      region: shops[0]?.region ?? null,
      shopCount: shops.length,
      linkedAt: row.usedAt ? row.usedAt.toISOString() : null,
      errorCode: row.errorCode,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** 256 bit ngẫu nhiên mã hoá base64url — an toàn để đặt trên URL, không thể đoán. */
  private generateState(): string {
    return randomBytes(TIKTOK_OAUTH_STATE_BYTES).toString('base64url');
  }

  /** Xoá bản ghi quá thời gian lưu giữ. Lỗi dọn rác KHÔNG được chặn luồng uỷ quyền. */
  private async purgeStaleStates(): Promise<void> {
    const retentionHours = this.config.get<number>('tiktok.oauthStateRetentionHours', 72);
    const threshold = new Date(Date.now() - retentionHours * 3600 * 1000);
    try {
      await this.stateRepo.purgeOlderThan(threshold);
    } catch (error) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'oauth.purge',
        msg: error instanceof Error ? error.message : 'Không dọn được state cũ',
      });
    }
  }

  /** Lấy `code` nghiệp vụ trong exception của NestJS để trang lỗi hiển thị đúng nguyên nhân. */
  private extractErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const code = (response as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    return POD_TIKTOK_OAUTH_ERROR_CODES.API_ERROR;
  }
}
