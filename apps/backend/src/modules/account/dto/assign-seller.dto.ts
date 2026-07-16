import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Gán/đổi Seller quản lý Account. `sellerUserId` null → bỏ gán. */
export class AssignSellerDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Seller (User) — null để bỏ gán' })
  @IsOptional()
  @IsUUID()
  sellerUserId?: string | null;
}
