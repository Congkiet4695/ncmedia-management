import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateOrderDto } from './create-order.dto';

/**
 * Cập nhật Order: mọi field optional; KHÔNG đổi `accountId` (đổi chủ Account) và
 * KHÔNG đổi `status` qua đây (dùng PATCH /orders/:id/status để ghi timeline).
 * Nếu truyền `items` → thay thế toàn bộ danh sách sản phẩm.
 */
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, ['accountId', 'status'] as const),
) {}
