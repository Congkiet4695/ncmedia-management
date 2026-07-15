import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // access TTL (giây)
}

export interface TokenSubject {
  userId: string;
  organizationId: string;
  roleCode: string;
}

export interface TokenMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * TokenService — CHỈ PHÁT HÀNH token phục vụ Register.
 * KHÔNG verify / rotate / revoke (đó là Login/Refresh/Logout — ngoài phạm vi).
 *
 * - Access Token: JWT HS256 (ADR-021), TTL 15m (ADR-006).
 * - Refresh Token: chuỗi opaque; lưu HASH HMAC-SHA256 vào bảng refresh_tokens
 *   (Database là Source of Truth — ADR-006 rev). Không lưu plain text.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokens(subject: TokenSubject, meta: TokenMeta = {}): Promise<AuthTokens> {
    const accessSecret = this.config.getOrThrow<string>('jwt.accessSecret');
    const accessTtl = this.config.get<string>('jwt.accessTtl', '15m');
    const refreshTtl = this.config.get<string>('jwt.refreshTtl', '7d');

    const accessExpiresInSec = Math.floor(this.parseDurationToMs(accessTtl) / 1000);
    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync(
      {
        sub: subject.userId,
        organizationId: subject.organizationId,
        role: subject.roleCode,
        jti,
      },
      { secret: accessSecret, expiresIn: accessExpiresInSec },
    );

    // Refresh token opaque + lưu hash HMAC-SHA256
    const refreshToken = randomBytes(48).toString('base64url');
    const tokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.parseDurationToMs(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        userId: subject.userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresInSec,
    };
  }

  private hashRefreshToken(raw: string): string {
    const secret = this.config.getOrThrow<string>('jwt.refreshHmacSecret');
    return createHmac('sha256', secret).update(raw).digest('hex');
  }

  private parseDurationToMs(value: string): number {
    const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
    if (!match) return 0;
    const amount = parseInt(match[1], 10);
    const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return amount * unitMs[match[2]];
  }
}
