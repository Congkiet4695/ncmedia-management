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

/**
 * Cấu hình thông báo Telegram của TỔ CHỨC hiện tại.
 *
 * 🔴 `organizationId` luôn lấy từ JWT — không route nào nhận id tổ chức từ client. Toàn bộ route
 * cần `notification.config` (mặc định chỉ Admin): Seller không xem / sửa được cấu hình và không
 * bao giờ thấy Bot Token (GET cũng không trả token cho Admin).
 */
@ApiTags('Notifications — Telegram')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'FORBIDDEN — thiếu quyền notification.config' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('notification.config')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: TelegramConfigService) {}

  @Get('preferences')
  @ApiOperation({
    summary: 'Loại thông báo tổ chức muốn nhận (New Order / Fulfill)',
    description: 'Chưa từng lưu ⇒ mặc định bật cả hai. Lưu được cả khi chưa cấu hình Telegram.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferencesDto> {
    return this.service.getPreferences(user.organizationId);
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
    return this.service.savePreferences(user.organizationId, user.userId, dto);
  }

  @Get('telegram')
  @ApiOperation({
    summary: 'Cấu hình Telegram của tổ chức',
    description: 'KHÔNG trả Bot Token — chỉ `botTokenMasked` (4 ký tự cuối).',
  })
  @ApiOkResponse({ type: TelegramConfigDto })
  get(@CurrentUser() user: AuthenticatedUser): Promise<TelegramConfigDto> {
    return this.service.get(user.organizationId);
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
    return this.service.save(user.organizationId, user.userId, dto);
  }

  @Delete('telegram')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá cấu hình Telegram (xoá mềm, tắt gửi thông báo)' })
  @ApiNotFoundResponse({ description: 'TELEGRAM_CONFIG_NOT_FOUND' })
  remove(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.remove(user.organizationId, user.userId);
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
    return this.service.test(user.organizationId, dto ?? {});
  }

  @Get('events')
  @ApiOperation({ summary: 'Thông báo gần đây của tổ chức (trạng thái gửi, lỗi để debug)' })
  @ApiOkResponse({ type: PaginatedNotificationEventDto })
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationEventQueryDto,
  ): Promise<PaginatedNotificationEventDto> {
    return this.service.listEvents(user.organizationId, query);
  }

  @Post('events/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi lại mọi thông báo FAILED của tổ chức (sau khi sửa cấu hình)' })
  @ApiOkResponse({ type: RequeueResultDto })
  async retryFailed(@CurrentUser() user: AuthenticatedUser): Promise<RequeueResultDto> {
    return { requeued: await this.service.retryAllFailed(user.organizationId) };
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
    await this.service.retryEvent(user.organizationId, id);
    return { requeued: 1 };
  }
}
