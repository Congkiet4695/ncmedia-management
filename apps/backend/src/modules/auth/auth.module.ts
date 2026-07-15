import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LoginController } from './login.controller';
import { MeController } from './me.controller';
import { RegisterController } from './register.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginService } from './services/login.service';
import { MeService } from './services/me.service';
import { OrganizationService } from './services/organization.service';
import { PermissionService } from './services/permission.service';
import { RateLimitService } from './services/rate-limit.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RegisterService } from './services/register.service';
import { RoleService } from './services/role.service';
import { TokenService } from './services/token.service';
import { UserService } from './services/user.service';

/**
 * AuthModule — Sprint 1.
 * Đã có: Register Organization, Login, GET /auth/me (JwtAuthGuard).
 * CHƯA implement: Refresh, Logout, RBAC/Permission Guard (ngoài phạm vi hiện tại).
 * JwtModule.register({}) — secret truyền tại thời điểm sign/verify trong TokenService/JwtAuthGuard.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [RegisterController, LoginController, MeController],
  providers: [
    OrganizationService,
    UserService,
    RoleService,
    PermissionService,
    TokenService,
    RegisterService,
    // Login
    LoginService,
    RefreshTokenService,
    RateLimitService,
    // Me
    MeService,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
