import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  CreateEmployeeResponseDto,
  EmployeeResponseDto,
  PaginatedEmployeeResponseDto,
  ResetPasswordResponseDto,
} from './dto/employee-response.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeService } from './services/employee.service';

/**
 * EmployeeController — CRUD Employee (ADMIN-only, tenant-scoped).
 * Guard: JwtAuthGuard (xác thực) + AdminGuard (chỉ ADMIN → role khác 403).
 * Controller chỉ điều hướng — không chứa business logic (CLAUDE.md Mục 8).
 */
@ApiTags('Employees')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Không phải ADMIN (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo Employee (tự sinh mật khẩu, gán Role)' })
  @ApiCreatedResponse({ type: CreateEmployeeResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ): Promise<CreateEmployeeResponseDto> {
    return this.employeeService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách Employee (filter/search/sort/pagination)' })
  @ApiOkResponse({ type: PaginatedEmployeeResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeQueryDto,
  ): Promise<PaginatedEmployeeResponseDto> {
    return this.employeeService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết Employee' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeResponseDto> {
    return this.employeeService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật Employee' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeeService.update(user.organizationId, user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa mềm Employee (soft delete)' })
  @ApiOkResponse({ description: 'Đã xóa mềm; data = null' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.employeeService.remove(user.organizationId, user.userId, id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset mật khẩu Employee (trả mật khẩu mới, hiển thị một lần)' })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResetPasswordResponseDto> {
    return this.employeeService.resetPassword(user.organizationId, user.userId, id);
  }
}
