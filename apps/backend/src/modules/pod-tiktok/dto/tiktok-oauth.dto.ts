import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIKTOK_REGIONS, type TiktokRegion } from '../constants/tiktok.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Bắt đầu một phiên uỷ quyền TikTok.
 *
 * `accountName` là thứ DUY NHẤT người dùng nhập trong toàn bộ luồng. Nó được lưu cùng
 * `state` để callback (request vô danh do TikTok chuyển hướng) còn biết đặt tên gì cho
 * kết nối — lúc đó không còn form nào để hỏi lại.
 */
export class StartTiktokAuthorizationDto {
  @ApiProperty({
    description: 'Tên gợi nhớ cho kết nối (do người dùng đặt)',
    example: 'NCMedia US Store',
    maxLength: 255,
  })
  @Transform(trim)
  @IsString({ message: 'Account Name là bắt buộc' })
  @IsNotEmpty({ message: 'Account Name là bắt buộc' })
  @MaxLength(255, { message: 'Account Name tối đa 255 ký tự' })
  accountName!: string;

  @ApiPropertyOptional({
    enum: TIKTOK_REGIONS,
    description: 'Thị trường của Seller. Mặc định lấy từ cấu hình TIKTOK_DEFAULT_REGION (US).',
  })
  @IsOptional()
  @IsIn(TIKTOK_REGIONS, { message: 'region phải là US hoặc ROW' })
  region?: TiktokRegion;
}

/**
 * Hoàn tất uỷ quyền — body do TRANG KẾT QUẢ gửi lên ngay khi TikTok redirect về.
 *
 * 🔴 Redirect URI đăng ký với TikTok trỏ thẳng vào trang frontend `/tiktok/link-success`,
 * nên `code` rơi vào trình duyệt trước. Trang đó KHÔNG hiển thị và KHÔNG lưu `code`: nó
 * chuyển ngay xuống endpoint này, backend làm toàn bộ phần OAuth còn lại.
 *
 * `appKey`, `locale`, `shopRegion` là các tham số TikTok gửi kèm — nhận để chẩn đoán,
 * KHÔNG dùng làm cơ sở xác thực (danh tính chỉ đến từ `state`).
 */
export class CompleteTiktokOAuthDto {
  @ApiProperty({
    description: 'Tham số `code` TikTok trả về. Dùng MỘT LẦN, hết hạn sau 30 phút.',
    maxLength: 512,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;

  @ApiProperty({
    description: 'Tham số `state` do backend sinh ra khi tạo Authorization URL',
    maxLength: 128,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  state!: string;

  @ApiPropertyOptional({ description: 'Tham số `app_key` TikTok gửi kèm', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  appKey?: string;

  @ApiPropertyOptional({ description: 'Tham số `locale` TikTok gửi kèm', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string;

  @ApiPropertyOptional({ description: 'Tham số `shop_region` TikTok gửi kèm', maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  shopRegion?: string;
}

/** Tra kết quả một phiên uỷ quyền bằng vé một lần do backend phát ra. */
export class TiktokLinkResultQueryDto {
  @ApiProperty({
    description: 'Vé đọc kết quả (tham số `ref` trên URL trang kết quả)',
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  ref!: string;
}
