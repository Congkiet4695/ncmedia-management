import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RefreshToken } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { TokenMeta, TokenService, TokenSubject } from './token.service';

/** Kết quả phát hành Refresh Token (đã lưu DB, chưa cache Redis). */
export interface IssuedRefreshToken {
  /** `id` của bản ghi `refresh_tokens` — định danh phiên dùng cho audit & chuỗi xoay vòng. */
  id: string;
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
 * Kho lưu trữ của toàn bộ vòng đời phiên: tạo (`createRefreshToken`), cache
 * (`cacheRefreshToken`), tra cứu (`findByRawToken`), xoay vòng (`markRotated`) và thu hồi
 * (`revoke*`). Luồng nghiệp vụ nằm ở `RefreshService` — service này chỉ biết lưu trữ.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
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

    const created = await tx.refreshToken.create({
      data: {
        userId: subject.userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });

    return { id: created.id, token, userId: subject.userId, jti, tokenHash, expiresAt };
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


  // ---------------------------------------------------------------------------
  // Refresh Flow — tra cứu / xoay vòng / thu hồi
  // ---------------------------------------------------------------------------

  /**
   * Tìm bản ghi phiên theo refresh token thô.
   *
   * Database là Source of Truth (ADR-006): tra theo `token_hash` (cột UNIQUE nên đây là
   * một index lookup). Trả về CẢ bản ghi đã thu hồi — `RefreshService` cần phân biệt
   * "chưa từng tồn tại" với "đã bị thu hồi" để phát hiện token dùng lại.
   */
  findByRawToken(raw: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(raw) } });
  }

  /**
   * Đánh dấu một phiên đã được xoay vòng — **atomic**.
   *
   * 🔴 Đây là hàng rào chống race duy nhất ở phía server. `updateMany` với điều kiện
   * `revokedAt: null` biến "kiểm tra rồi ghi" thành MỘT câu lệnh: hai request refresh cùng
   * cầm một token thì đúng một request nhận `count === 1` và được phát token mới, request
   * kia nhận `0` và đi vào nhánh ân hạn. Nếu tách thành `findFirst` rồi `update` thì cả hai
   * đều thấy `revokedAt = null` và cả hai đều xoay vòng — mỗi bên vô hiệu hoá token của bên
   * kia, đúng cái vòng lặp đăng xuất mà refresh sinh ra để tránh.
   */
  async markRotated(sessionId: string, replacedById: string | null): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), replacedById },
    });
    return result.count === 1;
  }

  /** Thu hồi MỘT phiên (logout). Trả `false` nếu phiên đã bị thu hồi từ trước. */
  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  /**
   * Thu hồi MỌI phiên còn hiệu lực của một User.
   *
   * Dùng khi phát hiện refresh token bị dùng lại: kẻ tấn công và người dùng thật đang cùng
   * cầm token trong một chuỗi xoay vòng, và không có cách nào biết ai là ai — cắt hết rồi
   * bắt đăng nhập lại là phản ứng đúng duy nhất.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.dropCachedSessions(userId);
    return result.count;
  }

  /** Xoá cache của MỘT phiên. Cache miss là vô hại — DB vẫn là nguồn quyết định. */
  async dropCachedSession(userId: string, jti: string): Promise<void> {
    await this.redis.client.del(`refresh:${userId}:${jti}`).catch(() => undefined);
  }

  /** Xoá cache của MỌI phiên thuộc một User (dùng SCAN — không dùng KEYS trên production). */
  async dropCachedSessions(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    let cursor = '0';
    try {
      do {
        const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) await this.redis.client.del(...keys);
      } while (cursor !== '0');
    } catch {
      // Cache dọn không sạch không ảnh hưởng tính đúng đắn: `revokedAt` trong DB mới là
      // thứ `RefreshService` kiểm tra.
    }
  }

  /** Hash Refresh Token bằng HMAC-SHA256 (secret từ ENV — không hardcode). */
  private hashToken(raw: string): string {
    const secret = this.config.getOrThrow<string>('jwt.refreshHmacSecret');
    return createHmac('sha256', secret).update(raw).digest('hex');
  }
}
