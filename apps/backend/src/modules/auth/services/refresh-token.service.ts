import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';
import { TokenMeta, TokenService, TokenSubject } from './token.service';

/** Kết quả phát hành Refresh Token (đã lưu DB, chưa cache Redis). */
export interface IssuedRefreshToken {
  /** raw refresh token (JWT) trả cho client. */
  token: string;
  userId: string;
  /** jti nằm trong JWT — dùng làm khóa cache Redis. */
  jti: string;
  /** hash HMAC-SHA256 (giá trị lưu DB + cache). */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * RefreshTokenService — phát hành & lưu trữ Refresh Token khi Login.
 *
 * Theo ADR-006 (rev 2026-07-14):
 *   - Database (`refresh_tokens`) là Source of Truth; lưu HASH HMAC-SHA256 (không plain text).
 *   - Redis chỉ là Cache (`refresh:{userId}:{jti}`) để tra cứu nhanh.
 *
 * CHỈ tạo (createRefreshToken) + cache (cacheRefreshToken). KHÔNG implement Refresh Flow
 * (verify/rotate/revoke) — ngoài phạm vi Login.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Tạo + lưu Refresh Token (Source of Truth) trong transaction của Login:
   *   1. Ký JWT HS256 (TokenService.createRefreshToken).
   *   2. Hash HMAC-SHA256 token (không lưu plain text).
   *   3. Lưu DB `refresh_tokens` (dùng transaction client — cùng transaction với cập nhật trạng thái).
   *
   * KHÔNG ghi Redis ở đây (tránh I/O ngoài trong transaction DB) — xem `cacheRefreshToken`.
   */
  async createRefreshToken(
    tx: Prisma.TransactionClient,
    subject: TokenSubject,
    meta: TokenMeta = {},
  ): Promise<IssuedRefreshToken> {
    const { token, jti, expiresAt } = await this.tokenService.createRefreshToken(subject);
    const tokenHash = this.hashToken(token);

    await tx.refreshToken.create({
      data: {
        userId: subject.userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });

    return { token, userId: subject.userId, jti, tokenHash, expiresAt };
  }

  /**
   * Ghi cache Redis `refresh:{userId}:{jti}` → tokenHash (TTL = hạn còn lại của refresh).
   * Gọi SAU khi transaction commit. Redis chỉ là Cache (ADR-006): nếu lỗi/miss thì
   * Refresh Flow (sprint sau) fallback về DB — không ảnh hưởng tính đúng đắn của Login.
   */
  async cacheRefreshToken(issued: IssuedRefreshToken): Promise<void> {
    const ttlSeconds = Math.max(1, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000));
    await this.redis.client.set(
      `refresh:${issued.userId}:${issued.jti}`,
      issued.tokenHash,
      'EX',
      ttlSeconds,
    );
  }

  /** Hash Refresh Token bằng HMAC-SHA256 (secret từ ENV — không hardcode). */
  private hashToken(raw: string): string {
    const secret = this.config.getOrThrow<string>('jwt.refreshHmacSecret');
    return createHmac('sha256', secret).update(raw).digest('hex');
  }
}
