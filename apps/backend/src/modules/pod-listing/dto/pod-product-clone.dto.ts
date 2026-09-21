import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { POD_PRODUCT_CLONE_MAX_SHOPS } from '../constants/pod-listing.constants';

/**
 * Nhân bản MỘT sản phẩm sang NHIỀU shop.
 *
 * 🔴 Chỉ nhận danh sách shop đích. Sản phẩm nguồn nằm trên đường dẫn (`/pod/products/:id/clone`);
 * `organizationId` / `userId` / shop nguồn lấy từ JWT + bản ghi sản phẩm — không tin bất kỳ
 * trường nào khác từ client. Từng `shopId` được đối chiếu với phạm vi của người gọi ở server.
 */
export class CloneProductDto {
  @ApiProperty({
    description: 'Các shop đích (chọn nhiều). Shop ngoài phạm vi của người gọi ⇒ 403 cả request.',
    type: [String],
    minItems: 1,
    maxItems: POD_PRODUCT_CLONE_MAX_SHOPS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_PRODUCT_CLONE_MAX_SHOPS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetShopIds!: string[];
}
