import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LoginController } from './login.controller';
import { MeController } from './me.controller';
import { RefreshController } from './refresh.controller';
import { RegisterController } from './register.controller';
import { RolesController } from './roles.controller';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AuthEventLogger } from './services/auth-event.logger';
import { LoginService } from './services/login.service';
import { MeService } from './services/me.service';
import { OrganizationService } from './services/organization.service';
import { PermissionService } from './services/permission.service';
import { RateLimitService } from './services/rate-limit.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RefreshService } from './services/refresh.service';
import { RegisterService } from './services/register.service';
import { RoleService } from './services/role.service';
import { TokenService } from './services/token.service';
import { UserService } from './services/user.service';

/**
 * AuthModule — vòng đời phiên đầy đủ.
 *
 * Register, Login, **Refresh, Logout**, GET /auth/me, GET /roles, và bộ guard dùng chung
 * (JwtAuthGuard, AdminGuard, PermissionsGuard, SuperAdminGuard).
 *
 * 🔴 `RefreshController` là mảnh còn thiếu suốt các sprint trước: refresh token vẫn được
 * phát và lưu khi login nhưng không có endpoint nào tiêu thụ, nên access token hết hạn sau
 * 15 phút là đăng xuất luôn. Xem `RefreshService`.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    RegisterController,
    LoginController,
    RefreshController,
    MeController,
    RolesController,
  ],
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
    // Refresh / Logout
    RefreshService,
    AuthEventLogger,
    // Me
    MeService,
    // Guards (dùng chung)
    JwtAuthGuard,
    AdminGuard,
    PermissionsGuard,
    SuperAdminGuard,
  ],
  // Export JwtModule kèm theo: JwtAuthGuard (dùng qua @UseGuards ở module khác) được
  // Nest khởi tạo trong injector của module tiêu dùng → cần JwtService trong scope đó.
  // Export UserService để module khác (Profile) tái sử dụng (không duplicate).
  exports: [
    JwtAuthGuard,
    AdminGuard,
    PermissionsGuard,
    SuperAdminGuard,
    JwtModule,
    UserService,
    RefreshService,
  ],
})
export class AuthModule {}
