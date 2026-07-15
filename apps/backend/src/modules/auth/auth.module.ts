import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RegisterController } from './register.controller';
import { OrganizationService } from './services/organization.service';
import { PermissionService } from './services/permission.service';
import { RegisterService } from './services/register.service';
import { RoleService } from './services/role.service';
import { TokenService } from './services/token.service';
import { UserService } from './services/user.service';

/**
 * AuthModule — Sprint 1.
 * Hiện chỉ có Register Organization. Login/Refresh/Logout/Guard/RBAC chưa implement.
 * JwtModule.register({}) — secret truyền tại thời điểm sign trong TokenService.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [RegisterController],
  providers: [
    OrganizationService,
    UserService,
    RoleService,
    PermissionService,
    TokenService,
    RegisterService,
  ],
})
export class AuthModule {}
