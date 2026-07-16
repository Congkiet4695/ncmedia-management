import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LoginController } from './login.controller';
import { MeController } from './me.controller';
import { RegisterController } from './register.controller';
import { RolesController } from './roles.controller';
import { AdminGuard } from './guards/admin.guard';
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
 * AuthModule — Sprint 1 + hạ tầng auth cho Sprint 2.
 * Đã có: Register, Login, GET /auth/me, GET /roles, JwtAuthGuard, AdminGuard.
 * Export JwtAuthGuard + AdminGuard để các module nghiệp vụ (Employee) tái sử dụng.
 * CHƯA implement: Refresh, Logout, Permission RBAC đầy đủ (ngoài phạm vi hiện tại).
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [RegisterController, LoginController, MeController, RolesController],
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
    // Guards (dùng chung)
    JwtAuthGuard,
    AdminGuard,
  ],
  // Export JwtModule kèm theo: JwtAuthGuard (dùng qua @UseGuards ở module khác) được
  // Nest khởi tạo trong injector của module tiêu dùng → cần JwtService trong scope đó.
  // Export UserService để module khác (Profile) tái sử dụng (không duplicate).
  exports: [JwtAuthGuard, AdminGuard, JwtModule, UserService],
})
export class AuthModule {}
