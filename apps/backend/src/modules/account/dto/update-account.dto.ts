import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateAccountDto } from './create-account.dto';

/**
 * Input cập nhật Account. Bỏ `credentials` (cập nhật qua endpoint riêng
 * `PATCH /accounts/:id/credentials`). `organization_id` không bao giờ nhận từ client.
 */
export class UpdateAccountDto extends PartialType(
  OmitType(CreateAccountDto, ['credentials'] as const),
) {}
