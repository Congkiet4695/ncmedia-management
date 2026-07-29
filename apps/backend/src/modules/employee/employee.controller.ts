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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { createXlsxUploadOptions, requireXlsx, xlsxFile } from '../../common/excel/excel.http';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { EMPLOYEE_IMPORT_MAX_BYTES } from './constants/employee-excel.constants';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeImportResultDto } from './dto/employee-import-result.dto';
import {
  CreateEmployeeResponseDto,
  EmployeeResponseDto,
  PaginatedEmployeeResponseDto,
  ResetPasswordResponseDto,
} from './dto/employee-response.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeExcelService } from './services/employee-excel.service';
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
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly excel: EmployeeExcelService,
  ) {}

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

  // ---------- Import / Export Excel (ADMIN-only, khai báo TRƯỚC ':id' để không bị nuốt route) ----------

  @Get('export')
  @ApiOperation({
    summary: 'Export Employee ra Excel — áp dụng đúng filter hiện tại (Admin)',
    description: 'Chỉ export Employee của Organization trong Access Token. File: employees_YYYYMMDD_HHmmss.xlsx',
  })
  @ApiOkResponse({ description: 'File .xlsx' })
  async exportExcel(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeQueryDto,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.excel.export(user.organizationId, query);
    return xlsxFile(buffer, filename);
  }

  @Get('template')
  @ApiOperation({ summary: 'Tải file Excel mẫu để Import Employee (Admin)' })
  @ApiOkResponse({ description: 'File .xlsx gồm sheet dữ liệu + sheet Instructions' })
  async downloadTemplate(@CurrentUser() user: AuthenticatedUser): Promise<StreamableFile> {
    const buffer = await this.excel.buildTemplate(user.organizationId);
    return xlsxFile(buffer, 'employee-import-template.xlsx');
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', createXlsxUploadOptions(EMPLOYEE_IMPORT_MAX_BYTES)))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Import Employee từ Excel — tạo mới hoặc cập nhật theo Email (Admin)',
    description:
      'Validate toàn bộ file trước khi ghi. Chỉ cần 1 dòng lỗi → không ghi dòng nào (rollback toàn bộ) và trả về file lỗi (base64). Tối đa 10MB.',
  })
  @ApiOkResponse({ type: EmployeeImportResultDto })
  importExcel(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<EmployeeImportResultDto> {
    return this.excel.import(user.organizationId, user.userId, requireXlsx(file));
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
