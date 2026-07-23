import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
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
import { ImportResultDto } from '../../common/excel/import-result.dto';
import { requireXlsx, xlsxFile, xlsxUploadOptions } from '../../common/excel/excel.http';
import { AccountExcelService } from './services/account-excel.service';
import { ADMIN_ROLE_CODE } from '../auth/constants/default-roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { AccountQueryDto } from './dto/account-query.dto';
import {
  AccountOverviewDto,
  AccountResponseDto,
  CredentialsResponseDto,
  PaginatedAccountResponseDto,
  SellerOptionDto,
} from './dto/account-response.dto';
import { AssignSellerDto } from './dto/assign-seller.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { CredentialsInputDto } from './dto/credentials-input.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountService } from './services/account.service';

/**
 * AccountController — CRUD Account (ShopAccount), tenant-scoped + RBAC (permission `account.*`).
 * Row-level: Admin xem toàn Org; role khác chỉ Account được gán cho mình (docs/account.md D-05).
 * Secret KHÔNG lộ ở GET/list — chỉ qua reveal (`account.credentials.read`) + audit.
 */
@ApiTags('Accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('accounts')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly excel: AccountExcelService,
  ) {}

  /** Row-level scope: Admin → undefined (toàn Org); khác → userId (chỉ của mình). */
  private scope(user: AuthenticatedUser): string | undefined {
    return user.role === ADMIN_ROLE_CODE ? undefined : user.userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('account.create')
  @ApiOperation({ summary: 'Tạo Account' })
  @ApiCreatedResponse({ type: AccountResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('account.read')
  @ApiOperation({ summary: 'Danh sách Account (filter/search/sort/pagination)' })
  @ApiOkResponse({ type: PaginatedAccountResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AccountQueryDto,
  ): Promise<PaginatedAccountResponseDto> {
    return this.accountService.findAll(user.organizationId, query, this.scope(user));
  }

  @Get('overview')
  @RequirePermissions('account.read')
  @ApiOperation({ summary: 'Tổng quan Account (đếm theo status × seller × platform)' })
  @ApiOkResponse({ type: AccountOverviewDto })
  overview(@CurrentUser() user: AuthenticatedUser): Promise<AccountOverviewDto> {
    return this.accountService.overview(user.organizationId, this.scope(user));
  }

  @Get('sellers')
  @RequirePermissions('account.read')
  @ApiOperation({ summary: 'Danh sách User có thể gán làm Seller' })
  @ApiOkResponse({ type: SellerOptionDto, isArray: true })
  sellers(@CurrentUser() user: AuthenticatedUser): Promise<SellerOptionDto[]> {
    return this.accountService.listSellers(user.organizationId);
  }

  // ---------- Import/Export Excel (chỉ Admin) ----------

  @Get('export/example')
  @RequirePermissions('account.export')
  @ApiOperation({ summary: 'Tải file Excel mẫu để Import Account (Admin)' })
  @ApiOkResponse({ description: 'File .xlsx' })
  async exportExample(): Promise<StreamableFile> {
    return xlsxFile(await this.excel.buildExample(), 'account-import-template.xlsx');
  }

  @Get('export')
  @RequirePermissions('account.export')
  @ApiOperation({ summary: 'Export toàn bộ Account ra Excel (kèm ID) (Admin)' })
  @ApiOkResponse({ description: 'File .xlsx' })
  async exportAll(@CurrentUser() user: AuthenticatedUser): Promise<StreamableFile> {
    return xlsxFile(await this.excel.exportAll(user.organizationId), 'accounts-export.xlsx');
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('account.import')
  @UseInterceptors(FileInterceptor('file', xlsxUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import Account từ Excel — tạo mới, bỏ qua trùng (Admin)' })
  @ApiOkResponse({ type: ImportResultDto })
  importCreate(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportResultDto> {
    return this.excel.importCreate(user.organizationId, user.userId, requireXlsx(file));
  }

  @Post('import/update')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('account.import')
  @UseInterceptors(FileInterceptor('file', xlsxUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Import file export để UPDATE theo ID (Admin)' })
  @ApiOkResponse({ type: ImportResultDto })
  importUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportResultDto> {
    return this.excel.importUpdate(user.organizationId, user.userId, requireXlsx(file));
  }

  @Get(':id')
  @RequirePermissions('account.read')
  @ApiOperation({ summary: 'Chi tiết Account (không secret)' })
  @ApiOkResponse({ type: AccountResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return this.accountService.findOne(user.organizationId, id, this.scope(user));
  }

  @Patch(':id')
  @RequirePermissions('account.update')
  @ApiOperation({ summary: 'Cập nhật Account (thông tin/vòng đời)' })
  @ApiOkResponse({ type: AccountResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountService.update(user.organizationId, user.userId, id, dto, this.scope(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('account.delete')
  @ApiOperation({ summary: 'Xóa mềm Account' })
  @ApiOkResponse({ description: 'Đã xóa mềm; data = null' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.accountService.remove(user.organizationId, user.userId, id, this.scope(user));
  }

  @Patch(':id/assign')
  @RequirePermissions('account.assign')
  @ApiOperation({ summary: 'Gán/đổi Seller quản lý (Admin)' })
  @ApiOkResponse({ type: AccountResponseDto })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSellerDto,
  ): Promise<AccountResponseDto> {
    return this.accountService.assignSeller(user.organizationId, user.userId, id, dto);
  }

  @Get(':id/credentials')
  @RequirePermissions('account.credentials.read')
  @ApiOperation({ summary: 'Reveal credentials (giải mã) — ghi audit mỗi lần' })
  @ApiOkResponse({ type: CredentialsResponseDto })
  reveal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<CredentialsResponseDto> {
    return this.accountService.revealCredentials(
      user.organizationId,
      user.userId,
      id,
      { ipAddress: ip, userAgent },
      this.scope(user),
    );
  }

  @Patch(':id/credentials')
  @RequirePermissions('account.credentials.update')
  @ApiOperation({ summary: 'Cập nhật credentials (mã hoá lại)' })
  @ApiOkResponse({ type: AccountResponseDto })
  updateCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CredentialsInputDto,
  ): Promise<AccountResponseDto> {
    return this.accountService.updateCredentials(
      user.organizationId,
      user.userId,
      id,
      dto,
      this.scope(user),
    );
  }
}
