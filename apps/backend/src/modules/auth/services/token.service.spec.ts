import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../database/prisma.service';
import { TokenService } from './token.service';

/** Unit test SKELETON — TokenService (chỉ phát hành token). */
describe('TokenService', () => {
  let service: TokenService;
  const jwtMock = { signAsync: jest.fn() };
  const configMock = { get: jest.fn(), getOrThrow: jest.fn() };
  const prismaMock = { refreshToken: { create: jest.fn() } };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.todo('issueTokens: ký access token HS256 với payload {sub, organizationId, role, jti}');
  it.todo('issueTokens: lưu HASH HMAC-SHA256 của refresh token (không plain text)');
  it.todo('issueTokens: refresh_tokens.expires_at = now + 7d');
  it.todo('parseDurationToMs: hỗ trợ s/m/h/d');
});
