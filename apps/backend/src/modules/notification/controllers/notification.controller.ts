import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  NotificationEventQueryDto,
  NotificationPreferencesDto,
  PaginatedNotificationEventDto,
  RequeueResultDto,
  SaveTelegramConfigDto,
  TelegramConfigDto,
  TelegramTestResultDto,
  TestTelegramDto,
} from '../dto/notification.dto';
import { TelegramConfigService } from '../services/telegram-config.service';
import {
  NOTIFICATION_SELF_PERMISSION,
  organizationOwner,
  type NotificationOwner,
} from '../types/notification-owner';

/**
 * Các route của MỘT kênh thông báo — dùng chung cho kênh tổ chức và kênh cá nhân (cùng nghiệp vụ, cùng
 * validation, cùng service). Lớp con chỉ quyết định hai điều: quyền cần có và CHỦ SỞ HỮU lấy từ JWT.
 *
 * 🔴 Không route nào nhận id tổ chức / id người dùng từ client: đổi id trong request không chạm được cấu
 * hình hay thông báo của người khác.
 */
abstract class NotificationChannelController {
  constructor(protected readonly service: TelegramConfigService) {}

  /** Chủ sở hữu kênh — CHỈ dựng từ người dùng đã xác thực. */
  protected abstract ownerOf(user: AuthenticatedUser): NotificationOwner;

  @Get('preferences')
  @ApiOperation({
    summary: 'Loại thông báo tổ chức muốn nhận (New Order / Fulfill)',
    description: 'Chưa từng lưu ⇒ mặc định bật cả hai. Lưu được cả khi chưa cấu hình Telegram.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferencesDto> {
    return this.service.getPreferences(this.ownerOf(user));
  }

  @Put('preferences')
  @ApiOperation({
    summary: 'Lưu loại thông báo tổ chức muốn nhận',
    description:
      'Backend áp dụng ở CẢ hai đầu: không ghi sự kiện cho loại đã tắt, và worker bỏ qua (SKIPPED) ' +
      'sự kiện đã ghi trước khi tắt. Riêng của từng tổ chức.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  savePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.service.savePreferences(this.ownerOf(user), user.userId, dto);
  }

  @Get('telegram')
  @ApiOperation({
    summary: 'Cấu hình Telegram của tổ chức',
    description: 'KHÔNG trả Bot Token — chỉ `botTokenMasked` (4 ký tự cuối).',
  })
  @ApiOkResponse({ type: TelegramConfigDto })
  get(@CurrentUser() user: AuthenticatedUser): Promise<TelegramConfigDto> {
    return this.service.get(this.ownerOf(user));
  }

  @Put('telegram')
  @ApiOperation({
    summary: 'Lưu cấu hình Telegram',
    description:
      'Bot Token bắt buộc lần đầu; khi cập nhật để trống ⇒ GIỮ token cũ. Token được mã hoá ' +
      'AES-256-GCM trước khi lưu. Đổi token / Chat ID ⇒ trạng thái kết nối về "chưa kiểm tra".',
  })
  @ApiOkResponse({ type: TelegramConfigDto })
  @ApiServiceUnavailableResponse({ description: 'NOTIFICATION_ENCRYPTION_KEY_MISSING' })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveTelegramConfigDto,
  ): Promise<TelegramConfigDto> {
    return this.service.save(this.ownerOf(user), user.userId, dto);
  }

  @Delete('telegram')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá cấu hình Telegram (xoá mềm, tắt gửi thông báo)' })
  @ApiNotFoundResponse({ description: 'TELEGRAM_CONFIG_NOT_FOUND' })
  remove(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.remove(this.ownerOf(user), user.userId);
  }

  @Post('telegram/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi tin nhắn thử',
    description:
      'getMe + sendMessage với giá trị trên form (nếu gửi kèm) hoặc cấu hình đã lưu. Lỗi Telegram ' +
      '(token sai, sai Chat ID, bot chưa vào group, không có quyền, timeout…) trả `success: false` ' +
      'kèm `errorCode` + nguyên nhân. Tối đa 5 lần / phút / tổ chức.',
  })
  @ApiOkResponse({ type: TelegramTestResultDto })
  @ApiTooManyRequestsResponse({ description: 'TELEGRAM_TEST_RATE_LIMITED' })
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestTelegramDto,
  ): Promise<TelegramTestResultDto> {
    return this.service.test(this.ownerOf(user), dto ?? {});
  }

  @Get('events')
  @ApiOperation({ summary: 'Thông báo gần đây của tổ chức (trạng thái gửi, lỗi để debug)' })
  @ApiOkResponse({ type: PaginatedNotificationEventDto })
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationEventQueryDto,
  ): Promise<PaginatedNotificationEventDto> {
    return this.service.listEvents(this.ownerOf(user), query);
  }

  @Post('events/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi lại mọi thông báo FAILED của tổ chức (sau khi sửa cấu hình)' })
  @ApiOkResponse({ type: RequeueResultDto })
  async retryFailed(@CurrentUser() user: AuthenticatedUser): Promise<RequeueResultDto> {
    return { requeued: await this.service.retryAllFailed(this.ownerOf(user)) };
  }

  @Post('events/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi lại một thông báo FAILED / SKIPPED' })
  @ApiOkResponse({ type: RequeueResultDto })
  @ApiNotFoundResponse({ description: 'NOTIFICATION_EVENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'NOTIFICATION_EVENT_NOT_RETRYABLE' })
  async retryEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequeueResultDto> {
    await this.service.retryEvent(this.ownerOf(user), id);
    return { requeued: 1 };
  }
}

/**
 * Cấu hình thông báo Telegram của TỔ CHỨC hiện tại — nhận MỌI đơn của tổ chức.
 *
 * Toàn bộ route cần `notification.config` (mặc định chỉ Admin): Seller không xem / sửa được cấu hình này
 * và không bao giờ thấy Bot Token (GET cũng không trả token cho Admin).
 */
@ApiTags('Notifications — Telegram')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN — thiếu quyền notification.config' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('notification.config')
@Controller('notifications')
export class NotificationController extends NotificationChannelController {
  constructor(service: TelegramConfigService) {
    super(service);
  }

  protected ownerOf(user: AuthenticatedUser): NotificationOwner {
    return organizationOwner(user.organizationId);
  }
}

/**
 * Kênh Telegram CÁ NHÂN của người đang đăng nhập (mặc định: Employee) — cùng chức năng với kênh tổ chức,
 * nhưng CHỈ nhận đơn thuộc shop đang được gán cho chính người đó (kiểm ở backend lúc ghi VÀ lúc gửi).
 *
 * 🔴 Chủ sở hữu = (tổ chức, user) trong JWT — không có tham số id nào: không đọc / sửa được kênh của Admin
 * hay của nhân viên khác, và không có ô "chọn shop" nào để giả mạo — phạm vi shop lấy từ phân công trong DB.
 */
@ApiTags('Notifications — Telegram (cá nhân)')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN — thiếu quyền notification.self' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(NOTIFICATION_SELF_PERMISSION)
@Controller('notifications/me')
export class MyNotificationController extends NotificationChannelController {
  constructor(service: TelegramConfigService) {
    super(service);
  }

  protected ownerOf(user: AuthenticatedUser): NotificationOwner {
    return { organizationId: user.organizationId, userId: user.userId };
  }
}
