import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodTiktokAccountStatus, PodTiktokTokenAction } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TiktokAuthClient } from '../clients/tiktok-auth.client';
import { TIKTOK_ERROR_CODES, TiktokErrorClass } from '../constants/tiktok-error-code.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { TiktokEncryptionService } from './tiktok-encryption.service';

/** Kết quả đảm bảo token còn dùng được. */
export type EnsureTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | {
      ok: false;
      reason: 'REAUTH_REQUIRED' | 'REFRESH_FAILED';
      errorCode?: string;
      message: string;
    };

/** Thông tin tối thiểu của account cần cho việc quản lý token. */
export interface TokenAccountRef {
  id: string;
  organizationId: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenEnc: string;
  refreshTokenExpiresAt: Date;
}

/**
 * PodTiktokTokenService — vòng đời Access Token / Refresh Token.
 *
 * Quy tắc theo tài liệu chính thức:
 *  - Access token mặc định sống 7 ngày ⇒ phải refresh CHỦ ĐỘNG trước khi hết hạn.
 *  - `token/refresh` trả về **refresh_token MỚI** (rotation) ⇒ hai tiến trình refresh
 *    đồng thời sẽ khiến một bên ghi đè bằng token đã chết ⇒ MẤT KẾT NỐI VĨNH VIỄN.
 *    Vì vậy bắt buộc **single-flight lock** theo từng account.
 *  - Refresh token hết hạn = hết hạn uỷ quyền ⇒ KHÔNG tự phục hồi được,
 *    phải chuyển account sang `REAUTH_REQUIRED` để seller uỷ quyền lại.
 */
@Injectable()
export class PodTiktokTokenService {
  private readonly logger = new Logger(PodTiktokTokenService.name);

  private static readonly LOCK_TTL_MS = 30_000;
  private static readonly LOCK_PREFIX = 'pod:tiktok:token:lock:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly repo: PodTiktokAccountRepository,
    private readonly encryption: TiktokEncryptionService,
    private readonly authClient: TiktokAuthClient,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Đảm bảo account có access token dùng được ngay trước khi gọi API.
   *
   * - Refresh token đã hết hạn → `REAUTH_REQUIRED` (không gọi TikTok cho vô ích).
   * - Access token còn hạn xa → trả token hiện tại.
   * - Access token sắp/đã hết hạn → refresh (single-flight).
   */
  async ensureValidAccessToken(account: TokenAccountRef): Promise<EnsureTokenResult> {
    const now = Date.now();

    if (account.refreshTokenExpiresAt.getTime() <= now) {
      await this.markReauthRequired(account, 'Refresh token đã hết hạn');
      return {
        ok: false,
        reason: 'REAUTH_REQUIRED',
        message: 'Uỷ quyền đã hết hạn — seller cần uỷ quyền lại',
      };
    }

    const thresholdMs = this.config.get<number>('tiktok.sync.refreshBeforeSeconds', 86_400) * 1_000;
    const needsRefresh = account.accessTokenExpiresAt.getTime() - now <= thresholdMs;

    if (!needsRefresh) {
      return {
        ok: true,
        accessToken: this.encryption.decrypt(account.accessTokenEnc),
        refreshed: false,
      };
    }

    return this.refresh(account.id, account.organizationId);
  }

  /**
   * Refresh token cho một account, có single-flight lock.
   *
   * Nếu không giành được khoá ⇒ tiến trình khác đang refresh: chờ ngắn rồi đọc lại DB
   * để dùng token mới, thay vì gọi TikTok lần hai (tránh rotation ghi đè lẫn nhau).
   */
  async refresh(accountId: string, organizationId: string): Promise<EnsureTokenResult> {
    const lockKey = `${PodTiktokTokenService.LOCK_PREFIX}${accountId}`;
    const acquired = await this.lock.acquire(lockKey, PodTiktokTokenService.LOCK_TTL_MS);

    if (!acquired) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'token.refresh',
        accountId,
        msg: 'Tiến trình khác đang refresh — chờ và dùng lại token mới',
      });
      return this.waitForConcurrentRefresh(accountId, organizationId);
    }

    try {
      // Đọc LẠI sau khi giành khoá: refresh token có thể vừa được tiến trình khác xoay vòng.
      const fresh = await this.repo.findTokenRefById(organizationId, accountId);
      if (!fresh) {
        return { ok: false, reason: 'REFRESH_FAILED', message: 'Không tìm thấy kết nối TikTok' };
      }
      if (fresh.refreshTokenExpiresAt.getTime() <= Date.now()) {
        await this.markReauthRequired(fresh, 'Refresh token đã hết hạn');
        return {
          ok: false,
          reason: 'REAUTH_REQUIRED',
          message: 'Uỷ quyền đã hết hạn — seller cần uỷ quyền lại',
        };
      }

      const result = await this.authClient.refreshAccessToken(
        this.encryption.decrypt(fresh.refreshTokenEnc),
      );
      const token = result.data;

      const accessTokenExpiresAt = new Date(Number(token.access_token_expire_in) * 1000);
      const refreshTokenExpiresAt = new Date(Number(token.refresh_token_expire_in) * 1000);

      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateTokensAfterRefresh(tx, accountId, {
          accessTokenEnc: this.encryption.encrypt(token.access_token),
          accessTokenExpiresAt,
          refreshTokenEnc: this.encryption.encrypt(token.refresh_token),
          refreshTokenExpiresAt,
          grantedScopes: token.granted_scopes ?? [],
        });
        await this.repo.insertTokenAudit(tx, {
          organizationId,
          accountId,
          action: PodTiktokTokenAction.REFRESH,
          success: true,
          tiktokRequestId: result.requestId,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
        });
      });

      this.logger.log({
        module: 'pod-tiktok',
        operation: 'token.refresh',
        organizationId,
        accountId,
        tiktokRequestId: result.requestId,
        msg: 'Refresh access token thành công',
      });

      return { ok: true, accessToken: token.access_token, refreshed: true };
    } catch (error) {
      return this.handleRefreshFailure(accountId, organizationId, error);
    } finally {
      await this.lock.release(acquired);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Chờ tiến trình đang refresh hoàn tất rồi đọc token mới từ DB. */
  private async waitForConcurrentRefresh(
    accountId: string,
    organizationId: string,
  ): Promise<EnsureTokenResult> {
    const RETRY_DELAYS_MS = [300, 700, 1_500, 3_000];
    for (const delay of RETRY_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const fresh = await this.repo.findTokenRefById(organizationId, accountId);
      if (!fresh) break;
      if (fresh.accessTokenExpiresAt.getTime() - Date.now() > 60_000) {
        return {
          ok: true,
          accessToken: this.encryption.decrypt(fresh.accessTokenEnc),
          refreshed: true,
        };
      }
    }
    return {
      ok: false,
      reason: 'REFRESH_FAILED',
      message: 'Tiến trình refresh khác chưa hoàn tất — bỏ qua lượt này',
    };
  }

  /** Ghi nhận thất bại: tăng bộ đếm, cập nhật trạng thái, ghi audit. */
  private async handleRefreshFailure(
    accountId: string,
    organizationId: string,
    error: unknown,
  ): Promise<EnsureTokenResult> {
    const clientError = error instanceof TiktokClientError ? error : undefined;
    const errorCode = clientError ? String(clientError.tiktokCode) : 'UNKNOWN';
    const message = clientError?.tiktokMessage ?? (error as Error).message;

    // Uỷ quyền không phục hồi được (token bị thu hồi / scope bị rút) ⇒ cần uỷ quyền lại.
    const needsReauth =
      clientError?.errorClass === TiktokErrorClass.AUTH ||
      clientError?.tiktokCode === TIKTOK_ERROR_CODES.INVALID_CREDENTIAL;

    await this.prisma.$transaction(async (tx) => {
      await this.repo.recordRefreshFailure(tx, accountId, {
        errorCode,
        errorMessage: message.slice(0, 500),
        tiktokRequestId: clientError?.requestId ?? null,
        status: needsReauth ? PodTiktokAccountStatus.REAUTH_REQUIRED : PodTiktokAccountStatus.ERROR,
        failureThreshold: this.config.get<number>('tiktok.sync.failureThreshold', 5),
      });
      await this.repo.insertTokenAudit(tx, {
        organizationId,
        accountId,
        action: PodTiktokTokenAction.REFRESH,
        success: false,
        errorCode,
        tiktokRequestId: clientError?.requestId ?? null,
      });
    });

    this.logger.error({
      module: 'pod-tiktok',
      operation: 'token.refresh',
      organizationId,
      accountId,
      tiktokCode: clientError?.tiktokCode,
      tiktokRequestId: clientError?.requestId,
      errorClass: clientError?.errorClass,
      msg: `Refresh access token thất bại: ${message}`,
    });

    return {
      ok: false,
      reason: needsReauth ? 'REAUTH_REQUIRED' : 'REFRESH_FAILED',
      errorCode,
      message,
    };
  }

  /** Chuyển account sang REAUTH_REQUIRED (không tự phục hồi được). */
  private async markReauthRequired(account: TokenAccountRef, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.markStatus(tx, account.id, PodTiktokAccountStatus.REAUTH_REQUIRED, reason);
    });
    this.logger.warn({
      module: 'pod-tiktok',
      operation: 'token.reauth-required',
      organizationId: account.organizationId,
      accountId: account.id,
      msg: reason,
    });
  }
}
