import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { RoleResponseDto } from './dto/role-response.dto';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RoleService } from './services/role.service';
import { AuthenticatedUser } from './types/authenticated-user.interface';

/**
 * RolesController — danh sách Role của Organization (tenant-scoped, ADMIN-only).
 * Phục vụ selector "chọn Role khi tạo Employee" (auth.md Mục 16 — GET /roles).
 */
@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách Role trong Organization (để chọn khi tạo Employee)' })
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  async findAll(@CurrentUser() user: AuthenticatedUser): Promise<RoleResponseDto[]> {
    const roles = await this.roleService.findManyByOrganization(user.organizationId);
    return roles.map((role) => ({ id: role.id, code: role.code, name: role.displayName }));
  }
}
