import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationEntityType,
  NotificationEventStatus,
  NotificationEventType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TELEGRAM_BOT_TOKEN_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
} from '../constants/notification.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Chuỗi rỗng ⇒ undefined: "để trống = giữ token cũ". */
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** Trạng thái hiển thị của tích hợp Telegram. */
export enum TelegramIntegrationStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  DISABLED = 'DISABLED',
  /** Đã bật nhưng chưa có lần gửi nào (chưa gửi thử). */
  UNTESTED = 'UNTESTED',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

/** PUT /notifications/telegram */
export class SaveTelegramConfigDto {
  @ApiPropertyOptional({
    description:
      'Bot Token từ @BotFather. BẮT BUỘC khi cấu hình lần đầu; để trống khi cập nhật ⇒ GIỮ token cũ.',
    example: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(TELEGRAM_BOT_TOKEN_PATTERN, {
    message: 'Bot Token không đúng định dạng <bot id>:<secret> của @BotFather',
  })
  botToken?: string;

  @ApiProperty({
    description: 'Chat ID của group / channel (số, vd -1001234567890) hoặc @channelusername.',
    example: '-1001234567890',
  })
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  @Matches(TELEGRAM_CHAT_ID_PATTERN, {
    message: 'Chat ID phải là số (vd -1001234567890) hoặc @channelusername',
  })
  chatId!: string;

  @ApiProperty({ description: 'Bật / tắt gửi thông báo Telegram cho tổ chức.' })
  @IsBoolean()
  enabled!: boolean;
}

/** POST /notifications/telegram/test — thử với giá trị trên form (chưa lưu) hoặc cấu hình đã lưu. */
export class TestTelegramDto {
  @ApiPropertyOptional({ description: 'Bot Token chưa lưu; bỏ trống ⇒ dùng token đã lưu.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(TELEGRAM_BOT_TOKEN_PATTERN, {
    message: 'Bot Token không đúng định dạng <bot id>:<secret> của @BotFather',
  })
  botToken?: string;

  @ApiPropertyOptional({ description: 'Chat ID chưa lưu; bỏ trống ⇒ dùng Chat ID đã lưu.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(64)
  @Matches(TELEGRAM_CHAT_ID_PATTERN, {
    message: 'Chat ID phải là số (vd -1001234567890) hoặc @channelusername',
  })
  chatId?: string;
}

/** Cấu hình Telegram — KHÔNG BAO GIỜ chứa Bot Token. */
export class TelegramConfigDto {
  @ApiProperty() configured!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: TelegramIntegrationStatus }) status!: TelegramIntegrationStatus;
  @ApiPropertyOptional({ nullable: true, description: 'Token đã che, vd `••••••••wxyz`.' })
  botTokenMasked!: string | null;
  @ApiPropertyOptional({ nullable: true }) botUsername!: string | null;
  @ApiPropertyOptional({ nullable: true }) chatId!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastDeliveryAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastErrorCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastErrorMessage!: string | null;
  @ApiProperty({ description: 'Máy chủ đã có NOTIFICATION_ENCRYPTION_KEY hợp lệ chưa.' })
  encryptionReady!: boolean;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}

export class TelegramTestResultDto {
  @ApiProperty() success!: boolean;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ nullable: true }) errorCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) botUsername!: string | null;
}

export class NotificationEventQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: NotificationEventStatus })
  @IsOptional()
  @IsEnum(NotificationEventStatus)
  status?: NotificationEventStatus;

  @ApiPropertyOptional({ enum: NotificationEventType })
  @IsOptional()
  @IsEnum(NotificationEventType)
  eventType?: NotificationEventType;
}

export class NotificationEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationEventType }) eventType!: NotificationEventType;
  @ApiProperty({ enum: NotificationEntityType }) entityType!: NotificationEntityType;
  @ApiProperty() entityId!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Mã đơn TikTok trong payload.' })
  tiktokOrderId!: string | null;
  @ApiProperty({ enum: NotificationEventStatus }) status!: NotificationEventStatus;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() nextAttemptAt!: Date;
  @ApiPropertyOptional({ nullable: true }) sentAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastErrorCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) errorMessage!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class NotificationPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedNotificationEventDto {
  @ApiProperty({ type: NotificationEventDto, isArray: true }) items!: NotificationEventDto[];
  @ApiProperty({ type: NotificationPaginationMetaDto }) meta!: NotificationPaginationMetaDto;
}

export class RequeueResultDto {
  @ApiProperty({ description: 'Số thông báo đã đưa lại hàng đợi.' }) requeued!: number;
}

/** Loại thông báo tổ chức muốn nhận — GET / PUT /notifications/preferences. */
export class NotificationPreferencesDto {
  @ApiProperty({ description: 'NEW ORDER — đơn TikTok mới được tạo khi đồng bộ (thủ công / tự động).' })
  @IsBoolean()
  newOrder!: boolean;

  @ApiProperty({ description: 'FULFILL — fulfill thành công và huỷ fulfillment thành công.' })
  @IsBoolean()
  fulfillment!: boolean;
}
