import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';
import { PodFlashSaleStatus } from '@prisma/client';
import { FLASH_SALE_AUTO_ACTION, type FlashSaleAutoAction } from '../constants/pod-flash-sale.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** Cấu hình lịch chạy Auto Flash Sale của tổ chức. */
export class UpdateFlashSaleAutoConfigDto {
  @ApiProperty({ description: 'Bật/tắt job Auto Flash Sale của tổ chức' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ example: '05:00', description: 'Giờ chạy trong ngày, HH:mm (24h). Mỗi ngày chạy đúng một lần.' })
  @Transform(trim)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'runTime phải có dạng HH:mm (00:00 → 23:59)' })
  runTime!: string;

  @ApiProperty({ example: 'America/Los_Angeles', description: 'Múi giờ IANA của giờ chạy' })
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  timezone!: string;
}

/** Bật/tắt Auto ở MỘT đợt sale. */
export class SetFlashSaleAutoModeDto {
  @ApiProperty({ description: 'true = đợt này thành nút đang hoạt động của chuỗi Auto' })
  @IsBoolean()
  enabled!: boolean;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** Luật của chuỗi (chỉ đọc) — hiển thị để Admin biết đợt kế tiếp sẽ được tính thế nào. */
export class PodFlashSaleAutoRulesDto {
  @ApiProperty({ description: 'Tạo đợt kế tiếp khi đợt hiện tại còn ≤ số giờ này' }) leadHours!: number;
  @ApiProperty({ description: 'Đợt kế tiếp bắt đầu sau khi đợt hiện tại kết thúc (phút)' }) gapMinutes!: number;
  @ApiProperty({ description: 'Độ dài đợt kế tiếp (ngày lịch), trừ đi endTrimMinutes' }) durationDays!: number;
  @ApiProperty() endTrimMinutes!: number;
}

export class PodFlashSaleAutoNodeResultDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() shopId!: string;
  @ApiProperty({ nullable: true, type: String }) chainId!: string | null;
  @ApiProperty({ enum: Object.values(FLASH_SALE_AUTO_ACTION) }) action!: FlashSaleAutoAction;
  @ApiProperty({ nullable: true, type: String }) nextFlashSaleId!: string | null;
  @ApiProperty({ nullable: true, type: String }) message!: string | null;
}

/** Kết quả MỘT lượt chạy (cron hoặc Run Now). */
export class PodFlashSaleAutoRunResultDto {
  @ApiProperty({ enum: ['CRON', 'MANUAL'] }) trigger!: string;
  @ApiProperty({ enum: ['SUCCESS', 'PARTIAL', 'FAILED'] }) status!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty() finishedAt!: string;
  @ApiProperty({ description: 'Số đợt đang bật Auto đã kiểm' }) checked!: number;
  @ApiProperty() notDue!: number;
  @ApiProperty() created!: number;
  @ApiProperty() transferred!: number;
  @ApiProperty() inProgress!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [PodFlashSaleAutoNodeResultDto] }) nodes!: PodFlashSaleAutoNodeResultDto[];
}

export class PodFlashSaleAutoConfigDto {
  @ApiProperty({ description: 'Tổ chức đã lưu cấu hình lần nào chưa' }) configured!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ nullable: true, type: String, example: '05:00' }) runTime!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'America/Los_Angeles' }) timezone!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastRunAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastRunTrigger!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastRunStatus!: string | null;
  @ApiProperty({ nullable: true, type: PodFlashSaleAutoRunResultDto }) lastRunSummary!: PodFlashSaleAutoRunResultDto | null;
  @ApiProperty({ nullable: true, type: String, description: 'Lần chạy kế tiếp theo lịch (null khi đang tắt)' })
  nextRunAt!: string | null;
  @ApiProperty({ type: PodFlashSaleAutoRulesDto }) rules!: PodFlashSaleAutoRulesDto;
}

export class PodFlashSaleAutoChainNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PodFlashSaleStatus }) status!: PodFlashSaleStatus;
  @ApiProperty() startAt!: string;
  @ApiProperty() endAt!: string;
  @ApiProperty() autoMode!: boolean;
  @ApiProperty({ nullable: true, type: Number }) autoSequence!: number | null;
  @ApiProperty({ nullable: true, type: String }) autoParentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerFlashSaleId!: string | null;
}

/** Lịch sử chuỗi Auto của một đợt: A → B → C … */
export class PodFlashSaleAutoChainDto {
  @ApiProperty({ nullable: true, type: String }) chainId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Đợt đã sinh ra đợt này' }) previousId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Đợt được sinh ra từ đợt này' }) nextId!: string | null;
  @ApiProperty({ type: [PodFlashSaleAutoChainNodeDto] }) nodes!: PodFlashSaleAutoChainNodeDto[];
}
