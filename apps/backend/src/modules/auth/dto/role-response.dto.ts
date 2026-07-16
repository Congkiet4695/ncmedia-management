import { ApiProperty } from '@nestjs/swagger';

/** Role rút gọn cho danh sách chọn (GET /roles). `name` = display name. */
export class RoleResponseDto {
  @ApiProperty({ example: '7b5f...' }) id!: string;
  @ApiProperty({ example: 'EMPLOYEE' }) code!: string;
  @ApiProperty({ example: 'Employee' }) name!: string;
}
